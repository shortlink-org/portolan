// Other services' facts, read off NATS JetStream and handed to the policies in
// process - the same bargain the ledger and the order service strike on the
// same bus. One durable consumer per fact, named after this service and the
// event and filtered on the publisher's subject, so a delivery service that
// was down reads what it missed. The event's name rides in the `event_name`
// header; the payload is read only for a name this service knows.
import { AckPolicy, connect, type JetStreamManager, type JsMsg, nanos, type NatsConnection } from "nats";
import { OrderConfirmed } from "../../application/oms/events.ts";
import { PaymentCaptured } from "../../application/ledger/events.ts";

const HEADER_EVENT_NAME = "event_name";
const DURABLE_PREFIX = "delivery-core";

/** How long a stream remembers a message id; the same window both publishers declare. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** How long a fact that failed waits before it is delivered again: a ledger that is down is not asked in a tight loop. */
const REDELIVERY_DELAY_MS = 1000;

/** What the policies are handed: the facts in this service's own words. */
export type Fact = OrderConfirmed | PaymentCaptured;

/** Whatever reacts to a fact; a policy's `handle`. */
export type Listener = (fact: Fact) => Promise<void>;

/** One subscription: the publisher's subject and the event read off it. */
export interface Subscription {
  subject: string;
  event: Fact["name"];
  listener: Listener;
}

export const ORDER_SUBJECT = "shop.oms.order";
export const PAYMENT_SUBJECT = "payments.ledger.payment";

/**
 * The wire payload in this service's words. An event this service does not
 * read is `undefined`; a known event whose payload lacks what delivery reads
 * is an error, because it is broken rather than somebody else's.
 */
export function factOf(eventName: string, payload: unknown): Fact | undefined {
  switch (eventName) {
    case "oms.OrderConfirmed":
      return new OrderConfirmed(field(eventName, payload, "orderId"));
    case "ledger.PaymentCaptured":
      return new PaymentCaptured(field(eventName, payload, "paymentId"), field(eventName, payload, "orderId"));
    default:
      return undefined;
  }
}

function field(eventName: string, payload: unknown, name: string): string {
  const value = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string" || value === "") throw new Error(`${eventName} arrived without ${name}`);
  return value;
}

/** `shop.oms.order` -> the stream `shop-oms` over `shop.oms.>`, the rule every service on this bus declares by. */
export function streamOf(subject: string): { name: string; subjects: string } {
  const head = subject.split(".").slice(0, 2);
  return { name: head.join("-"), subjects: `${head.join(".")}.>` };
}

export class JetStreamFacts {
  private constructor(
    private readonly nc: NatsConnection,
    private readonly jsm: JetStreamManager,
  ) {}

  static async connect(url: string): Promise<JetStreamFacts> {
    const nc = await connect({ servers: url, name: DURABLE_PREFIX });
    return new JetStreamFacts(nc, await nc.jetstreamManager());
  }

  /** Starts reading; the returned promise settles once every consumer is in place, not when reading stops. */
  async subscribe(subscription: Subscription): Promise<void> {
    const stream = await this.ensure(subscription.subject);
    const durable = `${DURABLE_PREFIX}-${subscription.event.replace(".", "-")}`;
    await this.jsm.consumers.add(stream, {
      durable_name: durable,
      filter_subject: subscription.subject,
      ack_policy: AckPolicy.Explicit,
    });
    const consumer = await this.nc.jetstream().consumers.get(stream, durable);
    const messages = await consumer.consume();
    void (async () => {
      for await (const message of messages) await deliver(message, subscription);
    })();
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }

  /** Declares the publisher's stream the way the publisher does, so whichever side comes up first makes it. */
  private async ensure(subject: string): Promise<string> {
    const { name, subjects } = streamOf(subject);
    const exists = await this.jsm.streams.info(name).then(() => true, () => false);
    if (!exists) {
      await this.jsm.streams.add({ name, subjects: [subjects], duplicate_window: nanos(DUPLICATE_WINDOW_MS) }).catch(async (err: unknown) => {
        // The publisher made it between the look and the add.
        if (!(await this.jsm.streams.info(name).then(() => true, () => false))) throw err;
      });
    }
    return name;
  }
}

/**
 * At least once: acknowledged once the listener ran, delivered again when it
 * threw. Another event of the same aggregate is not this subscriber's and is
 * acknowledged unread.
 */
async function deliver(message: JsMsg, subscription: Subscription): Promise<void> {
  const name = message.headers?.get(HEADER_EVENT_NAME) ?? "";
  if (name !== subscription.event) {
    message.ack();
    return;
  }
  try {
    const fact = factOf(name, message.json<unknown>());
    if (fact) await subscription.listener(fact);
    message.ack();
  } catch (err) {
    console.warn(`${name} was not handled and will be delivered again: ${err instanceof Error ? err.message : String(err)}`);
    message.nak(REDELIVERY_DELAY_MS);
  }
}
