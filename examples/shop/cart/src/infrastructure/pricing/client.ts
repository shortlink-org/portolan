// Pricing over its gRPC API, through the client Connect generates from the
// vendored proto. Reads the quote back into the port's own shape.
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { injectable } from "inversify";
import type { Pricing as PricingPort } from "../../application/basket/usecases/checkout/usecase.ts";
import type { LineItem } from "../../domain/basket/vo/line-item.ts";
import { Money } from "../../domain/basket/vo/money.ts";
import { Pricing } from "./gen/shop/v1/pricing_pb.ts";

@injectable()
export class PricingClient implements PricingPort {
  private readonly client: Client<typeof Pricing>;

  constructor(transport: Transport) {
    this.client = createClient(Pricing, transport);
  }

  async quote(basketId: string, lines: LineItem[]): Promise<{ quoteId: string; total: Money }> {
    const res = await this.client.getQuote({
      basketId,
      lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPrice: { amountMinor: BigInt(l.unitPrice.amountMinor), currency: l.unitPrice.currency.code } })),
    });
    if (!res.total) throw new Error("pricing answered with no total");
    return { quoteId: res.quoteId, total: Money.of(Number(res.total.amountMinor), res.total.currency) };
  }
}

/** The stand-in assembly uses without PRICING_ADDR: the quote is the sum of the lines (cart.0004). */
@injectable()
export class PermissivePricing implements PricingPort {
  async quote(basketId: string, lines: LineItem[]): Promise<{ quoteId: string; total: Money }> {
    const [first, ...rest] = lines;
    if (!first) throw new Error("nothing to price");
    const total = rest.reduce((sum, l) => sum.add(l.unitPrice.times(l.quantity)), first.unitPrice.times(first.quantity));
    return { quoteId: `local-${basketId}`, total };
  }
}
