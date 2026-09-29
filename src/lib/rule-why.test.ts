// Which part of a row decided a rule: the field, the element of a list, or
// nothing alone when two fields hold the answer together.

import { describe, expect, it } from "vitest";
import { ESTATE_SCHEMA, rowOfExample, SUBJECTS } from "./problem-rules-cel.mjs";
import { referencedEstate, referencedFields, shownValue, whyOf } from "./rule-why";

const event = (written: Record<string, unknown>) => rowOfExample(SUBJECTS.event.schema, written);
const estate = rowOfExample(ESTATE_SCHEMA, {});
const PII = "event.fields.exists(f, f.matches('[Ee]mail|[Pp]hone|[Cc]ard'))";

describe("the fields a condition reads", () => {
  it("names each field of the subject once, in the order the condition names them", () => {
    expect(referencedFields("event", "event.deprecated && size(event.consumers) == 0 || event.deprecated")).toEqual(["deprecated", "consumers"]);
  });

  it("ignores a name the subject does not have and another subject's path", () => {
    expect(referencedFields("event", "service.name == '' && event.nope == 1")).toEqual([]);
  });

  it("names the estate lists apart", () => {
    expect(referencedEstate("event.service in estate.services")).toEqual(["services"]);
  });
});

describe("why a row matched", () => {
  it("lights the one element of a list that decided it", () => {
    const why = whyOf("event", PII, event({ fields: ["orderId", "customerEmail", "total"] }), estate);
    expect(why.outcome).toBe(true);
    expect(why.fields).toEqual([{ field: "fields", type: "list<string>", decisive: true, items: ["customerEmail"] }]);
    expect(why.joint).toBe(false);
  });

  it("lights every element that would do on its own when there are several", () => {
    const why = whyOf("event", PII, event({ fields: ["orderId", "customerEmail", "cardNumber"] }), estate);
    expect(why.fields[0]!.items).toEqual(["customerEmail", "cardNumber"]);
  });

  it("lights a list as a whole when no element decides it", () => {
    const why = whyOf("event", "size(event.consumers) > 1", event({ consumers: ["a", "b"] }), estate);
    expect(why.fields[0]).toMatchObject({ field: "consumers", decisive: true, items: [] });
  });

  it("finds the deciding field among several", () => {
    const why = whyOf("event", "event.deprecated && event.versions > 1", event({ deprecated: true, versions: 3 }), estate);
    expect(why.outcome).toBe(true);
    expect(why.fields.map((field) => [field.field, field.decisive])).toEqual([
      ["deprecated", true],
      ["versions", true],
    ]);
    const other = whyOf("event", "event.deprecated && event.versions > 1", event({ deprecated: false, versions: 3 }), estate);
    expect(other.outcome).toBe(false);
    expect(other.fields.map((field) => [field.field, field.decisive])).toEqual([
      ["deprecated", true],
      ["versions", false],
    ]);
  });

  it("says no one field decides when two hold the answer together", () => {
    const why = whyOf("event", "event.deprecated || event.versions > 1", event({ deprecated: true, versions: 3 }), estate);
    expect(why.fields.every((field) => !field.decisive)).toBe(true);
    expect(why.joint).toBe(true);
  });

  it("does not call a row the condition leaves out a joint decision", () => {
    const why = whyOf("event", PII, event({ fields: ["orderId"] }), estate);
    expect(why.outcome).toBe(false);
    expect(why.fields[0]!.decisive).toBe(false);
    expect(why.joint).toBe(false);
  });

  it("changes an empty value too, so a condition about emptiness has a deciding field", () => {
    const why = whyOf("event", "event.channel == ''", event({}), estate);
    expect(why.fields[0]).toMatchObject({ field: "channel", decisive: true });
  });

  it("reads no field for a condition that names none", () => {
    expect(whyOf("event", "true", event({}), estate)).toEqual({ outcome: true, fields: [], joint: false });
  });
});

describe("a value as the page prints it", () => {
  it("prints ints, empty strings and lists plainly", () => {
    expect(shownValue(3n)).toBe("3");
    expect(shownValue("")).toBe('""');
    expect(shownValue([])).toBe("[]");
    expect(shownValue(["a", "b"])).toBe("a, b");
  });
});
