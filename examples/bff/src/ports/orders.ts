// What the storefront needs from whoever owns the order.
import type { Line, Money } from "./baskets.ts";

export type OrderState = "PLACED" | "CONFIRMED" | "CANCELLED";

export interface Order {
  id: string;
  state: OrderState;
  lines: Line[];
  total: Money;
  placedAt: string;
}

export interface Orders {
  /** The order, or null when the estate has never been told of one. */
  byId(id: string): Promise<Order | null>;
  cancel(id: string, reason: string | null): Promise<Order>;
}
