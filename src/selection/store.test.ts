import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "./store";

const store = () => useSelectionStore.getState();

beforeEach(() => {
  useSelectionStore.setState({ selection: null, source: null });
});

describe("selection store", () => {
  it("derives the kind rather than taking it from the caller", () => {
    store().select("shop.oms.order.OrderPlaced", "sidebar");
    expect(store().selection).toEqual({
      kind: "event",
      id: "shop.oms.order.OrderPlaced",
    });
    expect(store().source).toBe("sidebar");
  });

  it("holds one selection at a time", () => {
    store().select("shop.oms", "sidebar");
    store().select("payments.ledger", "palette");
    expect(store().selection?.id).toBe("payments.ledger");
    expect(store().source).toBe("palette");
  });

  it("clears", () => {
    store().select("shop.oms", "sidebar");
    store().clear("panel");
    expect(store().selection).toBeNull();
    expect(store().source).toBe("panel");
  });

  /**
   * A diagram that echoes its own click back must not start a render loop, so
   * an identical write from the same panel is dropped whole - state identity
   * included, which is what stops zustand notifying.
   */
  it("ignores an identical write from the same source", () => {
    store().select("shop.oms", "diagram");
    const before = useSelectionStore.getState();
    store().select("shop.oms", "diagram");
    expect(useSelectionStore.getState()).toBe(before);
  });

  /**
   * The same entity re-selected from somewhere else is not a no-op: the
   * diagram decides whether to mark its canvas on exactly that difference.
   */
  it("records a new source for the same entity", () => {
    store().select("shop.oms", "diagram");
    store().select("shop.oms", "sidebar");
    expect(store().source).toBe("sidebar");
    expect(store().selection?.id).toBe("shop.oms");
  });

  it("accepts a pre-parsed selection from a URL", () => {
    store().set({ kind: "event", id: "shop.oms.order.OrderPlaced" }, "url");
    expect(store().selection?.kind).toBe("event");
    expect(store().source).toBe("url");
  });
});
