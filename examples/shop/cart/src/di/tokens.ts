// The names a port is bound under. A symbol per port, in one place, so a use
// case names what it needs and the container names what fills it, and the
// two meet on a token neither invented alone.
export const TOKENS = {
  BasketRepository: Symbol.for("cart.BasketRepository"),
  Sessions: Symbol.for("cart.Sessions"),
  Pricing: Symbol.for("cart.Pricing"),
  Now: Symbol.for("cart.Now"),
  NewId: Symbol.for("cart.NewId"),
  NewToken: Symbol.for("cart.NewToken"),
  Pool: Symbol.for("cart.Pool"),
  Bus: Symbol.for("cart.Bus"),
} as const;

/** Clocks and generators are ports too; nothing is at the other end of them. */
export type Now = () => Date;
export type NewId = () => string;
export type NewToken = () => string;
