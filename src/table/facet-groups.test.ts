import { describe, expect, it } from "vitest";
import { facetGroupFrom, facetValuesFrom } from "./facet-groups";
import type { ColumnSpec } from "./types";

type Row = { status: string; note?: string };

const status: ColumnSpec<Row> = {
  id: "status",
  header: "status",
  type: "status",
  value: (row) => row.status,
  facet: true,
};

describe("facetValuesFrom", () => {
  it("skips the empty cell and counts the rest", () => {
    const counts = new Map<unknown, number>([
      ["declared", 2],
      [undefined, 5],
      ["verified", 3],
    ]);
    expect(facetValuesFrom(counts, "status")).toEqual([
      { value: "verified", count: 3 },
      { value: "declared", count: 2 },
    ]);
  });

  it("is no facet at all when there is only one value", () => {
    const counts = new Map<unknown, number>([["verified", 9], [undefined, 1]]);
    expect(facetValuesFrom(counts, "status")).toEqual([]);
  });

  it("merges keys that read the same", () => {
    const counts = new Map<unknown, number>([[1, 2], ["1", 3], ["2", 1]]);
    expect(facetValuesFrom(counts, "text")).toEqual([
      { value: "1", count: 5 },
      { value: "2", count: 1 },
    ]);
  });

  it("orders kinds by the taxonomy, not the alphabet", () => {
    const counts = new Map<unknown, number>([["service", 1], ["event", 1], ["aggregate", 1]]);
    expect(facetValuesFrom(counts, "kind").map((facet) => facet.value)).toEqual([
      "event",
      "aggregate",
      "service",
    ]);
  });
});

describe("facetGroupFrom", () => {
  const counts = new Map<unknown, number>([["verified", 1], ["declared", 1]]);

  it("builds the group the toolbar draws", () => {
    expect(facetGroupFrom(status, counts, ["declared"])).toEqual({
      columnId: "status",
      label: "status",
      values: [
        { value: "verified", count: 1 },
        { value: "declared", count: 1 },
      ],
      selected: ["declared"],
    });
  });

  it("offers nothing for a column that is not a facet, or cannot be one", () => {
    expect(facetGroupFrom({ ...status, facet: false }, counts, [])).toBeNull();
    expect(facetGroupFrom({ ...status, type: "number" }, counts, [])).toBeNull();
  });

  it("offers nothing when the values would make a set of one", () => {
    expect(facetGroupFrom(status, new Map([["verified", 4]]), [])).toBeNull();
  });
});
