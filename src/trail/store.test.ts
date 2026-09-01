import { beforeEach, describe, expect, it } from "vitest";
import type { Visit } from "./model";
import { MAX_VISITS, useTrailStore } from "./store";

const store = () => useTrailStore.getState();
const paths = () => store().visits.map((v) => v.path);

const visit = (path: string, id?: string): Visit => ({
  path,
  selection: id ? { kind: "event", id } : null,
});

beforeEach(() => {
  useTrailStore.setState({ visits: [] });
});

describe("trail store", () => {
  it("keeps the most recent first", () => {
    store().record(visit("/c/shop"));
    store().record(visit("/c/shop/oms"));
    expect(paths()).toEqual(["/c/shop/oms", "/c/shop"]);
  });

  /**
   * A reader who goes back to an event they were on an hour ago has just made
   * it the freshest thing in their head, not a second copy of it.
   */
  it("moves a page already in the trail to the front", () => {
    store().record(visit("/c/shop"));
    store().record(visit("/c/shop/oms"));
    store().record(visit("/c/shop"));
    expect(paths()).toEqual(["/c/shop", "/c/shop/oms"]);
  });

  it("keeps the newest selection for a page it already holds", () => {
    store().record(visit("/flows/checkout"));
    store().record(visit("/flows/checkout", "checkout/a1"));
    expect(store().visits).toHaveLength(1);
    expect(store().visits[0]?.selection?.id).toBe("checkout/a1");
  });

  it("holds no more than the strip can be glanced at", () => {
    for (let i = 0; i < MAX_VISITS + 3; i++) store().record(visit(`/c/c${i}`));
    expect(store().visits).toHaveLength(MAX_VISITS);
    expect(paths()[0]).toBe(`/c/c${MAX_VISITS + 2}`);
    expect(paths().at(-1)).toBe("/c/c3");
  });

  /**
   * The recorder fires on every settled render, so the common case is a write
   * that changes nothing. It must not notify, or the strip re-renders behind
   * a reader who has not moved.
   */
  it("ignores a write that repeats the head", () => {
    store().record(visit("/c/shop/oms", "shop.oms.order.OrderPlaced"));
    const before = useTrailStore.getState();
    store().record(visit("/c/shop/oms", "shop.oms.order.OrderPlaced"));
    expect(useTrailStore.getState()).toBe(before);
  });

  it("clears", () => {
    store().record(visit("/c/shop"));
    store().clear();
    expect(store().visits).toEqual([]);
  });
});
