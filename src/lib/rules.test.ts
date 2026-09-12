import { describe, expect, it } from "vitest";
import type { Field } from "../catalog";
import { ruleMark, ruleMarks } from "./rules";

describe("ruleMark", () => {
  it.each([
    ["min_len", "1", "≥ 1 chars"],
    ["max_len", "64", "≤ 64 chars"],
    ["len", "3", "3 chars"],
    ["min_items", "1", "≥ 1 items"],
    ["gt", "0", "> 0"],
    ["gte", "-1", "≥ -1"],
    ["lte", "9007199254740993", "≤ 9007199254740993"],
    ["const", "USD", "= USD"],
    ["in", "USD, EUR", "one of USD, EUR"],
    ["not_in", "XXX", "none of XXX"],
    ["pattern", "^[A-Z]{3}$", "matches ^[A-Z]{3}$"],
    ["format", "email", "email"],
    ["multiple_of", "5", "multiple of 5"],
    ["items.max_len", "64", "each ≤ 64 chars"],
    ["keys.min_len", "1", "each key ≥ 1 chars"],
    ["values.gte", "0", "each value ≥ 0"],
    ["cel", "this.sku != ''", "cel"],
    // A custom option is shown as written; `true` is the whole of a flag.
    ["(acme.pii)", "true", "(acme.pii)"],
    ["(acme.mask).style", "LAST_FOUR", "(acme.mask).style LAST_FOUR"],
    // A rule the page has no words for yet is still shown, spelled as it came.
    ["well_formed", "true", "well_formed true"],
  ])("%s %s reads as %s", (name, value, text) => {
    expect(ruleMark({ name, value })).toEqual({ text, title: `${name} = ${value}` });
  });

  it("a bare flag has no value in the title either", () => {
    expect(ruleMark({ name: "unique" })).toEqual({ text: "unique", title: "unique" });
    expect(ruleMark({ name: "lt_now" })).toEqual({ text: "in the past", title: "lt_now" });
  });
});

describe("ruleMarks", () => {
  const field = (extra: Partial<Field>): Field => ({ name: "x", type: "string", doc: "", ...extra });

  it("puts required first and keeps the rules in the source's order", () => {
    const marks = ruleMarks(field({ required: true, rules: [{ name: "max_len", value: "16" }, { name: "format", value: "uuid" }] }));
    expect(marks.map((m) => m.text)).toEqual(["required", "≤ 16 chars", "uuid"]);
    expect(marks[0]?.title).toBe("must be sent");
  });

  it("is empty for a field the source says nothing about", () => {
    expect(ruleMarks(field({}))).toEqual([]);
  });
});
