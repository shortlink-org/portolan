import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { UseCase as AddItem } from "../../../application/basket/usecases/add_item/usecase.ts";
import { UseCase as Checkout } from "../../../application/basket/usecases/checkout/usecase.ts";
import { UseCase as CreateBasket } from "../../../application/basket/usecases/create_basket/usecase.ts";
import { UseCase as GetBasket } from "../../../application/basket/usecases/get_basket/usecase.ts";
import { UseCase as MergeBaskets } from "../../../application/basket/usecases/merge_baskets/usecase.ts";
import { UseCase as RemoveItem } from "../../../application/basket/usecases/remove_item/usecase.ts";
import { MemoryBaskets, at, ids, sums, vouches } from "../../../testing/fakes.ts";
import { BasketHandlers } from "./basket/handlers.ts";
import { buildServer } from "./server.ts";

const now = at("2026-09-04T12:00:00Z");

function app() {
  const repo = new MemoryBaskets();
  const handlers = new BasketHandlers(
    new CreateBasket(repo, now, ids("11111111-1111-4111-8111-111111111111"), ids("tok")),
    new GetBasket(repo),
    new AddItem(repo, now),
    new RemoveItem(repo, now),
    new MergeBaskets(repo, vouches("u1"), now, ids(), ids()),
    new Checkout(repo, vouches("u1"), sums, now),
  );
  return buildServer(handlers);
}

describe("the routes", () => {
  it("run a basket from creation to checkout", async () => {
    const server = app();
    const created = await server.inject({ method: "POST", url: "/v1/baskets" });
    expect(created.statusCode).toBe(201);
    const { basketId, token } = created.json<{ basketId: string; token: string }>();

    const added = await server.inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/items`,
      headers: { "x-basket-token": token },
      payload: { sku: "a", quantity: 2, unitPrice: { amountMinor: 500, currency: "EUR" } },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json<{ subtotal: unknown }>().subtotal).toEqual({ amountMinor: 1000, currency: "EUR" });

    const other = await server.inject({
      method: "POST",
      url: `/v1/baskets/${basketId}/items`,
      headers: { "x-basket-token": token },
      payload: { sku: "b", quantity: 1, unitPrice: { amountMinor: 500, currency: "USD" } },
    });
    expect(other.statusCode).toBe(409);

    const out = await server.inject({ method: "POST", url: `/v1/baskets/${basketId}/checkout`, headers: { authorization: "Bearer session" } });
    expect(out.statusCode).toBe(200);
    expect(out.json<{ quoteId: string }>().quoteId).toBe(`q-${basketId}`);

    const again = await server.inject({ method: "GET", url: `/v1/baskets/${basketId}`, headers: { "x-basket-token": token } });
    expect(again.json<{ status: string }>().status).toBe("checked-out");
  });

  it("answers the same 404 for a missing basket and a wrong token", async () => {
    const server = app();
    const created = await server.inject({ method: "POST", url: "/v1/baskets" });
    const { basketId } = created.json<{ basketId: string }>();
    const wrong = await server.inject({ method: "GET", url: `/v1/baskets/${basketId}`, headers: { "x-basket-token": "nope" } });
    const missing = await server.inject({ method: "GET", url: "/v1/baskets/99999999-9999-4999-8999-999999999999", headers: { "x-basket-token": "nope" } });
    expect([wrong.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(wrong.json()).toEqual(missing.json());
  });

  it("refuses checkout without a bearer, and a bad body with 400", async () => {
    const server = app();
    const created = await server.inject({ method: "POST", url: "/v1/baskets" });
    const { basketId, token } = created.json<{ basketId: string; token: string }>();
    const noSession = await server.inject({ method: "POST", url: `/v1/baskets/${basketId}/checkout` });
    expect(noSession.statusCode).toBe(401);
    const bad = await server.inject({ method: "POST", url: `/v1/baskets/${basketId}/items`, headers: { "x-basket-token": token }, payload: { sku: "", quantity: 0 } });
    expect(bad.statusCode).toBe(400);
  });
});
