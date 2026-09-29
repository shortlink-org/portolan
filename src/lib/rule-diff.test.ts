// What an edit to a rule adds and drops, before it is saved.

import { describe, expect, it } from "vitest";
import type { RowVerdict } from "./problem-rules";
import { diffRows, rowKey } from "./rule-diff";

const verdict = (service: string, id: string, matched: boolean, note?: string): RowVerdict => ({
  subject: { id, service, context: "", source: undefined, row: {} },
  matched,
  ...(note ? { note } : {}),
});

describe("the rows an edit changes", () => {
  it("marks a row the draft adds as added and one only the saved rule had as gone", () => {
    const saved = [verdict("oms", "OrderPlaced", true), verdict("crm", "LeadCaptured", true), verdict("auth", "UserRegistered", false)];
    const draft = [verdict("oms", "OrderPlaced", true), verdict("crm", "LeadCaptured", false), verdict("auth", "UserRegistered", true)];
    const diff = diffRows(saved, draft);
    expect([...diff.added]).toEqual([rowKey(verdict("auth", "UserRegistered", true))]);
    expect([...diff.gone]).toEqual([rowKey(verdict("crm", "LeadCaptured", true))]);
  });

  it("keeps a row whose note changed as the same row", () => {
    const diff = diffRows([verdict("oms", "OrderPlaced", true, "old")], [verdict("oms", "OrderPlaced", true, "new")]);
    expect(diff.added.size + diff.gone.size).toBe(0);
  });

  it("tells the same id in two services apart", () => {
    const diff = diffRows([verdict("oms", "Created", true)], [verdict("billing", "Created", true)]);
    expect(diff.added.size).toBe(1);
    expect(diff.gone.size).toBe(1);
  });
});
