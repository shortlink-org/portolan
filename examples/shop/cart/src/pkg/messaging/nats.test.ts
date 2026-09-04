import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Message, METADATA_EVENT_NAME } from "./bus.ts";
import { NatsBus } from "./nats.ts";

// Without Docker the suite is skipped rather than failed, the way the
// repository's is: the bus in process covers the relay, and this is the one
// file that needs a server.
const container: StartedTestContainer | undefined = await new GenericContainer("nats:2.12-alpine")
  .withCommand(["-js"])
  .withExposedPorts(4222)
  .start()
  .catch(() => undefined);
let bus: NatsBus;

beforeAll(async () => {
  if (!container) return;
  bus = new NatsBus(`nats://${container.getHost()}:${container.getMappedPort(4222)}`, "cart-test");
  await bus.ready();
});

afterAll(async () => {
  await bus?.close();
  await container?.stop();
});

const message = (uuid: string, name: string): Message => ({
  uuid,
  topic: "shop.cart.basket",
  payload: { basketId: "b-1", sku: "tea" },
  metadata: { [METADATA_EVENT_NAME]: name, otel_trace_id: "0af7651916cd43dd8448eb211c80319c", otel_span_id: "b7ad6b7169203331" },
});

describe.skipIf(!container)("NatsBus", () => {
  it("hands a subscriber the payload and the metadata, once, however often the relay repeats the publish", async () => {
    const received: Message[] = [];
    await bus.subscribe("shop.cart.basket", async (m) => {
      received.push(m);
    });
    const one = message("11111111-1111-4111-8111-111111111111", "cart.BasketItemAdded");
    await bus.publish(one);
    await bus.publish(one);
    await until(() => received.length >= 1);
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(one);
  });

  it("keeps what was published while nobody was listening, for the subscriber that arrives later", async () => {
    const early = message("22222222-2222-4222-8222-222222222222", "cart.BasketCheckedOut");
    await bus.publish(early);

    const later = new NatsBus(`nats://${container?.getHost()}:${container?.getMappedPort(4222)}`, "oms-test");
    const received: Message[] = [];
    try {
      await later.subscribe("shop.cart.basket", async (m) => {
        received.push(m);
      });
      await until(() => received.some((m) => m.uuid === early.uuid));
    } finally {
      await later.close();
    }
  });
});

async function until(condition: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("gave up waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}
