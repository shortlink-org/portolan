import { Scan } from "../../../../domain/shipment/scan.ts";
import type { ShipmentRepository } from "../../../../domain/shipment/port.ts";

/** Writes down that a parcel was seen somewhere. */
export class UseCase {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly now: () => Date,
  ) {}

  /**
   * A scan is appended, never corrected: a wrong one is followed by a right
   * one, and the pair is the history.
   */
  async handle(shipmentId: string, parcelId: string, location: string): Promise<void> {
    const shipment = await this.shipments.byId(shipmentId);
    shipment.record(new Scan(parcelId, location, this.now()));
    await this.shipments.save(shipment);
  }
}
