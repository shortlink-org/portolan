/**
 * What the customer types into a carrier's site.
 *
 * The carrier owns the format; this only refuses what obviously cannot be one,
 * so that a typo is caught here rather than by a scan that never arrives.
 */
export class TrackingCode {
  readonly value: string;

  constructor(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length < 6) throw new Error("a tracking code is at least six characters");
    this.value = trimmed;
  }

  toString(): string {
    return this.value;
  }
}
