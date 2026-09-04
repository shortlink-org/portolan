/**
 * One box. A shipment is one or more of them, and each is scanned on its own -
 * which is why a parcel is an entity: it is followed over time, not compared.
 */
export class Parcel {
  readonly id: string;
  readonly weightG: number;
  readonly contents: string;

  constructor(id: string, weightG: number, contents: string) {
    if (weightG <= 0) throw new Error("a parcel weighs something");
    this.id = id;
    this.weightG = weightG;
    this.contents = contents;
  }
}
