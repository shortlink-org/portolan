import { describe, expect, it } from "vitest";
import type { ShipmentEvent, ShipmentRepository } from "../../../../domain/shipment/port.ts";
import { Shipment } from "../../../../domain/shipment/shipment.ts";
import { UseCase } from "./usecase.ts";

function store(shipment: Shipment) {
  const saved: ShipmentEvent[] = [];
  const repository = {
    byOrder: async () => shipment,
    save: async (_: Shipment, ...events: ShipmentEvent[]) => {
      saved.push(...events);
    },
  } as unknown as ShipmentRepository;
  return { repository, saved };
}

const at = new Date("2026-09-05T12:00:00Z");

describe("release_shipment", () => {
  it("releases a shipment that waits for the money", async () => {
    const [shipment] = Shipment.create("s-1", "o-1", at);
    const { repository, saved } = store(shipment);

    await new UseCase(repository, () => at).handle("o-1");

    expect(shipment.status).toBe("planned");
    expect(saved.map((e) => e.constructor.name)).toEqual(["ShipmentReleased"]);
  });

  it("leaves a released shipment alone when PaymentCaptured is said again (ledger.0004)", async () => {
    const [shipment] = Shipment.create("s-1", "o-1", at);
    const { repository, saved } = store(shipment);
    const release = new UseCase(repository, () => at);

    await release.handle("o-1");
    await release.handle("o-1");

    expect(shipment.status).toBe("planned");
    expect(saved).toHaveLength(1);
  });
});
