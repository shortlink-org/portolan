import { describe, expect, it } from "vitest";
import { Basket } from "../../../domain/basket/basket.ts";
import { BasketError } from "../../../domain/basket/errors.ts";
import { LineItem } from "../../../domain/basket/vo/line-item.ts";
import { MemoryBaskets, at, ids, money, refuses, sums, vouches } from "../../../testing/fakes.ts";
import { UseCase as AddItem } from "./add_item/usecase.ts";
import { UseCase as Checkout } from "./checkout/usecase.ts";
import { UseCase as CreateBasket } from "./create_basket/usecase.ts";
import { UseCase as ExpireIdleBaskets } from "./expire_idle_baskets/usecase.ts";
import { UseCase as MergeBaskets } from "./merge_baskets/usecase.ts";

const now = at("2026-09-04T12:00:00Z");

function seeded(repo: MemoryBaskets, id: string, token: string, customerId?: string): Basket {
  const [basket] = Basket.create(id, token, customerId, now());
  repo.baskets.set(id, basket);
  return basket;
}

describe("create_basket", () => {
  it("hands back the id and the token, and says the basket exists", async () => {
    const repo = new MemoryBaskets();
    const out = await new CreateBasket(repo, now, ids("b1"), ids("t1")).handle();
    expect(out).toEqual({ basketId: "b1", token: "t1" });
    expect(repo.published.map((e) => e.name)).toEqual(["cart.BasketCreated"]);
  });
});

describe("add_item", () => {
  it("puts the line in for the holder of the token, and only the holder", async () => {
    const repo = new MemoryBaskets();
    seeded(repo, "b1", "t1");
    const uc = new AddItem(repo, now);
    const view = await uc.handle({ basketId: "b1", token: "t1", sku: "a", quantity: 2, unitPrice: { amountMinor: 500, currency: "EUR" } });
    expect(view.items).toEqual([{ sku: "a", quantity: 2, unitPrice: { amountMinor: 500, currency: "EUR" } }]);
    expect(view.subtotal).toEqual({ amountMinor: 1000, currency: "EUR" });
    await expect(uc.handle({ basketId: "b1", token: "wrong", sku: "a", quantity: 1, unitPrice: { amountMinor: 1, currency: "EUR" } })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("checkout", () => {
  it("confirms the session, takes the quote, freezes the basket and says so", async () => {
    const repo = new MemoryBaskets();
    const basket = seeded(repo, "b1", "t1");
    basket.addItem(new LineItem("a", 2, money(500)), now());
    const out = await new Checkout(repo, vouches("u1"), sums, now).handle({ basketId: "b1", bearer: "token" });
    expect(out).toEqual({ basketId: "b1", quoteId: "q-b1", total: { amountMinor: 1000, currency: "EUR" } });
    expect(basket.status).toBe("checked-out");
    expect(basket.customerId).toBe("u1");
    expect(repo.published.map((e) => e.name)).toEqual(["cart.BasketCheckedOut"]);
  });

  it("refuses without a live session, before touching the basket", async () => {
    const repo = new MemoryBaskets();
    const basket = seeded(repo, "b1", "t1");
    basket.addItem(new LineItem("a", 1, money(500)), now());
    await expect(new Checkout(repo, refuses(), sums, now).handle({ basketId: "b1", bearer: "x" })).rejects.toMatchObject({ code: "not-yours" });
    expect(basket.status).toBe("open");
    expect(repo.published).toEqual([]);
  });

  it("refuses another customer's basket", async () => {
    const repo = new MemoryBaskets();
    const basket = seeded(repo, "b1", "t1", "u2");
    basket.addItem(new LineItem("a", 1, money(500)), now());
    await expect(new Checkout(repo, vouches("u1"), sums, now).handle({ basketId: "b1", bearer: "x" })).rejects.toBeInstanceOf(BasketError);
  });
});

describe("merge_baskets", () => {
  it("moves every line into the customer's basket and marks the visitor's merged", async () => {
    const repo = new MemoryBaskets();
    const visitor = seeded(repo, "v1", "tv");
    visitor.addItem(new LineItem("a", 1, money(500)), now());
    visitor.addItem(new LineItem("b", 2, money(300)), now());
    const view = await new MergeBaskets(repo, vouches("u1"), now, ids("c1"), ids("tc")).handle({ bearer: "x", fromBasketId: "v1", fromToken: "tv" });
    expect(view.basketId).toBe("c1");
    expect(view.items.map((i) => i.sku)).toEqual(["a", "b"]);
    expect(visitor.status).toBe("merged");
    expect(repo.published.map((e) => e.name)).toEqual(["cart.BasketCreated", "cart.BasketItemAdded", "cart.BasketItemAdded", "cart.BasketMerged"]);
  });

  it("moves nothing when one line would break a rule", async () => {
    const repo = new MemoryBaskets();
    const visitor = seeded(repo, "v1", "tv");
    visitor.addItem(new LineItem("a", 1, money(500, "USD")), now());
    const mine = seeded(repo, "c1", "tc", "u1");
    mine.addItem(new LineItem("z", 1, money(100, "EUR")), now());
    await expect(new MergeBaskets(repo, vouches("u1"), now, ids(), ids()).handle({ bearer: "x", fromBasketId: "v1", fromToken: "tv" })).rejects.toMatchObject({ code: "refused" });
    expect(mine.items.map((i) => i.sku)).toEqual(["z"]);
    expect(visitor.status).toBe("open");
    expect(repo.published).toEqual([]);
  });
});

describe("expire_idle_baskets", () => {
  it("abandons what nobody touched for a day, and says so for each", async () => {
    const repo = new MemoryBaskets();
    seeded(repo, "old", "t1").touchedAt = new Date("2026-09-01T00:00:00Z");
    seeded(repo, "fresh", "t2");
    const out = await new ExpireIdleBaskets(repo, now).handle();
    expect(out).toEqual({ abandoned: 1 });
    expect(repo.baskets.get("old")?.status).toBe("abandoned");
    expect(repo.baskets.get("fresh")?.status).toBe("open");
    expect(repo.published.map((e) => e.name)).toEqual(["cart.BasketAbandoned"]);
  });
});
