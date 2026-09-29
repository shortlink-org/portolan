import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event } from "../../src/catalog.ts";
import { domainEmitters, useCaseEmits } from "./emits.ts";

// A domain and its use cases on disk, since a domain function is followed
// through the import that names its file.
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "extract-ts-emits-")));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  return root;
}

// The aggregate's events, in the order it lists them: what `emits` is sorted by.
const EVENTS = ["OrderPlaced", "OrderPaid", "OrderCancelled", "OrderShipped"].map((name) => ({ id: `shop.oms.order.${name}`, name }) as Event);

const events = Object.fromEntries(EVENTS.map((e) => [`domain/order/events/${e.name}.ts`, `export class ${e.name} { readonly name = "oms.${e.name}"; }\n`]));

const ROOT = `
import { OrderPlaced } from "./events/OrderPlaced.ts";
import { OrderPaid } from "./events/OrderPaid.ts";
import { OrderCancelled } from "./events/OrderCancelled.ts";
import { refund } from "./refund.ts";

export class Order {
  static place(id: string): [Order, OrderPlaced] {
    return [new Order(), new OrderPlaced()];
  }
  pay() {
    return this.record(new OrderPaid());
  }
  cancel(): OrderCancelled {
    this.settle();
    return new OrderCancelled();
  }
  private settle(): void {
    refund(this);
  }
  private record<T>(event: T): T {
    return event;
  }
  lines(): string[] {
    return [];
  }
}
`;

const REFUND = `
import { OrderPaid } from "./events/OrderPaid.ts";
import { OrderShipped } from "./events/OrderShipped.ts";

// Refunding pays back, as far as events go.
export function refund(order: unknown): OrderPaid {
  return new OrderPaid();
}

export const ship = (order: unknown): OrderShipped => new OrderShipped();
`;

function emits(useCase: string): string[] {
  const root = tree({ ...events, "domain/order/order.ts": ROOT, "domain/order/refund.ts": REFUND, "application/order/usecases/x/usecase.ts": useCase });
  const e = domainEmitters(join(root, "domain/order"), "Order", EVENTS);
  return useCaseEmits(e, join(root, "application/order/usecases/x")).map((id) => id.slice("shop.oms.order.".length));
}

describe("what an operation emits", () => {
  it("is what the root methods it calls name in their return types, tuples included", () => {
    expect(emits(`import { Order } from "../../../../domain/order/order.ts";
      export class UseCase { handle() { const [order, placed] = Order.place("1"); } }`)).toEqual(["OrderPlaced"]);
  });

  it("follows a root method through the helpers and domain functions it calls, to a fixpoint", () => {
    // cancel → settle (private) → refund (another file of the domain) → OrderPaid.
    expect(emits(`export class UseCase { async handle() { const order = await this.repo.byId("1"); order.cancel(); } }`)).toEqual(["OrderPaid", "OrderCancelled"]);
  });

  it("reads an event a root method constructs, whatever its return type says", () => {
    expect(emits(`export class UseCase { handle(order) { order.pay(); } }`)).toEqual(["OrderPaid"]);
  });

  it("reads a domain function through its import, and an event the use case builds itself", () => {
    expect(emits(`import { ship } from "../../../../domain/order/refund.ts";
      import { OrderPlaced } from "../../../../domain/order/events/OrderPlaced.ts";
      export class UseCase { handle(order) { ship(order); publish(new OrderPlaced()); } }`)).toEqual(["OrderPlaced", "OrderShipped"]);
  });

  it("dedupes and keeps the aggregate's order, not the order of the calls", () => {
    expect(emits(`export class UseCase { handle(a, b) { a.cancel(); b.pay(); a.pay(); } }`)).toEqual(["OrderPaid", "OrderCancelled"]);
  });

  it("does not read a port's method, a private root method, or a function of the same name from elsewhere", () => {
    expect(
      emits(`function ship() {}
      export class UseCase { async handle(order) { await this.repo.cancel(order); order.settle(); ship(); order.lines(); } }`),
    ).toEqual([]);
  });
});
