import { describe, expect, it, vi } from "vitest";
import { PaymentCaptured } from "../ledger/events.ts";
import { OrderConfirmed } from "../oms/events.ts";
import type { UseCase as CreateShipment } from "../shipment/usecases/create_shipment/usecase.ts";
import { CreateShipmentOnOrderConfirmed } from "./create-shipment-on-order-confirmed.ts";

function useCase(failure?: Error) {
  const handle = vi.fn(async (orderId: string) => {
    if (failure) throw failure;
    return { shipmentId: "s-1", payment: "captured" as const, orderId };
  });
  return { create: { handle } as unknown as CreateShipment, handle };
}

describe("CreateShipmentOnOrderConfirmed", () => {
  it("runs create_shipment for the confirmed order", async () => {
    const { create, handle } = useCase();

    await new CreateShipmentOnOrderConfirmed(create).handle(new OrderConfirmed("o-1"));

    expect(handle).toHaveBeenCalledExactlyOnceWith("o-1");
  });

  it("leaves any other fact alone", async () => {
    const { create, handle } = useCase();

    await new CreateShipmentOnOrderConfirmed(create).handle(new PaymentCaptured("o-1", "o-1"));

    expect(handle).not.toHaveBeenCalled();
  });

  it("hands a failure back to whatever delivered the fact, so it is delivered again", async () => {
    const { create } = useCase(new Error("ledger unavailable"));

    await expect(new CreateShipmentOnOrderConfirmed(create).handle(new OrderConfirmed("o-1"))).rejects.toThrow("ledger unavailable");
  });
});
