import { describe, expect, it } from "vitest";
import { catalog, index } from "../testing/estate";
import type { Aggregate, Event, Field, Service } from "../catalog";
import {
  eventScope,
  isStatusEnum,
  usagesOfEnum,
  openablePaths,
  parseType,
  resolveShape,
  schemaChanges,
  scopeOf,
} from "./shape";

describe("parseType", () => {
  it.each([
    ["Money", "Money", "one", false],
    ["Vec<Line>", "Line", "many", false],
    ["[]LineItem", "LineItem", "many", false],
    ["LineItem[]", "LineItem", "many", false],
    ["repeated Line", "Line", "many", false],
    ["Option<Money>", "Money", "one", true],
    ["*Money", "Money", "one", true],
    ["Money | undefined", "Money", "one", true],
    ["Money?", "Money", "one", true],
    ["optional Money", "Money", "one", true],
    ["Option<Vec<Line>>", "Line", "many", true],
    ["map<string, Money>", "Money", "map", false],
    ["HashMap<String, Vec<Line>>", "Line", "map", false],
    ["Box<Line>", "Line", "one", false],
  ] as const)("%s -> %s (%s, optional=%s)", (raw, base, card, optional) => {
    expect(parseType(raw)).toEqual({ base, cardinality: card, optional });
  });

  it("leaves a generic it does not know whole", () => {
    expect(parseType("DateTime<Utc>")).toEqual({
      base: "DateTime<Utc>",
      cardinality: "one",
      optional: false,
    });
    expect(parseType("time.Time").base).toBe("time.Time");
  });
});

function eventById(id: string): Event {
  const event = index.eventById.get(id);
  if (!event) throw new Error(`no event ${id}`);
  return event;
}

function latest(event: Event) {
  const version = event.versions[event.versions.length - 1];
  if (!version) throw new Error(`${event.id} has no versions`);
  return version;
}

describe("resolveShape", () => {
  it("follows a ref to the shared def", () => {
    const event = eventById("shop.oms.order.OrderPlaced");
    const total = latest(event).fields.find((f) => f.name === "total");
    if (!total) throw new Error("no total");
    const shape = resolveShape(catalog, total, eventScope(index, event));
    expect(shape?.kind).toBe("def");
    expect(shape?.id).toBe("Money");
    expect(shape?.fields.map((f) => f.name)).toEqual(["amountMinor", "currency"]);
  });

  it("nests: a def's field with a ref resolves again", () => {
    const event = eventById("shop.oms.order.OrderPlaced");
    const scope = eventScope(index, event);
    const items = latest(event).fields.find((f) => f.name === "items");
    if (!items) throw new Error("no items");
    const lineItem = resolveShape(catalog, items, scope);
    expect(lineItem?.id).toBe("LineItem");
    const unitPrice = lineItem?.fields.find((f) => f.name === "unitPrice");
    if (!lineItem || !unitPrice) throw new Error("no unitPrice");
    const money = resolveShape(catalog, unitPrice, scopeOf(lineItem, scope));
    expect(money?.id).toBe("Money");
  });

  it("returns null for a primitive and for a name the catalog lacks", () => {
    const event = eventById("shop.oms.order.OrderPlaced");
    const scope = eventScope(index, event);
    const orderId = latest(event).fields.find((f) => f.name === "orderId");
    if (!orderId) throw new Error("no orderId");
    expect(resolveShape(catalog, orderId, scope)).toBeNull();
    expect(
      resolveShape(catalog, { name: "x", type: "Nowhere", doc: "" }, scope),
    ).toBeNull();
  });

  // What the live extractors write: a type by name, no ref, the block a few
  // lines away in the same aggregate.
  const money = {
    id: "shop.oms.order.money",
    slug: "money",
    name: "Money",
    doc: "an amount",
    fields: [
      { name: "amount_minor", type: "i64", doc: "" },
      { name: "currency", type: "String", doc: "" },
    ],
  };
  const line = {
    id: "shop.oms.order.line",
    slug: "line",
    name: "Line",
    doc: "",
    fields: [
      { name: "sku", type: "String", doc: "" },
      { name: "unit_price", type: "Money", doc: "" },
    ],
  };
  const order: Aggregate = {
    id: "shop.oms.order",
    slug: "order",
    name: "Order",
    readme: "",
    root: "order",
    entities: [line],
    valueObjects: [money],
    operations: [],
    events: [],
  };
  const service = { id: "shop.oms", aggregates: [order] } as unknown as Service;
  const scope = { aggregate: order, service };

  it("finds a block of the same aggregate by the base name", () => {
    const field: Field = { name: "lines", type: "Vec<Line>", doc: "" };
    const shape = resolveShape(catalog, field, scope);
    expect(shape?.kind).toBe("entity");
    expect(shape?.id).toBe("shop.oms.order.line");
    expect(shape?.aggregate).toBe(order);
  });

  it("resolves a block's own fields in the block's aggregate", () => {
    const field: Field = { name: "lines", type: "Vec<Line>", doc: "" };
    const shape = resolveShape(catalog, field, scope);
    if (!shape) throw new Error("no shape");
    const unitPrice = shape.fields.find((f) => f.name === "unit_price");
    if (!unitPrice) throw new Error("no unit_price");
    const inner = resolveShape(catalog, unitPrice, scopeOf(shape, scope));
    expect(inner?.kind).toBe("vo");
    expect(inner?.id).toBe("shop.oms.order.money");
  });

  it("looks in the rest of the service, and not beyond it", () => {
    const other: Aggregate = { ...order, id: "shop.oms.other", slug: "other", entities: [], valueObjects: [] };
    const field: Field = { name: "total", type: "Money", doc: "" };
    expect(
      resolveShape(catalog, field, { aggregate: other, service })?.id,
    ).toBe("shop.oms.order.money");
    expect(
      resolveShape(catalog, field, { aggregate: other, service: null }),
    ).toBeNull();
  });

  it("opens every path once, and a shape on its own path not again", () => {
    const cyclic = {
      ...line,
      fields: [...line.fields, { name: "order", type: "Order", doc: "" }],
    };
    const root = { ...order, entities: [cyclic, { id: "shop.oms.order.order", slug: "order", name: "Order", doc: "", fields: [{ name: "lines", type: "Vec<Line>", doc: "" }] }] };
    const paths = openablePaths(
      catalog,
      [{ name: "order", type: "Order", doc: "" }],
      { aggregate: root, service: null },
    );
    expect(paths).toEqual([
      "order",
      "order.lines",
      "order.lines.unit_price",
    ]);
  });
});

describe("schemaChanges", () => {
  const event = {
    id: "x.y.E",
    versions: [
      {
        version: "v1",
        fields: [
          { name: "a", type: "string", doc: "" },
          { name: "b", type: "int32", doc: "" },
          { name: "gone", type: "bool", doc: "" },
        ],
      },
      {
        version: "v2",
        fields: [
          { name: "a", type: "string", doc: "" },
          { name: "b", type: "int64", doc: "" },
          { name: "c", type: "string", doc: "" },
        ],
      },
    ],
  } as unknown as Event;

  it("changes nothing in the first version", () => {
    const { byField, removed } = schemaChanges(event, "v1");
    expect(byField.size).toBe(0);
    expect(removed).toEqual([]);
  });

  it("tells added, retyped and dropped fields apart", () => {
    const { byField, removed } = schemaChanges(event, "v2");
    expect(byField.get("a")).toBeUndefined();
    expect(byField.get("b")).toEqual({ change: "changed", from: "int32" });
    expect(byField.get("c")).toEqual({ change: "new" });
    expect(removed.map((f) => f.name)).toEqual(["gone"]);
  });

  it("a field whose rules moved is changed, with the rules it had", () => {
    const rules = {
      id: "x.y.R",
      versions: [
        {
          version: "v1",
          fields: [
            { name: "code", type: "string", doc: "", rules: [{ name: "min_len", value: "8" }] },
            { name: "who", type: "string", doc: "" },
            { name: "same", type: "string", doc: "", rules: [{ name: "in", value: "a, b" }, { name: "unique" }] },
            { name: "both", type: "int32", doc: "", required: true },
          ],
        },
        {
          version: "v2",
          fields: [
            { name: "code", type: "string", doc: "", rules: [{ name: "min_len", value: "12" }] },
            { name: "who", type: "string", doc: "", required: true, rules: [{ name: "format", value: "uuid" }] },
            // The same rules in another order are the same rules.
            { name: "same", type: "string", doc: "", rules: [{ name: "unique" }, { name: "in", value: "a, b" }] },
            { name: "both", type: "int64", doc: "" },
          ],
        },
      ],
    } as unknown as Event;
    const { byField } = schemaChanges(rules, "v2");
    expect(byField.get("code")).toEqual({ change: "changed", rulesFrom: "≥ 8 chars" });
    expect(byField.get("who")).toEqual({ change: "changed", rulesFrom: "" });
    expect(byField.get("same")).toBeUndefined();
    expect(byField.get("both")).toEqual({ change: "changed", from: "int32", rulesFrom: "required" });
  });

  it("agrees with the fixture: OrderPlaced v2 added channel", () => {
    const placed = eventById("shop.oms.order.OrderPlaced");
    const { byField, removed } = schemaChanges(placed, "v2");
    expect([...byField.keys()]).toEqual(["channel"]);
    expect(removed).toEqual([]);
  });
});

describe("enums", () => {
  it("resolves a field's type to an enum of the aggregate by name", () => {
    const event = eventById("payments.ledger.payment.PaymentDeclined");
    const scope = eventScope(index, event);
    const reason = resolveShape(
      catalog,
      { name: "code", type: "DeclineCode", doc: "" },
      scope,
    );
    expect(reason?.kind).toBe("enum");
    expect(reason?.id).toBe("payments.ledger.payment.decline-code");
    expect(reason?.values.map((v) => v.name)).toEqual([
      "CARD_REFUSED",
      "ORDER_CANCELLED",
      "GATEWAY_TIMEOUT",
    ]);
    expect(reason?.fields).toEqual([]);
  });

  it("prefers a block of the same name over an enum, and opens an enum as a leaf", () => {
    const order = index.aggregateById.get("shop.oms.order");
    if (!order) throw new Error("no order");
    const service = index.aggregateOwner.get(order.id) ?? null;
    const scope = { aggregate: order, service };
    // Money is a value object there; the enum is Status.
    expect(resolveShape(catalog, { name: "t", type: "Money", doc: "" }, scope)?.kind).toBe("vo");
    const paths = openablePaths(
      catalog,
      [{ name: "status", type: "Status", doc: "" }],
      scope,
    );
    expect(paths).toEqual(["status"]);
  });

  it("knows the status by its values, not its name", () => {
    const order = index.aggregateById.get("shop.oms.order");
    const status = order?.enums?.find((e) => e.slug === "status");
    if (!status) throw new Error("fixture lacks the status");
    const states = ["placed", "confirmed", "cancelled"];
    expect(isStatusEnum(status, states)).toBe(true);
    expect(isStatusEnum(status, ["placed", "confirmed"])).toBe(false);
    expect(isStatusEnum(status, [...states, "lost"])).toBe(false);
    // PLACED and placed are one state; so are risk-blocked and RISK_BLOCKED.
    expect(
      isStatusEnum(
        { ...status, values: status.values.map((v) => ({ ...v, name: v.name.toUpperCase() })) },
        states,
      ),
    ).toBe(true);
    const payment = index.aggregateById.get("payments.ledger.payment");
    const code = payment?.enums?.find((e) => e.slug === "decline-code");
    if (!code) throw new Error("fixture lacks the code");
    expect(isStatusEnum(code, states)).toBe(false);
  });

  it("finds who switches on an enum, by the same name match the tree makes", () => {
    const uses = usagesOfEnum(catalog, "payments.ledger.payment.decline-code");
    const declined = uses.find((u) => u.id === "payments.ledger.payment.PaymentDeclined");
    expect(declined?.kind).toBe("event");
    expect(declined?.fields).toEqual(["code"]);
    expect(declined?.versions).toEqual(["v1"]);
    // The root entity holds the status, by name too.
    const order = usagesOfEnum(catalog, "shop.oms.order.status").find((u) => u.id === "shop.oms.order.order");
    expect(order?.kind).toBe("entity");
    expect(order?.fields).toEqual(["status"]);
    expect(usagesOfEnum(catalog, "nowhere.at-all")).toEqual([]);
  });
});
