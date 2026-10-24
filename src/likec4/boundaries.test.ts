import { describe, expect, it } from "vitest";
import { boundaryEdgeIds } from "./boundaries";

const nodes = [
  { id: "shop", kind: "context" },
  { id: "shop.cart", parent: "shop", kind: "service" },
  { id: "shop.db", parent: "shop", kind: "store" },
  { id: "payments", kind: "context" },
  { id: "payments.ledger", parent: "payments", kind: "service" },
  { id: "bus", kind: "broker" },
  { id: "stripe", kind: "external" },
];

const edges = [
  { id: "owns", source: "shop.cart", target: "shop.db" },
  { id: "call", source: "shop.cart", target: "payments.ledger" },
  { id: "publish", source: "shop.cart", target: "bus" },
  { id: "deliver", source: "bus", target: "payments.ledger" },
  { id: "charge", source: "payments.ledger", target: "stripe" },
];

describe("diagram boundary crossings", () => {
  it("finds direct, broker-mediated and external crossings without internal ownership", () => {
    expect(boundaryEdgeIds(nodes, edges)).toEqual(["call", "publish", "deliver", "charge"]);
  });

  it("limits a context diagram to communication crossing that context", () => {
    expect(boundaryEdgeIds(nodes, edges, "shop")).toEqual(["call", "publish", "deliver"]);
    expect(boundaryEdgeIds(nodes, edges, "payments")).toEqual(["call", "publish", "deliver", "charge"]);
  });
});
