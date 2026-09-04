# Basket

*Generated from the portolan catalog · commit `2 sources` · at 2026-08-29T09:14:22Z. Do not edit by hand.*

- **Id:** `shop.oms.basket`
- **Service:** [Order Management](../README.md)
- **Root:** `Basket`

A short-lived container of line items belonging to one customer session.

## Lifetime

Baskets expire 24 hours after the last mutation. Expiry is a hard delete; there
is no archive. Anything worth keeping has already become an order.

## Commands

| Command           | Notes                                        |
| ----------------- | -------------------------------------------- |
| `AddItem`         | Merges quantity if the SKU is already present |
| `RemoveItem`      | Removing the last item leaves an empty basket |
| `CheckoutBasket`  | Freezes contents and emits the event          |

## Queries

`GetBasket` is served from the write store; baskets are too short-lived for
replication lag to be acceptable.

## Entities

### Basket — aggregate root

A customer's working basket. Lives until checkout, then becomes an order.

| Field | Type | Doc |
| --- | --- | --- |
| `id` | `string` | Basket id, one per customer session. |
| `customer` | [`CustomerRef`](../../../types.md#customerref) | Owner of the basket. |
| `items` | [`LineItem`](../../../types.md#lineitem) | Current contents. |
| `updatedAt` | `time.Time` | Last mutation, server time. |

## Value objects

### LineItem

A SKU, a quantity and the price it was added at. Replaced wholesale on change.

Shared type [`LineItem`](../../../types.md#lineitem).

| Field | Type | Doc |
| --- | --- | --- |
| `sku` | `string` | Catalog SKU at the time of ordering. |
| `quantity` | `int32` | Units ordered; always positive. |
| `unitPrice` | [`Money`](../../../types.md#money) | Price per unit, net of tax. |

### Money

An amount in a single currency.

Shared type [`Money`](../../../types.md#money).

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit of the currency. |
| `currency` | `string` | ISO 4217 code, upper case. |

## Operations

| Operation | Kind | Doc |
| --- | --- | --- |
| `AddItem` | command | Adds a SKU or increments one already there. The price is captured as the item is added and is not refreshed until checkout. |
| `RemoveItem` | command | Removes a line outright. Decrementing to zero is a removal, not a line with quantity zero. |
| `CheckoutBasket` | command | Freezes the basket and emits BasketCheckedOut. The basket stays readable for 24 hours afterwards so support can see what was actually submitted. |
| `GetBasket` | query | The working basket for one session. An expired basket comes back empty rather than as a 404 — the storefront has nothing useful to do with the difference. |

## Events

### BasketCheckedOut

`shop.oms.basket.BasketCheckedOut`

| Consumer | Status |
| --- | --- |
| [shop.pricing](../../pricing/README.md) | verified |

#### v1 — current

The customer submitted the basket. Precedes OrderPlaced by milliseconds.

Source: `internal/oms/domain/basket/events.go:33`

| Field | Type | Doc |
| --- | --- | --- |
| `basketId` | `string` | Basket being checked out. |
| `customer` | [`CustomerRef`](../../../types.md#customerref) | Who checked out. |
| `items` | [`LineItem`](../../../types.md#lineitem) | Basket contents at submission. |
