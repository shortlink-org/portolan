import { describe, expect, it } from "vitest";
import { catalog, index } from "../testing/estate";
import type { Event, Field } from "../catalog";
import { exampleOf } from "./example";
import { eventScope } from "./shape";
import type { Scope } from "./shape";

function latestOf(id: string): { fields: Field[]; scope: Scope } {
  const event: Event | undefined = index.eventById.get(id);
  const version = event?.versions.at(-1);
  if (!event || !version) throw new Error(`no event ${id}`);
  return { fields: version.fields, scope: eventScope(index, event) };
}

const nowhere: Scope = { aggregate: null, service: null };
const f = (type: string, more: Partial<Field> = {}): Field => ({
  name: "x",
  type,
  doc: "",
  ...more,
});
const one = (field: Field) => exampleOf(catalog, [field], nowhere).x;

describe("exampleOf", () => {
  it("opens shared shapes and lists as far as the catalog has them", () => {
    const { fields, scope } = latestOf("shop.oms.order.OrderPlaced");
    const example = exampleOf(catalog, fields, scope);
    expect(Object.keys(example)).toEqual(fields.map((field) => field.name));
    expect(example.placedAt).toBe("2026-01-01T12:00:00Z");
    expect(example.items).toEqual([
      {
        sku: "string",
        quantity: 1,
        unitPrice: { amountMinor: 1, currency: "string" },
      },
    ]);
    expect(example.customer).toEqual({ id: "string", segment: "string" });
  });

  it("names an enum by a value it has", () => {
    const { fields, scope } = latestOf("payments.ledger.payment.PaymentDeclined");
    const example = exampleOf(catalog, fields, scope);
    expect(example.code).toBe("CARD_REFUSED");
    expect(example.retryable).toBe(true);
  });

  it("spells the scalars of every source language", () => {
    expect(one(f("i64"))).toBe(1);
    expect(one(f("Option<f64>"))).toBe(1.5);
    expect(one(f("DateTime<Utc>"))).toBe("2026-01-01T12:00:00Z");
    expect(one(f("uuid.UUID"))).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(one(f("BigDecimal"))).toBe("1.5");
    expect(one(f("string | undefined"))).toBe("string");
    expect(one(f("repeated string"))).toEqual(["string"]);
    expect(one(f("map<string, int32>"))).toEqual({ key: 1 });
  });

  it("writes a 64-bit integer as ProtoJSON does only for a proto field", () => {
    expect(one(f("int64", { number: 3 }))).toBe("1");
    expect(one(f("int64"))).toBe(1);
  });

  it("keeps to what the rules say", () => {
    expect(one(f("string", { rules: [{ name: "in", value: '"EUR", "USD"' }] }))).toBe("EUR");
    expect(one(f("int32", { rules: [{ name: "const", value: "7" }] }))).toBe(7);
    expect(one(f("int32", { rules: [{ name: "gt", value: "10" }] }))).toBe(11);
    expect(one(f("double", { rules: [{ name: "lte", value: "0" }] }))).toBe(0);
    expect(one(f("string", { rules: [{ name: "format", value: "email" }] }))).toBe("user@example.com");
    expect(one(f("string", { rules: [{ name: "min_len", value: "10" }] }))).toBe("stringxxxx");
    expect(one(f("string", { rules: [{ name: "max_len", value: "3" }] }))).toBe("str");
    expect(one(f("string", { rules: [{ name: "prefix", value: '"ord_"' }] }))).toBe("ord_string");
    expect(one(f("Timestamp", { rules: [{ name: "gt_now" }] }))).toBe("2100-01-01T12:00:00Z");
    expect(
      one(f("[]string", { rules: [{ name: "min_items", value: "2" }, { name: "items.format", value: "uuid" }] })),
    ).toEqual([
      "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    ]);
  });

  it("reads the format and enum OpenAPI writes into the type", () => {
    expect(one(f("string (date)"))).toBe("2026-01-01");
    expect(one(f("string enum(pending | paid)"))).toBe("pending");
  });

  it("marks a type the catalog has no shape for instead of guessing", () => {
    expect(one(f("TrackingCode"))).toBe("<TrackingCode>");
  });

  it("ends a cycle with an empty object", () => {
    const scope: Scope = { aggregate: null, service: null };
    const cyclic = {
      ...catalog,
      defs: { Node: { fields: [{ name: "next", type: "Node", doc: "", ref: "Node" }] } },
    };
    expect(exampleOf(cyclic, [f("Node", { ref: "Node" })], scope).x).toEqual({ next: {} });
  });
});
