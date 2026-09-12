// What the source says a field's value must satisfy, as marks beside the
// type: "required", "≥ 1 chars", "one of USD, EUR". One component so the
// schema table, the field tree and the inline shape of a request say it the
// same way; the words come from lib/rules.

import type { Field } from "../catalog";
import { ruleMarks } from "../lib/rules";

export function RuleMarks({ field }: { field: Field }) {
  const marks = ruleMarks(field);
  if (marks.length === 0) return null;

  return (
    <>
      {marks.map((mark) => (
        <span key={mark.title} className="type-mark rule-mark" title={mark.title}>
          {mark.text}
        </span>
      ))}
    </>
  );
}
