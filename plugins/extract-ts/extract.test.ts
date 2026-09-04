import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Alt, Step } from "../../src/catalog.ts";
import { extract } from "./extract.ts";
import { serve } from "./main.ts";

const ROOT = "plugins/extract-ts/testdata/cart";
const options = { context: "shop", service: "cart", store: "pg", peers: { "auth.v1": "auth.auth", "shop.v1": "shop.pricing" } };

function run() {
  return extract({ root: ROOT, commit: "abc1234", generatedAt: "2026-09-04T00:00:00Z" }, options);
}

function fragment() {
  return JSON.parse(run().files[0]!.contents) as ReturnType<typeof JSON.parse>;
}

// The fixture is the layout the contract describes, each shape once, and
// expected.json is what it reads as. A change to the reader shows up here as
// a diff, which is the review worth having.
describe("the fixture, as a whole", () => {
  it("reads to the golden fragment", () => {
    const golden = JSON.parse(readFileSync(`${ROOT}/expected.json`, "utf8"));
    expect(fragment()).toEqual(golden);
  });

  it("reports the operation with no handler, and nothing else", () => {
    const { diagnostics } = run();
    expect(diagnostics.map((d) => d.ref)).toEqual(["getBasket"]);
    expect(diagnostics[0]!.message).toContain("no handler");
  });
});

describe("the service", () => {
  const svc = fragment().contexts[0].services[0];

  it("is named by its readme and placed by its package", () => {
    expect(svc.id).toBe("shop.cart");
    expect(svc.name).toBe("Shopping Cart");
    expect(svc.repo).toBe("github.com/acme/shop");
  });

  it("has one aggregate: the root by the directory's name, entities beside it, value objects and events", () => {
    const [basket] = svc.aggregates;
    expect(basket.id).toBe("shop.cart.basket");
    expect(basket.root).toBe("Basket");
    expect(basket.entities.map((e: { name: string }) => e.name)).toEqual(["Basket", "BasketItem"]);
    expect(basket.valueObjects.map((v: { name: string }) => v.name)).toEqual(["Money"]);
    expect(basket.events.map((e: { id: string }) => e.id)).toEqual(["shop.cart.basket.BasketCheckedOut", "shop.cart.basket.BasketItemAdded"]);
    const added = basket.events[1].versions[0];
    expect(added.fields.map((f: { name: string; type: string }) => `${f.name}:${f.type}`)).toEqual(["basketId:string", "sku:string", "quantity:number", "unitPrice:Money"]);
    expect(added.doc).toContain("Published on the bus as `cart.BasketItemAdded`");
  });

  it("reads fields off properties and constructor parameter properties alike", () => {
    const root = svc.aggregates[0].entities[0];
    expect(root.fields.map((f: { name: string }) => f.name)).toEqual(["items", "status", "id", "token", "currency", "version"]);
  });

  it("reads each use case as an operation, command or query by what it does to a port, exposed by its handler", () => {
    const ops = svc.aggregates[0].operations;
    expect(ops.map((o: { id: string; kind: string; exposedBy?: string[] }) => `${o.id}:${o.kind}:${(o.exposedBy ?? []).join(",")}`)).toEqual([
      "AddItem:command:addItem",
      "Checkout:command:checkout",
    ]);
    expect(ops[1].doc).toContain("Freezes the basket");
  });

  it("records what it calls, named the way the callee names the method", () => {
    expect(svc.consumes.map((c: { id: string; peer: string; status: string }) => `${c.id}→${c.peer}:${c.status}`)).toEqual([
      "auth.v1.Sessions/validateSession→auth.auth:declared",
      "shop.v1.Pricing/GetQuote→shop.pricing:declared",
    ]);
  });
});

describe("the flows", () => {
  const flows = fragment().flows as { slug: string; steps: (Step | Alt)[]; participants: { id: string; kind: string }[] }[];
  const bySlug = (slug: string) => flows.find((f) => f.slug === slug)!;
  const line = (s: Step | Alt) => (s.type === "step" ? `${s.from}->${s.to} ${s.kind} ${s.label}` : `alt ${s.id}`);

  it("opens on the endpoint and follows the use case through its ports", () => {
    expect(bySlug("cart-add-item").steps.map(line)).toEqual([
      "client->shop.cart rpc addItem",
      "shop.cart->cart-pg call byId",
      "shop.cart->cart-pg call save",
      "shop.cart->bus event BasketItemAdded",
    ]);
  });

  it("reads a call to a peer through the adapter the provider binds the port to", () => {
    const checkout = bySlug("cart-checkout");
    expect(checkout.steps.map(line)).toEqual([
      "client->shop.cart rpc checkout",
      "shop.cart->auth.auth rpc validateSession",
      "shop.cart->cart-pg call byId",
      "shop.cart->shop.pricing rpc GetQuote",
      "shop.cart->cart-pg call save",
      "shop.cart->bus event BasketCheckedOut",
    ]);
    expect(checkout.participants.map((p) => `${p.id}/${p.kind}`)).toContain("auth.auth/service");
    const rpc = checkout.steps[1] as Step;
    expect(rpc.ref).toBe("auth.v1.Sessions/validateSession");
  });

  it("opens a policy on the bus and draws its choices", () => {
    const policy = bySlug("cart-touch-on-checkout");
    expect(policy.steps[0]).toMatchObject({ from: "bus", to: "shop.cart", kind: "event", ref: "shop.cart.basket.BasketCheckedOut" });
    const alts = policy.steps.filter((s): s is Alt => s.type === "alt");
    expect(alts.map((a) => a.branches.map((b) => `${b.title}${b.terminal ? "!" : ""}:${b.steps.length}`))).toEqual([
      ['basket.status === "open"!:1', "otherwise:0"],
      ['basket.currency is "EUR":1', "otherwise!:0"],
    ]);
  });

  it("does not read a field off an event as the event leaving", () => {
    // event.basketId is handed to byId; the event itself is not published again.
    const policy = bySlug("cart-touch-on-checkout");
    const events = policy.steps.filter((s): s is Step => s.type === "step" && s.kind === "event");
    expect(events).toHaveLength(1);
  });
});

describe("the protocol", () => {
  it("answers a describe with what it is and what it can be told", () => {
    const resp = JSON.parse(serve(JSON.stringify({ kind: "describe" })));
    expect(resp.describe.name).toBe("extract-ts");
    expect(resp.describe.phases).toEqual(["extract"]);
    expect(resp.describe.options.additionalProperties).toBe(false);
    expect(Object.keys(resp.describe.options.properties).sort()).toEqual(
      ["classification", "context", "contextName", "contextSummary", "events", "out", "peers", "repo", "service", "serviceName", "source", "store"],
    );
  });

  it("refuses to run with no root", () => {
    expect(() => serve(JSON.stringify({}))).toThrow(/no input root/);
  });
});
