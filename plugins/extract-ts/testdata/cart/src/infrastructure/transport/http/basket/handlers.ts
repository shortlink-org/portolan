import type { UseCase as AddItem } from "../../../../application/basket/usecases/add_item/usecase.ts";
import type { UseCase as Checkout } from "../../../../application/basket/usecases/checkout/usecase.ts";
import type { UseCase as Expire } from "../../../../application/basket/usecases/expire/usecase.ts";
import type { UseCase as Merge } from "../../../../application/basket/usecases/merge/usecase.ts";

export class BasketHandlers {
  constructor(
    private readonly addItemUseCase: AddItem,
    private readonly checkoutUseCase: Checkout,
    private readonly mergeUseCase: Merge,
    private readonly expireUseCase: Expire,
  ) {}

  async addItem(req: { basketId: string; body: { sku: string; quantity: number; unitPrice: { amountMinor: number; currency: string } } }): Promise<void> {
    await this.addItemUseCase.handle({ basketId: req.basketId, sku: req.body.sku, quantity: req.body.quantity, unitPrice: req.body.unitPrice as never });
  }

  async checkout(req: { basketId: string; token: string }): Promise<{ quoteId: string }> {
    return this.checkoutUseCase.handle({ basketId: req.basketId, token: req.token });
  }

  async mergeBaskets(req: { bearer: string; body: { fromBasketId: string; fromToken: string } }): Promise<void> {
    await this.mergeUseCase.handle({ bearer: req.bearer, fromBasketId: req.body.fromBasketId, fromToken: req.body.fromToken });
  }

  async expireIdleBaskets(): Promise<number> {
    return this.expireUseCase.handle();
  }
}
