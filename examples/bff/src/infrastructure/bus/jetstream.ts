// The order's moves, off the stream the order service publishes them on.
//
// One ephemeral consumer per listener, filtered to the one subject, and the
// order id checked in this process: a client watching one order is not worth
// a durable consumer on the server, and a client that goes away should leave
// nothing behind. The event's name is a header, so which move this is can be
// read without parsing the payload - the same trick every other service in
// the estate plays on the same bus.
import { AckPolicy, jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import type { OrderEvents, OrderMoved } from "../../ports/order-events.ts";
import type { OrderState } from "../../ports/orders.ts";

const STREAM = "shop-oms";
const SUBJECT = "shop.oms.order";
const HEADER_EVENT_NAME = "event_name";

/** The moves this service knows how to forward; anything else on the subject is not one. */
const STATES: Record<string, OrderState> = {
  "oms.OrderPlaced": "PLACED",
  "oms.OrderConfirmed": "CONFIRMED",
  "oms.OrderCancelled": "CANCELLED",
};

interface Open {
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
}

export class JetStreamOrderEvents implements OrderEvents {
  private readonly opening: Promise<Open>;

  constructor(url: string) {
    this.opening = open(url);
    // Observed by the first subscription; without a handler here a refused
    // connection would be an unhandled rejection before anybody asked.
    this.opening.catch(() => undefined);
  }

  async *moves(orderId: string, signal: AbortSignal): AsyncIterable<OrderMoved> {
    const { js, jsm } = await this.opening;
    const info = await jsm.consumers.add(STREAM, { ack_policy: AckPolicy.None, filter_subject: SUBJECT });
    const consumer = await js.consumers.get(STREAM, info.name);
    const messages = await consumer.consume();
    signal.addEventListener("abort", () => messages.stop(), { once: true });

    try {
      for await (const message of messages) {
        const state = STATES[message.headers?.get(HEADER_EVENT_NAME) ?? ""];
        if (!state) continue;
        const payload = message.json<{ orderId?: string; occurredAt?: string }>();
        if (payload.orderId !== orderId) continue;

        yield { orderId, state, at: payload.occurredAt ?? new Date().toISOString() };
      }
    } finally {
      messages.stop();
      await jsm.consumers.delete(STREAM, info.name).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const { nc } = await this.opening;
    await nc.drain();
  }
}

async function open(url: string): Promise<Open> {
  const nc = await connect({ servers: url, name: "bff" });

  return { nc, js: jetstream(nc), jsm: await jetstreamManager(nc) };
}

/**
 * The stand-in assembly uses without NATS_URL: a subscription is answered,
 * and nothing ever arrives on it. A client watching an order in a storefront
 * running alone waits rather than being told the field does not work.
 */
export class NoOrderEvents implements OrderEvents {
  async *moves(_orderId: string, signal: AbortSignal): AsyncIterable<OrderMoved> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}
