import { describe, expect, it } from "vitest";
import { PaymentCaptured } from "../../application/ledger/events.ts";
import { OrderConfirmed } from "../../application/oms/events.ts";
import { factOf, streamOf } from "./jetstream.ts";

describe("reading other services' facts off the bus", () => {
  it("translates the order service's confirmation into this service's words, leaving out what delivery does not read", () => {
    const fact = factOf("oms.OrderConfirmed", { orderId: "o-1", authorizationId: "o-1", occurredAt: "2026-09-15T10:00:00Z" });

    expect(fact).toBeInstanceOf(OrderConfirmed);
    expect(fact).toEqual(new OrderConfirmed("o-1"));
  });

  it("translates the ledger's capture", () => {
    const fact = factOf("ledger.PaymentCaptured", { paymentId: "o-1", orderId: "o-1", amount: { amountMinor: 900, currency: "EUR" } });

    expect(fact).toBeInstanceOf(PaymentCaptured);
    expect(fact).toEqual(new PaymentCaptured("o-1", "o-1"));
  });

  it("passes over an event it does not read", () => {
    expect(factOf("oms.OrderPlaced", { orderId: "o-1" })).toBeUndefined();
  });

  it("refuses a known event that arrives without what delivery reads, so it is delivered again rather than dropped", () => {
    expect(() => factOf("oms.OrderConfirmed", { authorizationId: "a-1" })).toThrow("oms.OrderConfirmed arrived without orderId");
    expect(() => factOf("ledger.PaymentCaptured", null)).toThrow("without paymentId");
  });

  it("names the publisher's stream by the rule the estate declares streams by", () => {
    expect(streamOf("shop.oms.order")).toEqual({ name: "shop-oms", subjects: "shop.oms.>" });
    expect(streamOf("payments.ledger.payment")).toEqual({ name: "payments-ledger", subjects: "payments.ledger.>" });
  });
});
