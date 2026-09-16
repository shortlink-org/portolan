import { describe, expect, it } from "vitest";
import { buildIndex } from "../catalog";
import type { Catalog, Field, Operation, RpcMessage, Service } from "../catalog";
import { compareFieldRules } from "./problem-subjects";
import { builtinProblems } from "./problem-rules";

const DRIFT = ["rules-drift"];

function catalogWith(service: Service): Catalog {
  return {
    generatedAt: "2024-01-01T00:00:00Z",
    commit: "abc1234",
    contexts: [{ id: "shop", slug: "shop", name: "Shop", summary: "", services: [service] }],
    defs: {},
    flows: [],
    adrs: [],
  };
}

/**
 * One service whose handler checks a request and whose document promises a
 * shape for the same route: the two words the rule holds against each other.
 */
function cart(checked: Field[] | undefined, promised: Field[]): Service {
  const operation: Operation = {
    id: "AddItem",
    kind: "command",
    doc: "",
    exposedBy: ["addItem"],
    ...(checked ? { fields: checked } : {}),
  };
  const message: RpcMessage = { name: "AddItemRequest", fields: promised };
  return {
    id: "shop.cart",
    slug: "cart",
    name: "cart",
    repo: "",
    path: "",
    readme: "",
    provides: [
      {
        id: "cart.v1",
        methods: [{ name: "addItem", request: "AddItemRequest", response: "Basket" }],
        source: "src/infrastructure/transport/http/gen/openapi.yaml",
        messages: [message],
      },
    ],
    consumes: [],
    aggregates: [
      {
        id: "shop.cart.basket",
        slug: "basket",
        name: "Basket",
        root: "Basket",
        readme: "",
        entities: [],
        valueObjects: [],
        events: [],
        operations: [operation],
      },
    ],
  };
}

function notes(service: Service): string[] {
  const catalog = catalogWith(service);
  return builtinProblems(catalog, buildIndex(catalog), DRIFT).map((problem) => problem.note ?? "");
}

const field = (name: string, rules: Field["rules"], required = true): Field => ({
  name,
  type: "string",
  doc: "",
  ...(required ? { required: true } : {}),
  ...(rules ? { rules } : {}),
});

describe("what the handler checks against what the document says", () => {
  it("says nothing when the two agree", () => {
    const rules = [{ name: "min_len", value: "1" }];
    expect(notes(cart([field("sku", rules)], [field("sku", rules)]))).toEqual([]);
  });

  it("reports a bound only the handler has", () => {
    const [note] = notes(cart([field("sku", [{ name: "min_len", value: "1" }])], [field("sku", undefined)]));
    expect(note).toBe("sku: the handler checks min_len = 1, the document says nothing. The caller reads cart.v1/addItem.");
  });

  it("reports a bound only the document has", () => {
    const [note] = notes(cart([field("sku", undefined)], [field("sku", [{ name: "max_len", value: "64" }])]));
    expect(note).toContain("sku: the document says max_len = 64, the handler does not check it");
  });

  it("reports two bounds that differ", () => {
    const [note] = notes(cart([field("quantity", [{ name: "lte", value: "50" }])], [field("quantity", [{ name: "lte", value: "99" }])]));
    expect(note).toContain("quantity: the handler checks lte = 50, the document says lte = 99");
  });

  it("reports a field one side demands and the other does not", () => {
    const [note] = notes(cart([field("sku", undefined, true)], [field("sku", undefined, false)]));
    expect(note).toContain("sku: the handler requires it, the document does not");
    const [other] = notes(cart([field("sku", undefined, false)], [field("sku", undefined, true)]));
    expect(other).toContain("sku: the document requires it, the handler does not");
  });

  it("holds its peace about a field only one side names", () => {
    // `basketId` is the route's own parameter and is in no body message;
    // `note` is a field the document carries that this handler never parses.
    expect(notes(cart([field("basketId", [{ name: "format", value: "uuid" }])], [field("note", [{ name: "max_len", value: "8" }])]))).toEqual([]);
  });

  it("says nothing about an operation whose handler checks nothing", () => {
    expect(notes(cart(undefined, [field("sku", [{ name: "max_len", value: "64" }])]))).toEqual([]);
  });

  it("says nothing about an operation nothing exposes", () => {
    const service = cart([field("sku", [{ name: "min_len", value: "1" }])], [field("sku", undefined)]);
    delete service.aggregates[0]!.operations[0]!.exposedBy;
    expect(notes(service)).toEqual([]);
  });
});

describe("the comparison itself", () => {
  it("is over the fields both sides name, in the order the handler has them", () => {
    expect(
      compareFieldRules(
        [field("sku", [{ name: "min_len", value: "1" }]), field("quantity", [{ name: "lte", value: "50" }]), field("basketId", [{ name: "format", value: "uuid" }])],
        [field("quantity", [{ name: "lte", value: "99" }]), field("sku", undefined)],
      ),
    ).toEqual([
      "sku: the handler checks min_len = 1, the document says nothing",
      "quantity: the handler checks lte = 50, the document says lte = 99",
    ]);
  });

  it("holds a rule with no value against one with none", () => {
    expect(compareFieldRules([field("code", [{ name: "unique" }])], [field("code", [{ name: "unique" }])])).toEqual([]);
    expect(compareFieldRules([field("code", [{ name: "unique" }])], [field("code", undefined)])).toEqual([
      "code: the handler checks unique, the document says nothing",
    ]);
  });
});
