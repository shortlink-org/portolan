import { describe, expect, it } from "vitest";
import {
  activeGroup,
  groupOptions,
  groupingSorting,
  leafRows,
  stripeParity,
} from "./grouping";

describe("activeGroup", () => {
  it("keeps a remembered column this table may fold by", () => {
    expect(activeGroup("scope", ["status", "scope"])).toBe("scope");
  });

  it("drops a column the table lacks, or may not fold by", () => {
    expect(activeGroup("date", ["status", "scope"])).toBeNull();
    expect(activeGroup(null, ["status"])).toBeNull();
  });
});

describe("groupingSorting", () => {
  const readers = [{ id: "date", desc: true }, { id: "title", desc: false }];

  it("hands back the reader's sort untouched when nothing is grouped", () => {
    expect(groupingSorting(readers, null)).toBe(readers);
  });

  it("puts the grouping column first, ascending, ahead of the reader's keys", () => {
    expect(groupingSorting(readers, "scope")).toEqual([
      { id: "scope", desc: false },
      { id: "date", desc: true },
      { id: "title", desc: false },
    ]);
  });

  it("keeps the reader's own direction on the grouping column, once", () => {
    expect(groupingSorting([{ id: "title", desc: false }, { id: "scope", desc: true }], "scope")).toEqual([
      { id: "scope", desc: true },
      { id: "title", desc: false },
    ]);
  });
});

describe("stripeParity", () => {
  it("gives a header no parity and starts the count again beneath it", () => {
    expect(stripeParity([true, false, false, false, true, false, false])).toEqual([
      null, true, false, true, null, true, false,
    ]);
  });

  it("is plain alternation without headers", () => {
    expect(stripeParity([false, false, false])).toEqual([true, false, true]);
  });
});

describe("groupOptions", () => {
  it("offers exactly the columns that have a chip-set", () => {
    expect(
      groupOptions([
        { columnId: "status", label: "status", values: [], selected: [] },
        { columnId: "scope", label: "scope", values: [], selected: [] },
      ]),
    ).toEqual([
      { id: "status", header: "status" },
      { id: "scope", header: "scope" },
    ]);
  });
});

describe("leafRows", () => {
  type R = { id: string; subRows: R[]; getIsGrouped: () => boolean };
  const leaf = (id: string): R => ({ id, subRows: [], getIsGrouped: () => false });
  const group = (id: string, subRows: R[]): R => ({ id, subRows, getIsGrouped: () => true });

  it("walks into every group, open or not, and keeps the display order", () => {
    const rows = [group("g1", [leaf("a"), leaf("b")]), group("g2", [leaf("c")])];
    expect(leafRows(rows).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("is the identity on an ungrouped table", () => {
    const rows = [leaf("a"), leaf("b")];
    expect(leafRows(rows)).toEqual(rows);
  });
});
