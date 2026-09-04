import { describe, expect, it } from "vitest";
import { Basket } from "./basket.ts";
import { BasketError } from "./errors.ts";
import { LineItem } from "./vo/line-item.ts";
import { Money } from "./vo/money.ts";
import { TRANSITIONS, type BasketStatus } from "./status.ts";

const now = new Date("2026-09-04T12:00:00Z");
const line = (sku: string, quantity = 1, price = 500, currency = "EUR") => new LineItem(sku, quantity, Money.of(price, currency));

function fresh(): Basket {
  const [basket] = Basket.create("b1", "t1", undefined, now);
  return basket;
}

function customers(): Basket {
  const [basket] = Basket.create("c1", "t2", "u1", now);
  return basket;
}

describe("a basket", () => {
  it("is created open and empty, and says so", () => {
    const [basket, created] = Basket.create("b1", "t1", undefined, now);
    expect(basket.status).toBe("open");
    expect(basket.items).toEqual([]);
    expect(created.name).toBe("cart.BasketCreated");
    expect(basket.subtotal()).toBeUndefined();
  });

  it("freezes its currency at the first line and refuses another", () => {
    const basket = fresh();
    basket.addItem(line("a", 1, 500, "EUR"), now);
    expect(basket.currency?.code).toBe("EUR");
    expect(() => basket.addItem(line("b", 1, 500, "USD"), now)).toThrowError(/EUR, not USD/);
    expect(basket.items).toHaveLength(1);
  });

  it("grows a line that exists rather than adding a second", () => {
    const basket = fresh();
    basket.addItem(line("a", 2), now);
    const added = basket.addItem(line("a", 3), now);
    expect(basket.items).toHaveLength(1);
    expect(added.quantity).toBe(5);
  });

  it("keeps the price it was given, whatever comes later", () => {
    const basket = fresh();
    basket.addItem(line("a", 1, 500), now);
    basket.addItem(line("a", 1, 900), now);
    expect(basket.items[0]?.unitPrice.amountMinor).toBe(500);
    expect(basket.subtotal()?.amountMinor).toBe(1000);
  });

  it("holds at most 99 of a SKU and 50 SKUs", () => {
    const basket = fresh();
    expect(() => basket.addItem(line("a", 100), now)).toThrowError(/at most 99/);
    for (let i = 0; i < 50; i++) basket.addItem(line(`sku-${i}`), now);
    expect(() => basket.addItem(line("one-more"), now)).toThrowError(/at most 50/);
    basket.addItem(line("sku-3"), now); // growing a line is not a new SKU
  });

  it("removes a line outright and forgets the currency with the last one", () => {
    const basket = fresh();
    basket.addItem(line("a"), now);
    const removed = basket.removeItem("a", now);
    expect(removed.sku).toBe("a");
    expect(basket.currency).toBeUndefined();
    expect(() => basket.removeItem("a", now)).toThrowError(BasketError);
  });

  it("checks out only with lines, and then changes no more", () => {
    const basket = fresh();
    expect(() => basket.checkout("c1", Money.of(0, "EUR"), "q1", now)).toThrowError(/empty/);
    basket.addItem(line("a", 2, 500), now);
    const out = basket.checkout("c1", Money.of(1000, "EUR"), "q1", now);
    expect(out.items).toHaveLength(1);
    expect(out.total.amountMinor).toBe(1000);
    expect(basket.status).toBe("checked-out");
    expect(() => basket.addItem(line("b"), now)).toThrowError(/checked-out/);
  });

  it("moves only along the table, and never out of a state the table closes", () => {
    const outOfOpen: Record<Exclude<BasketStatus, "open">, (b: Basket) => unknown> = {
      "checked-out": (b) => b.checkout("c1", Money.of(500, "EUR"), "q1", now),
      abandoned: (b) => b.abandon(now),
      merged: (b) => b.mergeInto(customers(), now),
    };
    for (const [next, move] of Object.entries(outOfOpen) as [Exclude<BasketStatus, "open">, (b: Basket) => unknown][]) {
      expect(TRANSITIONS.open).toContain(next);
      const basket = fresh();
      basket.addItem(line("a"), now);
      move(basket);
      expect(basket.status).toBe(next);
      // Closed is closed: nothing in the table leads out, and nothing in the code does either.
      expect(TRANSITIONS[next]).toEqual([]);
      for (const again of Object.values(outOfOpen)) expect(() => again(basket)).toThrowError(/cannot become/);
      expect(() => basket.addItem(line("b"), now)).toThrowError(BasketError);
    }
  });

  it("merges into a customer's basket and says which, not into a visitor's", () => {
    const basket = fresh();
    expect(() => basket.mergeInto(fresh(), now)).toThrowError(/visitor/);
    const merged = basket.mergeInto(customers(), now);
    expect(merged.intoBasketId).toBe("c1");
    expect(merged.customerId).toBe("u1");
    expect(basket.status).toBe("merged");
  });

  it("is abandoned with the moment it was last touched", () => {
    const basket = fresh();
    basket.addItem(line("a"), now);
    const later = new Date("2026-09-06T12:00:00Z");
    const abandoned = basket.abandon(later);
    expect(abandoned.idleSince).toEqual(now);
    expect(basket.status).toBe("abandoned");
  });
});
