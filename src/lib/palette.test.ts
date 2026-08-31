import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { paletteItems, search } from "./palette";
import { isRoutable } from "../routes";
import { allEvents } from "../catalog";

const items = paletteItems(catalog);
const kinds = (raw: string) =>
  new Set(search(items, raw).items.map((i) => i.kind));

describe("palette index", () => {
  it("indexes every kind, and every row goes somewhere real", () => {
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set([
        "def",
        "context",
        "service",
        "aggregate",
        "event",
        "vo",
        "entity",
        "command",
        "query",
        "flow",
        "adr",
      ]),
    );
    for (const item of items) {
      // Shared types are the one kind with no page; everything else routes.
      if (item.path === null) {
        expect(item.kind, item.id).toBe("def");
        continue;
      }
      expect(isRoutable(item.path), `${item.id} -> ${item.path}`).toBe(true);
    }
  });

  it("gives every row a unique id, so rows never collide as keys", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("indexes one row per event, badged with its latest version", () => {
    const events = items.filter((i) => i.kind === "event");
    expect(events).toHaveLength(allEvents(catalog).length);
    const placed = events.find((e) => e.id === "shop.oms.order.OrderPlaced");
    expect(placed?.badge).toBe("v2");
  });

  it("marks selectable rows, and only those the selection model resolves", () => {
    const selectable = new Set(
      items.filter((i) => i.selectId).map((i) => i.kind),
    );
    expect(selectable).toEqual(
      new Set(["context", "service", "aggregate", "event", "def"]),
    );
    // A value object has a page but is not a selectable entity; it navigates.
    const money = items.find((i) => i.id === "shop.oms.order.money");
    expect(money?.selectId).toBeUndefined();
    expect(money?.path).toBe("/c/shop/oms/order/vo/money");
  });

  it("lists a shared type apart from the value objects that name it", () => {
    const def = items.find((i) => i.id === "def:Money");
    expect(def?.kind).toBe("def");
    expect(def?.selectId).toBe("Money");
    expect(def?.path).toBeNull();
    const vos = items.filter((i) => i.kind === "vo" && i.name === "Money");
    expect(vos.length).toBeGreaterThan(1);
  });

  it("badges the entity an aggregate calls its root", () => {
    const order = items.find((i) => i.id === "shop.oms.order.order");
    expect(order?.kind).toBe("entity");
    expect(order?.badge).toBe("root");
  });
});

describe("prefix filters", () => {
  it("restricts to one kind and searches within it", () => {
    expect(kinds("e: order")).toEqual(new Set(["event"]));
    expect(kinds("vo: money")).toEqual(new Set(["vo"]));
    expect(kinds("agg:")).toEqual(new Set(["aggregate"]));
    expect(kinds("cmd: place")).toEqual(new Set(["command"]));
    expect(kinds("q: get")).toEqual(new Set(["query"]));
    expect(kinds("type: money")).toEqual(new Set(["def"]));
  });

  it("finds the value objects called Money and not the events holding one", () => {
    const result = search(items, "vo: money");
    expect(result.items.length).toBeGreaterThan(1);
    expect(result.items.every((i) => i.name === "Money")).toBe(true);
    // Money is a shared kernel type: several aggregates name it.
    expect(new Set(result.items.map((i) => i.detail)).size).toBe(
      result.items.length,
    );
  });

  it("echoes the parse back so the palette can show what it understood", () => {
    const result = search(items, "e: item");
    expect(result.kind).toBe("event");
    expect(result.prefix).toBe("e");
    expect(result.term).toBe("item");
  });
});

describe("ranking", () => {
  it("puts an exact name above a partial one", () => {
    const first = search(items, "Money").items[0];
    expect(first?.name).toBe("Money");
  });

  it("prefers a name match to an id or owner match", () => {
    const result = search(items, "OrderPlaced");
    expect(result.items[0]?.id).toBe("shop.oms.order.OrderPlaced");
  });

  it("matches at word boundaries inside a camelCase name", () => {
    const names = search(items, "cmd: item").items.map((i) => i.name);
    expect(names).toContain("AddItem");
    expect(names).toContain("RemoveItem");
  });

  it("returns nothing rather than everything for a miss", () => {
    const result = search(items, "zzzzz");
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(0);
  });

  it("reports what the limit dropped", () => {
    const result = search(items, "", 5);
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(items.length - 5);
  });
});
