// The bus: what the relay delivers to and what a policy subscribes on. A
// message is what the outbox row held; the event's name is on its metadata, so
// a subscriber dispatches without parsing the payload.
//
// Two of them. In process, for a service running alone and for the tests; over
// NATS JetStream when NATS_URL names a server, which is how an event reaches a
// service that is not this one (ADR cart.0008). The relay holds a Bus and
// cannot tell which, and that is the point of there being an interface.
import { startConsume, within } from "./tracing.ts";

export interface Message {
  uuid: string;
  topic: string;
  payload: unknown;
  metadata: Record<string, string>;
}

export type Handler = (message: Message) => Promise<void>;

export const METADATA_EVENT_NAME = "event_name";

export interface Bus {
  /** What a span says the message went over: `outbox` in process, `nats` over the wire. */
  readonly system: string;
  /** Resolves once the bus can be published to, and rejects when it never will: a wrong address fails at start, not at the first event. */
  ready(): Promise<void>;
  publish(message: Message): Promise<void>;
  subscribe(topic: string, handler: Handler): Promise<void>;
  close(): Promise<void>;
}

/** The event's name as the metadata carries it; the topic when it does not, so a span always has something to be called. */
export function eventNameOf(message: Message): string {
  return message.metadata[METADATA_EVENT_NAME] ?? message.topic;
}

/**
 * Runs one handler under the consumer span of its message. The span is opened
 * here, by the bus, and not by the relay: the relay publishes, and a span that
 * said it consumed had the catalog reading the service as a subscriber to its
 * own events.
 */
export async function deliver(system: string, message: Message, handler: Handler): Promise<void> {
  const span = startConsume(system, message.topic, eventNameOf(message), message.metadata);
  try {
    await within(span, () => handler(message));
  } finally {
    span.end();
  }
}

/**
 * Delivers to subscribers in the publishing call. A subscriber's failure is
 * the publisher's, which is what lets the relay leave the row unpublished and
 * try again; a failure that was swallowed here would be a lost event.
 */
export class InProcBus implements Bus {
  readonly system = "outbox";
  private readonly handlers = new Map<string, Handler[]>();

  ready(): Promise<void> {
    return Promise.resolve();
  }

  async subscribe(topic: string, handler: Handler): Promise<void> {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }

  async publish(message: Message): Promise<void> {
    for (const handler of this.handlers.get(message.topic) ?? []) await deliver(this.system, message, handler);
  }

  async close(): Promise<void> {}
}
