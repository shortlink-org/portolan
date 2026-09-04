/**
 * One sighting of one parcel: where it was and when.
 *
 * Append-only. A scan is never corrected - a wrong one is followed by a right
 * one, and the pair is the history.
 */
export class Scan {
  readonly parcelId: string;
  readonly location: string;
  readonly scannedAt: Date;

  constructor(parcelId: string, location: string, scannedAt: Date) {
    this.parcelId = parcelId;
    this.location = location;
    this.scannedAt = scannedAt;
  }
}
