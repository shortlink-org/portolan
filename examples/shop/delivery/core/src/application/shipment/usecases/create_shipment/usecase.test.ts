import { describe, expect, it, vi } from "vitest";
import type { ShipmentEvent, ShipmentRepository } from "../../../../domain/shipment/port.ts";
import { Shipment } from "../../../../domain/shipment/shipment.ts";
import { type Capture, type Payments, UseCase } from "./usecase.ts";

const now = new Date("2026-09-15T10:00:00Z");

/** The store as the use case sees it: what it holds for the order, and what was saved, in order. */
function store(existing?: Shipment) {
  const saved: { shipment: Shipment; events: ShipmentEvent[] }[] = [];
  const calls: string[] = [];
  const shipments: ShipmentRepository = {
    save: async (shipment, ...events) => {
      calls.push("save");
      saved.push({ shipment, events });
    },
    byId: async () => { throw new Error("not used"); },
    byTracking: async () => { throw new Error("not used"); },
    byOrder: async () => { throw new Error("not used"); },
    findByOrder: async () => existing,
  };
  return { shipments, saved, calls };
}

function ledger(answer: Capture | Error, calls: string[] = []) {
  const capture = vi.fn(async (_paymentId: string) => {
    calls.push("capture");
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const payments: Payments = { capture };
  return { payments, capture };
}

describe("create_shipment", () => {
  it("stores a shipment waiting for the money, then asks the ledger to capture the payment named by the order", async () => {
    const { shipments, saved, calls } = store();
    const { payments, capture } = ledger({ outcome: "captured" }, calls);

    const result = await new UseCase(shipments, payments, () => now, () => "s-1").handle("o-1");

    expect(result).toEqual({ shipmentId: "s-1", payment: "captured" });
    expect(calls).toEqual(["save", "capture"]);
    expect(capture).toHaveBeenCalledWith("o-1");
    expect(saved[0]?.shipment.status).toBe("awaiting-payment");
    expect(saved[0]?.events.map((e) => [e.name, e.shipmentId, e.orderId, e.occurredAt])).toEqual([["delivery.ShipmentCreated", "s-1", "o-1", now]]);
  });

  it("does not make a second shipment for a repeated confirmation, and asks again while the first still waits", async () => {
    const waiting = new Shipment("s-1", "o-1", undefined, []);
    const { shipments, saved } = store(waiting);
    const { payments, capture } = ledger({ outcome: "captured" });

    const result = await new UseCase(shipments, payments, () => now, () => "s-2").handle("o-1");

    expect(result).toEqual({ shipmentId: "s-1", payment: "captured" });
    expect(saved).toEqual([]);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("does not ask the ledger for a shipment the money already released", async () => {
    const [released] = Shipment.create("s-1", "o-1", now);
    released.release(now);
    const { shipments, saved } = store(released);
    const { payments, capture } = ledger({ outcome: "captured" });

    const result = await new UseCase(shipments, payments, () => now, () => "s-2").handle("o-1");

    expect(result).toEqual({ shipmentId: "s-1", payment: "not-asked" });
    expect(saved).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("answers with the ledger's refusal and leaves the shipment waiting", async () => {
    const { shipments, saved } = store();
    const { payments } = ledger({ outcome: "refused", reason: "not-capturable" });

    const result = await new UseCase(shipments, payments, () => now, () => "s-1").handle("o-1");

    expect(result).toEqual({ shipmentId: "s-1", payment: "not-capturable" });
    expect(saved.map((s) => s.shipment.status)).toEqual(["awaiting-payment"]);
  });

  it("fails when the ledger cannot be reached, with the shipment already stored for the retry to find", async () => {
    const { shipments, saved } = store();
    const { payments } = ledger(new Error("ledger unavailable"));

    await expect(new UseCase(shipments, payments, () => now, () => "s-1").handle("o-1")).rejects.toThrow("ledger unavailable");
    expect(saved).toHaveLength(1);
  });
});
