import { describe, expect, it } from "vitest";
import { neighborhood, neighborhoodCss } from "./neighborhood";

const nodes = [
  { id: "shop" }, { id: "shop.cart", parent: "shop" },
  { id: "shop.orders", parent: "shop" }, { id: "shop.db", parent: "shop" },
  { id: "payments" }, { id: "payments.ledger", parent: "payments" },
  { id: "stripe" }, { id: "isolated" },
];
const edges = [
  { id: "owns", source: "shop.cart", target: "shop.db" },
  { id: "call", source: "shop.cart", target: "payments.ledger" },
  { id: "charge", source: "payments.ledger", target: "stripe" },
];

describe("C4 neighborhood", () => {
  it("keeps exactly one hop, stores and both enclosing contexts", () => {
    const result = neighborhood(nodes, edges, "shop.cart")!;
    expect(new Set(result.nodes)).toEqual(new Set(["shop.cart", "shop.db", "payments.ledger", "shop", "payments"]));
    expect(result.edges).toEqual(["owns", "call"]);
  });
  it("focuses a context through its children without recursively following neighbours", () => {
    const result = neighborhood(nodes, edges, "shop")!;
    expect(result.nodes).toContain("shop.orders");
    expect(result.nodes).not.toContain("stripe");
  });
  it("handles isolated and absent selections", () => {
    expect(neighborhood(nodes, edges, "isolated")).toEqual({ nodes: ["isolated"], edges: [] });
    expect(neighborhood(nodes, edges, "missing")).toBeNull();
  });
  it("dims disconnected edges even for an isolated selection, including portal labels", () => {
    const css = neighborhoodCss({ nodes: ["isolated"], edges: [] }, edges.map((edge) => edge.id), "isolated");
    expect(css).toContain(".react-flow__edge { opacity: .12; }");
    expect(css).toContain(".react-flow__edgelabel-renderer > :nth-child(3)");
    expect(css).not.toMatch(/display:|transform:|position:|width:|height:/);
  });
});
