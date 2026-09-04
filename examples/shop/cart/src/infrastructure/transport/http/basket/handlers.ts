// The handlers, one per operationId in gen/openapi.yaml, each running the
// use case it is named for. Nothing here decides a route or a shape: the
// document does, and this only carries what came in to the use case and what
// came back to the reply.
import type { FastifyReply, FastifyRequest } from "fastify";
import { inject, injectable } from "inversify";
import { z } from "zod";
import { UseCase as AddItem } from "../../../../application/basket/usecases/add_item/usecase.ts";
import { UseCase as Checkout } from "../../../../application/basket/usecases/checkout/usecase.ts";
import { UseCase as CreateBasket } from "../../../../application/basket/usecases/create_basket/usecase.ts";
import { UseCase as GetBasket } from "../../../../application/basket/usecases/get_basket/usecase.ts";
import { UseCase as MergeBaskets } from "../../../../application/basket/usecases/merge_baskets/usecase.ts";
import { UseCase as RemoveItem } from "../../../../application/basket/usecases/remove_item/usecase.ts";
import { basketToken, bearer } from "../auth.ts";

const money = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });
const addItemBody = z.object({ sku: z.string().min(1), quantity: z.number().int().min(1).max(99), unitPrice: money });
const mergeBody = z.object({ fromBasketId: z.string().uuid(), fromToken: z.string().min(1) });
const basketParams = z.object({ basketId: z.string().uuid() });
const itemParams = basketParams.extend({ sku: z.string().min(1) });

@injectable()
export class BasketHandlers {
  constructor(
    @inject(CreateBasket) private readonly createBasketUseCase: CreateBasket,
    @inject(GetBasket) private readonly getBasketUseCase: GetBasket,
    @inject(AddItem) private readonly addItemUseCase: AddItem,
    @inject(RemoveItem) private readonly removeItemUseCase: RemoveItem,
    @inject(MergeBaskets) private readonly mergeBasketsUseCase: MergeBaskets,
    @inject(Checkout) private readonly checkoutUseCase: Checkout,
  ) {}

  async createBasket(_req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const out = await this.createBasketUseCase.handle();
    return reply.code(201).send(out);
  }

  async getBasket(req: FastifyRequest): Promise<unknown> {
    const { basketId } = basketParams.parse(req.params);
    return this.getBasketUseCase.handle({ basketId, token: basketToken(req) });
  }

  async addItem(req: FastifyRequest): Promise<unknown> {
    const { basketId } = basketParams.parse(req.params);
    const body = addItemBody.parse(req.body);
    return this.addItemUseCase.handle({ basketId, token: basketToken(req), ...body });
  }

  async removeItem(req: FastifyRequest): Promise<unknown> {
    const { basketId, sku } = itemParams.parse(req.params);
    return this.removeItemUseCase.handle({ basketId, token: basketToken(req), sku });
  }

  async mergeBaskets(req: FastifyRequest): Promise<unknown> {
    basketParams.parse(req.params);
    const body = mergeBody.parse(req.body);
    return this.mergeBasketsUseCase.handle({ bearer: bearer(req), ...body });
  }

  async checkout(req: FastifyRequest): Promise<unknown> {
    const { basketId } = basketParams.parse(req.params);
    return this.checkoutUseCase.handle({ basketId, bearer: bearer(req) });
  }
}
