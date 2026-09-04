/**
 * Where a parcel is going, as the warehouse needs it.
 *
 * A value: two addresses with the same lines are the same address. It is a copy
 * of what the order said at dispatch and is never refreshed - a parcel already
 * on a van does not move because somebody edited their profile.
 */
export class Address {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly postcode: string;
  readonly country: string;

  constructor(line1: string, line2: string, city: string, postcode: string, country: string) {
    if (country.length !== 2) throw new Error("a country is two letters of ISO 3166");
    this.line1 = line1;
    this.line2 = line2;
    this.city = city;
    this.postcode = postcode;
    this.country = country;
  }

  /** One line, the way a label prints it. */
  toString(): string {
    return [this.line1, this.line2, this.city, this.postcode, this.country].filter(Boolean).join(", ");
  }
}
