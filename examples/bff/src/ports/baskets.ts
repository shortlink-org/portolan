// What the storefront needs from whoever holds the basket.
export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Line {
  sku: string;
  quantity: number;
  unitPrice: Money;
}

export interface Basket {
  id: string;
  status: "OPEN" | "CHECKED_OUT" | "ABANDONED" | "MERGED";
  lines: Line[];
  subtotal: Money | null;
}

export interface Checkout {
  basketId: string;
  quoteId: string;
  total: Money;
}

export interface Baskets {
  /** The basket as it stands, or null when there is no such basket to show. */
  byId(bearer: string, basketId: string): Promise<Basket | null>;
  addItem(bearer: string, basketId: string, line: Line): Promise<Basket>;
  removeItem(bearer: string, basketId: string, sku: string): Promise<Basket>;
  checkout(bearer: string, basketId: string): Promise<Checkout>;
}
