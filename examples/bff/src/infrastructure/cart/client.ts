// The basket over the cart's HTTP API.
//
// The cart says `basketId`, `items` and `checked-out`; the storefront says
// `id`, `lines` and `CHECKED_OUT`. Both are right, and this is the file where
// one becomes the other - the whole reason a BFF exists is that a client
// should not have to know both.
import createClient, { type Client } from "openapi-fetch";
import type { Basket, Baskets, Checkout, Line } from "../../ports/baskets.ts";
import { PeerError } from "../errors.ts";
import type { components, paths } from "./gen/types.ts";

type CartBasket = components["schemas"]["Basket"];

const STATUS = {
  open: "OPEN",
  "checked-out": "CHECKED_OUT",
  abandoned: "ABANDONED",
  merged: "MERGED",
} as const;

export class CartBaskets implements Baskets {
  private readonly client: Client<paths>;

  constructor(baseUrl: string) {
    this.client = createClient<paths>({ baseUrl });
  }

  async byId(bearer: string, basketId: string): Promise<Basket | null> {
    const { data, response } = await this.client.GET("/v1/baskets/{basketId}", {
      params: { path: { basketId } },
      headers: bearerHeader(bearer),
    });
    if (response.status === 404) return null;
    if (!data) throw new PeerError("cart", `answered ${response.status}`);

    return basket(data);
  }

  async addItem(bearer: string, basketId: string, line: Line): Promise<Basket> {
    const { data, response } = await this.client.POST("/v1/baskets/{basketId}/items", {
      params: { path: { basketId } },
      headers: bearerHeader(bearer),
      body: { sku: line.sku, quantity: line.quantity, unitPrice: line.unitPrice },
    });
    if (!data) throw new PeerError("cart", `answered ${response.status}`);

    return basket(data);
  }

  async removeItem(bearer: string, basketId: string, sku: string): Promise<Basket> {
    const { data, response } = await this.client.DELETE("/v1/baskets/{basketId}/items/{sku}", {
      params: { path: { basketId, sku } },
      headers: bearerHeader(bearer),
    });
    if (!data) throw new PeerError("cart", `answered ${response.status}`);

    return basket(data);
  }

  async checkout(bearer: string, basketId: string): Promise<Checkout> {
    const { data, response } = await this.client.POST("/v1/baskets/{basketId}/checkout", {
      params: { path: { basketId } },
      headers: bearerHeader(bearer),
    });
    if (!data) throw new PeerError("cart", `answered ${response.status}`);

    return { basketId: data.basketId, quoteId: data.quoteId, total: data.total };
  }
}

function bearerHeader(bearer: string): Record<string, string> {
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

function basket(read: CartBasket): Basket {
  return {
    id: read.basketId,
    status: STATUS[read.status],
    lines: read.items.map((item) => ({ sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice })),
    subtotal: read.subtotal ?? null,
  };
}
