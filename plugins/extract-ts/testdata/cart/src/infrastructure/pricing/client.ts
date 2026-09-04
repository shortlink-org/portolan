import { createClient, type Client } from "@connectrpc/connect";
import { Pricing } from "./gen/shop/v1/pricing_pb.ts";
import { Money } from "../../domain/basket/vo/money.ts";
import type { Pricing as PricingPort } from "../../application/basket/usecases/checkout/usecase.ts";

/** Pricing over its gRPC API. */
export class PricingClient implements PricingPort {
  private readonly client: Client<typeof Pricing>;
  constructor(transport: unknown) {
    this.client = createClient(Pricing, transport as never);
  }

  async quote(basketId: string): Promise<{ quoteId: string; total: Money }> {
    const res = await this.client.getQuote({ basketId });
    return { quoteId: res.quoteId, total: new Money(Number(res.totalMinor), res.currency) };
  }
}
