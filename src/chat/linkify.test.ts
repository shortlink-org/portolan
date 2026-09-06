import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

const links = new Map([
  ["shop.oms", "/p/c/shop/oms"],
  ["shop.oms.order", "/p/c/shop/oms/order"],
  ["payments", "/p/c/payments"],
]);

describe("linkify", () => {
  it("links a bare id and one in backticks", () => {
    expect(linkify("Ask shop.oms first.", links)).toBe("Ask [shop.oms](/p/c/shop/oms) first.");
    expect(linkify("Ask `shop.oms` first.", links)).toBe("Ask [`shop.oms`](/p/c/shop/oms) first.");
  });

  it("takes the longest id and leaves paths and longer words alone", () => {
    expect(linkify("shop.oms.order holds it", links)).toBe("[shop.oms.order](/p/c/shop/oms/order) holds it");
    expect(linkify("see docs/shop.oms/README.md", links)).toBe("see docs/shop.oms/README.md");
    expect(linkify("payments-ledger", links)).toBe("payments-ledger");
  });

  it("does not touch fenced code or existing links", () => {
    expect(linkify("```\nshop.oms\n```", links)).toBe("```\nshop.oms\n```");
    expect(linkify("[shop.oms](/x)", links)).toBe("[shop.oms](/x)");
  });

  it("is a no-op without ids", () => {
    expect(linkify("shop.oms", new Map())).toBe("shop.oms");
  });
});
