import type { Currency } from "../vo/currency.ts";
import type { LineItem } from "../vo/line-item.ts";

/** The first line sets the currency; a line in another is refused, not converted (cart.0002). */
export function currencyIsFrozen(current: Currency | undefined, line: LineItem): string | null {
  if (current && !current.equals(line.unitPrice.currency)) return `the basket is in ${current.code}, not ${line.unitPrice.currency.code}`;
  return null;
}
