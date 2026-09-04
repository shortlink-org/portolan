// The policy: which rules currently apply when a line goes in. Each rule is
// one file beside this one; this is the list.
import type { Currency } from "../vo/currency.ts";
import type { LineItem } from "../vo/line-item.ts";
import { currencyIsFrozen } from "./currency.ts";
import { linesAreFew } from "./lines.ts";
import { quantityIsSane } from "./quantity.ts";

export interface AddContext {
  currency: Currency | undefined;
  distinct: number;
  already: number;
  isNew: boolean;
}

/** The first refusal, or null when the line may go in. */
export function whyNotAdd(line: LineItem, ctx: AddContext): string | null {
  return quantityIsSane(line, ctx.already) ?? linesAreFew(ctx.distinct, ctx.isNew) ?? currencyIsFrozen(ctx.currency, line);
}
