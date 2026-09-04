/**
 * When a van is expected somewhere, as the two ends of a promise to a person.
 */
export class Window {
  readonly from: Date;
  readonly to: Date;

  constructor(from: Date, to: Date) {
    if (to.getTime() <= from.getTime()) throw new Error("a window ends after it starts");
    this.from = from;
    this.to = to;
  }

  contains(at: Date): boolean {
    return at.getTime() >= this.from.getTime() && at.getTime() <= this.to.getTime();
  }
}
