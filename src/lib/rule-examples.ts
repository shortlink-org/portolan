// Keeping a catalog row as one of a rule's examples, and running them.
//
// A kept example carries only what the rule reads: the fields the condition
// names, the subject's id so a reader can tell which row it was, and the
// estate lists the condition asks about. Ints are written as plain numbers,
// the way portolan.json holds them.

import { exampleMatches, SUBJECTS } from "./problem-rules-cel.mjs";
import type { RuleExample, RuleSubject } from "./problem-rules-cel.mjs";
import { referencedEstate, referencedFields } from "./rule-why";

function written(value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

export function exampleOfRow(
  over: RuleSubject,
  when: string,
  row: Record<string, unknown>,
  estate: Record<string, string[]>,
  expect: RuleExample["expect"],
  name: string,
): RuleExample {
  const fields = referencedFields(over, when);
  if (Object.hasOwn(SUBJECTS[over].schema, "id") && !fields.includes("id")) fields.unshift("id");
  const example: RuleExample = {
    name,
    expect,
    row: Object.fromEntries(fields.map((field) => [field, written(row[field])])),
  };
  const lists = referencedEstate(when);
  if (lists.length > 0) example.estate = Object.fromEntries(lists.map((list) => [list, estate[list] ?? []]));
  return example;
}

/** A name for a kept example that the rule's other examples do not use yet. */
export function freshExampleName(base: string, taken: readonly RuleExample[]): string {
  const names = new Set(taken.map((example) => example.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export interface ExampleResult {
  example: RuleExample;
  /** The rule agrees with the example. */
  holds: boolean;
  /** What went wrong, when the example or the rule could not run. */
  error?: string;
}

export function runExamples(over: RuleSubject, when: string, examples: readonly RuleExample[]): ExampleResult[] {
  return examples.map((example) => {
    try {
      const matched = exampleMatches(over, when, example);
      return { example, holds: matched === (example.expect === "row") };
    } catch (cause) {
      return { example, holds: false, error: cause instanceof Error ? cause.message.split("\n", 1)[0]! : String(cause) };
    }
  });
}
