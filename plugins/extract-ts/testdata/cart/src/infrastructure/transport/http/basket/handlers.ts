import type { UseCase as AddItem } from "../../../../application/basket/usecases/add_item/usecase.ts";
import type { UseCase as Checkout } from "../../../../application/basket/usecases/checkout/usecase.ts";

export class BasketHandlers {
  constructor(
    private readonly addItemUseCase: AddItem,
    private readonly checkoutUseCase: Checkout,
  ) {}

  async addItem(req: { basketId: string; body: { sku: string; quantity: number; unitPrice: { amountMinor: number; currency: string } } }): Promise<void> {
    await this.addItemUseCase.handle({ basketId: req.basketId, sku: req.body.sku, quantity: req.body.quantity, unitPrice: req.body.unitPrice as never });
  }

  async checkout(req: { basketId: string; token: string }): Promise<{ quoteId: string }> {
    return this.checkoutUseCase.handle({ basketId: req.basketId, token: req.token });
  }
}
