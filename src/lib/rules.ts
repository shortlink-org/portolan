// What a field's rules say, in words a reader scans.
//
// A rule arrives as the catalog spells it - `min_len 1`, `items.max_len 64`,
// `format email` - the same spelling whether a Protovalidate option or a JSON
// Schema keyword put it there. The page shows each as a short mark beside the
// type, "≥ 1 chars", and keeps the spelling for the tooltip, which is what
// a reader copies into a search of the source. A rule the catalog has no
// words for, a custom option, is shown as it was written rather than hidden.

import type { Field, FieldRule } from "../catalog";

export interface RuleMark {
  /** The chip: a few words, or the value alone when the value is the point. */
  text: string;
  /** The rule as the fragment carries it: `min_len = 1`. */
  title: string;
}

/** What a rule on the members of a list or map is about, by its prefix. */
const OF: Record<string, string> = {
  items: "each",
  keys: "each key",
  values: "each value",
};

const WORDS: Record<string, (v: string) => string> = {
  min_len: (v) => `≥ ${v} chars`,
  max_len: (v) => `≤ ${v} chars`,
  len: (v) => `${v} chars`,
  min_items: (v) => `≥ ${v} items`,
  max_items: (v) => `≤ ${v} items`,
  min_pairs: (v) => `≥ ${v} entries`,
  max_pairs: (v) => `≤ ${v} entries`,
  gt: (v) => `> ${v}`,
  gte: (v) => `≥ ${v}`,
  lt: (v) => `< ${v}`,
  lte: (v) => `≤ ${v}`,
  const: (v) => `= ${v}`,
  multiple_of: (v) => `multiple of ${v}`,
  in: (v) => `one of ${v}`,
  not_in: (v) => `none of ${v}`,
  pattern: (v) => `matches ${v}`,
  prefix: (v) => `starts with ${v}`,
  suffix: (v) => `ends with ${v}`,
  contains: (v) => `contains ${v}`,
  not_contains: (v) => `never contains ${v}`,
  format: (v) => v,
  unique: () => "unique",
  defined_only: () => "a defined value",
  lt_now: () => "in the past",
  gt_now: () => "in the future",
  cel: () => "cel",
};

/** The mark for one rule. */
export function ruleMark(rule: FieldRule): RuleMark {
  const title = rule.value === undefined ? rule.name : `${rule.name} = ${rule.value}`;
  const value = rule.value ?? "";

  // A custom option keeps its own name; `(acme.pii)` says more than any
  // words the catalog could put to it.
  if (rule.name.startsWith("(")) {
    return { text: value && value !== "true" ? `${rule.name} ${value}` : rule.name, title };
  }

  const dot = rule.name.indexOf(".");
  const of = dot > 0 ? OF[rule.name.slice(0, dot)] : undefined;
  const base = of ? rule.name.slice(dot + 1) : rule.name;
  const words = WORDS[base];
  const text = words ? words(value) : value ? `${base} ${value}` : base;

  return { text: of ? `${of} ${text}` : text, title };
}

/** Every mark a field wears: `required` first, then its rules as written. */
export function ruleMarks(field: Field): RuleMark[] {
  const marks: RuleMark[] = [];
  if (field.required) {
    marks.push({ text: "required", title: "must be sent" });
  }
  for (const rule of field.rules ?? []) {
    marks.push(ruleMark(rule));
  }

  return marks;
}
