import { describe, expect, it } from "vitest";
import type { Aggregate, Service } from "../catalog";
import { triggersOf } from "./triggers";

const aggregate = (over: Partial<Aggregate>): Aggregate =>
  ({
    id: "shop.order.order",
    slug: "order",
    name: "Order",
    readme: "",
    entities: [],
    valueObjects: [],
    operations: [],
    events: [],
    ...over,
  }) as Aggregate;

const service = (aggregates: Aggregate[]): Service =>
  ({ id: "shop.order", slug: "order", aggregates }) as unknown as Service;

describe("triggersOf", () => {
  it("lists the operations that emit an event, then the lifecycle moves that announce it", () => {
    const order = aggregate({
      operations: [
        { id: "Place", kind: "command", emits: ["shop.order.order.Placed"] },
        { id: "Get", kind: "query" },
        { id: "Cancel", kind: "command", emits: ["shop.order.order.Cancelled"] },
      ],
      lifecycle: {
        states: ["draft", "placed"],
        transitions: [{ from: "draft", to: "placed", on: "place", emits: "shop.order.order.Placed" }],
      },
    });
    const got = triggersOf(service([order]), "shop.order.order.Placed");
    expect(got.map((t) => (t.kind === "operation" ? t.operation.id : t.transition.on))).toEqual([
      "Place",
      "place",
    ]);
  });

  it("answers nothing for an event nothing says it publishes", () => {
    const order = aggregate({ operations: [{ id: "Place", kind: "command" }] });
    expect(triggersOf(service([order]), "shop.order.order.Placed")).toEqual([]);
  });
});
