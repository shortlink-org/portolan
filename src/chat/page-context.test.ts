import { describe, expect, it } from "vitest";
import type { PaletteItem } from "../lib/palette";
import { contextQuestions, pageContextFrom } from "./page-context";

const flow: PaletteItem = {
  kind: "flow",
  id: "flow.cart-checkout",
  name: "cart-checkout",
  detail: "Checkout",
  path: "/flows/cart-checkout",
  context: null,
};

const service: PaletteItem = {
  kind: "service",
  id: "shop.cart",
  name: "cart",
  detail: "shop.cart",
  path: "/c/shop/cart",
  context: "shop",
};

describe("pageContextFrom", () => {
  it("turns the exact entity route into model context", () => {
    expect(pageContextFrom([flow], "/flows/cart-checkout")).toEqual({
      kind: "flow",
      id: "flow.cart-checkout",
      title: "Checkout",
      docPath: "flows/cart-checkout.md",
    });
  });

  it("does not mistake an index or nested route for the entity", () => {
    expect(pageContextFrom([flow], "/flows")).toBeNull();
    expect(pageContextFrom([flow], "/flows/cart-checkout/extra")).toBeNull();
  });

  it("points a service at the markdown path from llms.txt", () => {
    expect(pageContextFrom([service], "/c/shop/cart")?.docPath).toBe(
      "shop/cart/README.md",
    );
  });
});

describe("contextQuestions", () => {
  it("keeps every flow starter anchored to the catalog id", () => {
    const page = pageContextFrom([flow], "/flows/cart-checkout");
    expect(page).not.toBeNull();
    expect(contextQuestions(page!).every((question) => question.includes(flow.id))).toBe(true);
  });
});
