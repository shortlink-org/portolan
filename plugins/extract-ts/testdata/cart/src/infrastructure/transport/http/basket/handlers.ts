import { z } from "zod";
import type { UseCase as AddItem } from "@app/basket/usecases/add_item/usecase.ts";
import type { UseCase as Checkout } from "@app/basket/usecases/checkout/usecase.ts";
import type { UseCase as Expire } from "@app/basket/usecases/expire/usecase.ts";
import type { UseCase as Merge } from "@app/basket/usecases/merge/usecase.ts";

const money = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });
const basketParams = z.object({ basketId: z.string().uuid() });
const addItemBody = z.object({ sku: z.string().min(1), quantity: z.number().int().min(1).max(99), unitPrice: money });
const mergeBody = z.object({ fromBasketId: z.string().uuid(), fromToken: z.string().min(1).describe("the token the basket being merged in is held by") });

export class BasketHandlers {
  constructor(
    private readonly addItemUseCase: AddItem,
    private readonly checkoutUseCase: Checkout,
    private readonly mergeUseCase: Merge,
    private readonly expireUseCase: Expire,
  ) {}

  async addItem(req: { params: unknown; body: unknown }): Promise<void> {
    const { basketId } = basketParams.parse(req.params);
    const body = addItemBody.parse(req.body);
    await this.addItemUseCase.handle({ basketId, sku: body.sku, quantity: body.quantity, unitPrice: body.unitPrice as never });
  }

  async checkout(req: { basketId: string; token: string }): Promise<{ quoteId: string }> {
    return this.checkoutUseCase.handle({ basketId: req.basketId, token: req.token });
  }

  async mergeBaskets(req: { bearer: string; body: unknown }): Promise<void> {
    const body = mergeBody.parse(req.body);
    await this.mergeUseCase.handle({ bearer: req.bearer, fromBasketId: body.fromBasketId, fromToken: body.fromToken });
  }

  async expireIdleBaskets(): Promise<number> {
    return this.expireUseCase.handle();
  }
}
