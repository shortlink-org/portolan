// What an edit does to a rule's rows before it is saved.
//
// The rule page runs the saved rule and the draft over the same catalog and
// marks the difference: a row the draft adds is new, a row only the saved
// rule had is gone. A row is the same row when it is the same subject of the
// same service; its note may change without the row being new.

import type { RowVerdict } from "./problem-rules";

/** Which subject a verdict is about, across two runs of a rule. */
export function rowKey(verdict: Pick<RowVerdict, "subject">): string {
  return `${verdict.subject.service}\u0000${verdict.subject.id}`;
}

export interface RowDiff {
  /** Keys of rows the draft matches and the saved rule does not. */
  added: Set<string>;
  /** Keys of rows the saved rule matches and the draft does not. */
  gone: Set<string>;
}

export function diffRows(saved: readonly RowVerdict[], draft: readonly RowVerdict[]): RowDiff {
  const before = new Set(saved.filter((row) => row.matched).map(rowKey));
  const after = new Set(draft.filter((row) => row.matched).map(rowKey));
  return {
    added: new Set([...after].filter((key) => !before.has(key))),
    gone: new Set([...before].filter((key) => !after.has(key))),
  };
}
