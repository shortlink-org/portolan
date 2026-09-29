// A rule's examples: kept from a row with only what the rule reads, run on
// the page, and held by the manifest check the same way.

import { describe, expect, it } from "vitest";
import { BUILTIN_RULES } from "./problem-rules";
import { exampleMatches, problemRuleProblems, rowOfExample, SUBJECTS } from "./problem-rules-cel.mjs";
import { exampleOfRow, freshExampleName, runExamples } from "./rule-examples";

const PII = "event.fields.exists(f, f.matches('[Ee]mail|[Pp]hone|[Cc]ard'))";
const builtinIds = BUILTIN_RULES.map((rule) => rule.id);
const rule = {
  id: "team.event-pii",
  over: "event",
  title: "Event carries personal data",
  when: PII,
  message: "event.name",
};

describe("keeping a row as an example", () => {
  it("keeps the id and the fields the rule reads, with ints as plain numbers", () => {
    const row = rowOfExample(SUBJECTS.event.schema, { id: "oms.OrderPlaced", fields: ["customerEmail"], versions: 2, name: "OrderPlaced" });
    const example = exampleOfRow("event", `${PII} && event.versions > 1`, row, {}, "row", "OrderPlaced");
    expect(example).toEqual({ name: "OrderPlaced", expect: "row", row: { id: "oms.OrderPlaced", fields: ["customerEmail"], versions: 2 } });
  });

  it("keeps the estate lists the rule reads", () => {
    const row = rowOfExample(SUBJECTS.event.schema, { service: "oms" });
    const example = exampleOfRow("event", "!(event.service in estate.services)", row, { services: ["oms"], stores: ["db"] }, "none", "known service");
    expect(example.estate).toEqual({ services: ["oms"] });
    expect(exampleMatches("event", "!(event.service in estate.services)", example)).toBe(false);
  });

  it("names a second example of the same row apart", () => {
    expect(freshExampleName("OrderPlaced", [{ name: "OrderPlaced", expect: "row", row: {} }])).toBe("OrderPlaced 2");
  });
});

describe("running the examples", () => {
  it("says which examples hold and which the rule gets wrong", () => {
    const results = runExamples("event", PII, [
      { name: "email", expect: "row", row: { fields: ["customerEmail"] } },
      { name: "opaque ids", expect: "none", row: { fields: ["customerId"] } },
      { name: "phone hash", expect: "none", row: { fields: ["phoneHash"] } },
    ]);
    expect(results.map((result) => [result.example.name, result.holds])).toEqual([
      ["email", true],
      ["opaque ids", true],
      ["phone hash", false],
    ]);
  });

  it("says why an example cannot run", () => {
    const [result] = runExamples("event", PII, [{ name: "typo", expect: "row", row: { feilds: [] } }]);
    expect(result).toMatchObject({ holds: false, error: "row/feilds: not a field of this subject" });
  });
});

describe("examples in the manifest", () => {
  it("accepts a rule whose examples hold", () => {
    const examples = [{ name: "email", expect: "row", row: { fields: ["customerEmail"] } }];
    expect(problemRuleProblems([{ ...rule, examples }], builtinIds)).toEqual([]);
  });

  it("refuses an example the rule disagrees with, naming it", () => {
    const examples = [{ name: "phone hash", expect: "none", row: { fields: ["phoneHash"] } }];
    expect(problemRuleProblems([{ ...rule, examples }], builtinIds)).toEqual([
      'portolan.json problemRules/0/examples/0: "phone hash" expects no row, the rule gives a row',
    ]);
  });

  it("refuses an example of the wrong shape", () => {
    const examples = [
      { name: "", expect: "maybe", row: {} },
      { name: "bad int", expect: "row", row: { versions: 1.5 } },
    ];
    expect(problemRuleProblems([{ ...rule, examples }], builtinIds)).toEqual([
      "portolan.json problemRules/0/examples/0/name: required",
      "portolan.json problemRules/0/examples/0/expect: must be one of row, none",
      "portolan.json problemRules/0/examples/1/row/versions: must be an int",
    ]);
  });

  it("does not let a built-in rule carry examples", () => {
    expect(problemRuleProblems([{ id: builtinIds[0], examples: [] }], builtinIds)).toEqual([
      `portolan.json problemRules/0/examples: "${builtinIds[0]}" is a built-in rule; only enabled, severity and reason may be set`,
    ]);
  });
});
