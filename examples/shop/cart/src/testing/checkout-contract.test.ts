import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { BasketCheckedOut } from "../domain/basket/events/basket-checked-out.ts";
import { LineItem } from "../domain/basket/vo/line-item.ts";
import { Money } from "../domain/basket/vo/money.ts";
import { toWire, TOPIC } from "../infrastructure/repository/basket/dto.ts";

it("publishes the checkout contract consumed by OMS", () => {
  const event = new BasketCheckedOut("basket-1", "customer-1", [new LineItem("tea", 2, Money.of(450, "EUR"))], Money.of(900, "EUR"), "quote-1", new Date("2026-09-05T12:00:00Z"));
  const expected = JSON.parse(readFileSync(new URL("../../../../scenarios/fixtures/basket-checked-out.json", import.meta.url), "utf8"));
  expect(TOPIC).toBe("shop.cart.basket");
  expect(event.name).toBe("cart.BasketCheckedOut");
  expect(JSON.parse(JSON.stringify(toWire(event)))).toEqual(expected);
});
