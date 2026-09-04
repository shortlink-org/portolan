// The bus over NATS JetStream: the way an event leaves this process for
// another (ADR cart.0008). One stream for the service, `shop-cart`, over every
// subject under `shop.cart.`; the outbox row's topic is the subject, its uuid
// is the message id the stream deduplicates on, and its metadata rides as
// headers, so a subscriber in any language reads the event's name and the
// trace without opening the payload.
import { AckPolicy, jetstream, jetstreamManager, type ConsumerMessages, type JetStreamClient, type JetStreamManager } from "@nats-io/jetstream";
import { connect, headers, type NatsConnection } from "@nats-io/transport-node";
import { type Bus, deliver, type Handler, type Message } from "./bus.ts";

export const STREAM = "shop-cart";
export const SUBJECTS = "shop.cart.>";
/** How long the stream remembers a message id, in nanoseconds: long enough for any relay retry, short enough to cost nothing. */
const DUPLICATE_WINDOW = 2 * 60 * 60 * 1_000_000_000;
const HEADER_MSG_ID = "Nats-Msg-Id";

interface Open {
  nc: NatsConnection;
  js: JetStreamClient;
}

export class NatsBus implements Bus {
  readonly system = "nats";
  private readonly name: string;
  private readonly opening: Promise<Open>;
  private readonly consuming: ConsumerMessages[] = [];

  /** Connects in the background; `ready` is where a failure to surfaces, and `publish` waits on it. */
  constructor(url: string, name: string) {
    this.name = name;
    this.opening = open(url, name);
    // Observed through ready() and every publish; without a handler here a
    // refused connection would be an unhandled rejection before main got to
    // say what was wrong.
    this.opening.catch(() => undefined);
  }

  async ready(): Promise<void> {
    await this.opening;
  }

  /** At least once, like the relay: a repeat within the window is acknowledged as a duplicate and stored once. */
  async publish(message: Message): Promise<void> {
    const { js } = await this.opening;
    const h = headers();
    for (const [key, value] of Object.entries(message.metadata)) h.set(key, value);
    await js.publish(message.topic, JSON.stringify(message.payload), { msgID: message.uuid, headers: h });
  }

  /** A durable consumer named after the subscriber and the subject, so a service that was down reads what it missed. */
  async subscribe(topic: string, handler: Handler): Promise<void> {
    const { js } = await this.opening;
    const durable = `${this.name}-${topic.replaceAll(".", "-")}`;
    const jsm = await js.jetstreamManager();
    await jsm.consumers.add(STREAM, { durable_name: durable, ack_policy: AckPolicy.Explicit, filter_subject: topic });
    const consumer = await js.consumers.get(STREAM, durable);
    const messages = await consumer.consume();
    this.consuming.push(messages);
    void this.pump(messages, handler);
  }

  private async pump(messages: ConsumerMessages, handler: Handler): Promise<void> {
    for await (const m of messages) {
      const metadata: Record<string, string> = {};
      for (const key of m.headers?.keys() ?? []) {
        if (key !== HEADER_MSG_ID) metadata[key] = m.headers?.get(key) ?? "";
      }
      const message: Message = { uuid: m.headers?.get(HEADER_MSG_ID) ?? String(m.seq), topic: m.subject, payload: m.json(), metadata };
      try {
        await deliver(this.system, message, handler);
        m.ack();
      } catch {
        // Redelivered after the server's backoff; the handler is expected to
        // be idempotent for the same reason the relay's repeats are tolerated.
        m.nak();
      }
    }
  }

  async close(): Promise<void> {
    const opened = await this.opening.catch(() => undefined);
    for (const messages of this.consuming) await messages.close();
    await opened?.nc.drain();
  }
}

async function open(url: string, name: string): Promise<Open> {
  const nc = await connect({ servers: url, name });
  await ensureStream(await jetstreamManager(nc));
  return { nc, js: jetstream(nc) };
}

/** The stream is the publisher's to declare; a second declaration of the same stream is not an error. */
async function ensureStream(jsm: JetStreamManager): Promise<void> {
  await jsm.streams.add({ name: STREAM, subjects: [SUBJECTS], duplicate_window: DUPLICATE_WINDOW }).catch(() => jsm.streams.info(STREAM));
}
