import { describe, expect, it } from "vitest";
import { Shipment } from "./shipment.ts";
import { TrackingCode } from "./vo/tracking-code.ts";

const now = new Date("2026-09-15T10:00:00Z");

describe("a shipment created from a confirmed order", () => {
  it("waits for the money, with nothing packed and nowhere to go, and says it was created", () => {
    const [shipment, created] = Shipment.create("s-1", "o-1", now);

    expect(shipment.status).toBe("awaiting-payment");
    expect(shipment.parcels).toEqual([]);
    expect(shipment.shipTo).toBeUndefined();
    expect([created.name, created.shipmentId, created.orderId, created.occurredAt]).toEqual(["delivery.ShipmentCreated", "s-1", "o-1", now]);
  });

  it("is released by the money like any other", () => {
    const [shipment] = Shipment.create("s-1", "o-1", now);

    expect(shipment.release(now).name).toBe("delivery.ShipmentReleased");
    expect(shipment.status).toBe("planned");
  });

  it("is not planned onto a route without an address, nor handed to the carrier empty", () => {
    const [shipment] = Shipment.create("s-1", "o-1", now);
    shipment.release(now);

    expect(() => shipment.destination()).toThrow("has no address to plan a stop for");
    expect(() => shipment.dispatch(new TrackingCode("abc123xyz"), now)).toThrow("has no parcels to hand to the carrier");
    expect(shipment.status).toBe("planned");
  });
});
