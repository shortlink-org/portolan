import type { BasketAbandoned } from "./basket-abandoned.ts";
import type { BasketCheckedOut } from "./basket-checked-out.ts";
import type { BasketCreated } from "./basket-created.ts";
import type { BasketItemAdded } from "./basket-item-added.ts";
import type { BasketItemRemoved } from "./basket-item-removed.ts";

/** Everything the basket publishes. */
export type BasketEvent = BasketCreated | BasketItemAdded | BasketItemRemoved | BasketCheckedOut | BasketAbandoned;
