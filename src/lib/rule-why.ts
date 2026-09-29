// Why a rule said what it said about one row.
//
// The rule page highlights the part of a row that decided it: the field a
// condition read, and in a list the element that made it hold. CEL does not
// say which of its inputs mattered, so this asks it: every field the
// condition names is changed in turn - a string emptied, an int zeroed, a
// bool flipped, a list cleared - and a field whose change flips the answer is
// the one that decided it. A list is taken apart further, one element at a
// time, so `fields.exists(f, f == 'email')` lights `email`, not `fields`.
//
// When no one field flips the answer - `a || b` with both true - the fields
// the condition names are all shown as taking part, and none as deciding.
// The heuristic runs only for the row a reader opened: a few dozen calls of a
// compiled expression, never a pass over the catalog.

import { compileExpression, ESTATE_SCHEMA, SUBJECTS } from "./problem-rules-cel.mjs";
import type { FieldType, RuleSubject } from "./problem-rules-cel.mjs";

/** A field named in the source as `<name>.<field>`, when the schema has it; in first-mention order. */
function namedFields(name: string, schema: Record<string, FieldType>, source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
    const field = match[1]!;
    if (Object.hasOwn(schema, field)) seen.add(field);
  }
  return [...seen];
}

/** The subject's fields a condition reads. */
export function referencedFields(over: RuleSubject, source: string): string[] {
  return namedFields(over, SUBJECTS[over].schema, source);
}

/** The estate lists a condition reads. */
export function referencedEstate(source: string): string[] {
  return namedFields("estate", ESTATE_SCHEMA, source);
}

export interface FieldWhy {
  field: string;
  type: FieldType;
  /** Changing this field alone changes the answer. */
  decisive: boolean;
  /** For a list: the elements that decided it. Empty when the list decided as a whole. */
  items: string[];
}

export interface Why {
  /** What the condition says about the row as it is. */
  outcome: boolean;
  /** Every field the condition reads, in the order it names them. */
  fields: FieldWhy[];
  /** The row matched on several fields, and no one of them decides alone. */
  joint: boolean;
}

// A mark no catalog value carries, for the one case where emptying a value
// changes nothing because it is already empty.
const OTHER = "⁣";

/** A value of the same type that is not this one. */
function otherValue(type: FieldType, value: unknown): unknown {
  switch (type) {
    case "bool":
      return !value;
    case "int":
      return value === 0n ? 1n : 0n;
    case "list<string>":
      return Array.isArray(value) && value.length > 0 ? [] : [OTHER];
    default:
      return value === "" ? OTHER : "";
  }
}

/** Past this, a list is shown as a whole rather than taken apart. */
const MAX_ITEMS = 64;

export function whyOf(over: RuleSubject, when: string, row: Record<string, unknown>, estate: Record<string, unknown>): Why {
  const expression = compileExpression(over, when, "bool");
  // A variation that makes the expression throw says nothing about the row.
  const run = (variant: Record<string, unknown>): boolean | null => {
    try {
      return expression({ [over]: variant, estate }) === true;
    } catch {
      return null;
    }
  };
  const outcome = run(row) === true;
  const flips = (variant: Record<string, unknown>) => {
    const answer = run(variant);
    return answer !== null && answer !== outcome;
  };
  const schema = SUBJECTS[over].schema;

  const fields = referencedFields(over, when).map((field): FieldWhy => {
    const type = schema[field]!;
    const value = row[field];
    const decisive = flips({ ...row, [field]: otherValue(type, value) });
    let items: string[] = [];
    if (type === "list<string>" && Array.isArray(value) && value.length > 1 && value.length <= MAX_ITEMS) {
      const list = value as string[];
      // The element whose removal alone flips the answer.
      items = list.filter((_, at) => flips({ ...row, [field]: list.filter((__, other) => other !== at) }));
      // Or, when several would do - two personal fields, either enough -
      // the elements that on their own keep the answer the row has.
      if (items.length === 0 && decisive) {
        const alone = list.filter((item) => run({ ...row, [field]: [item] }) === outcome);
        if (alone.length < list.length) items = alone;
      }
      // Every element counts - `size(...) > 1` - so it is the list that decided.
      if (items.length === list.length) items = [];
    } else if (type === "list<string>" && Array.isArray(value) && value.length === 1 && decisive) {
      items = [value[0] as string];
    }
    return { field, type, decisive: decisive || items.length > 0, items };
  });

  // Only a match has a cause to share out; a row the condition leaves out
  // just does not meet it, and one field cannot take part "together".
  return { outcome, fields, joint: outcome && fields.length > 1 && !fields.some((field) => field.decisive) };
}

/** A row value as the page prints it. */
export function shownValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value === "" ? "\"\"" : value;
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.join(", ");
  return String(value);
}
