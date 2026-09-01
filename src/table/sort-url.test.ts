import { describe, expect, it } from "vitest";
import { formatSort, parseSort, sameSort } from "./sort-url";

const COLUMNS = ["name", "consumers", "date"];

describe("parseSort", () => {
  it("reads one term", () => {
    expect(parseSort("name.desc", COLUMNS)).toEqual([
      { id: "name", desc: true },
    ]);
  });

  it("reads a secondary key in order", () => {
    expect(parseSort("consumers.desc,name.asc", COLUMNS)).toEqual([
      { id: "consumers", desc: true },
      { id: "name", desc: false },
    ]);
  });

  it("drops a column this table does not have", () => {
    expect(parseSort("nonsense.asc,name.asc", COLUMNS)).toEqual([
      { id: "name", desc: false },
    ]);
  });

  it("drops a direction that is not a direction", () => {
    expect(parseSort("name.sideways", COLUMNS)).toEqual([]);
  });

  it("drops a repeated column", () => {
    expect(parseSort("name.asc,name.desc", COLUMNS)).toEqual([
      { id: "name", desc: false },
    ]);
  });

  it("keeps a column id that contains a dot", () => {
    expect(parseSort("a.b.desc", ["a.b"])).toEqual([{ id: "a.b", desc: true }]);
  });

  it("reads nothing out of nothing", () => {
    expect(parseSort(null, COLUMNS)).toEqual([]);
    expect(parseSort("", COLUMNS)).toEqual([]);
  });
});

describe("formatSort", () => {
  it("round-trips", () => {
    const sort = parseSort("consumers.desc,name.asc", COLUMNS);
    expect(formatSort(sort)).toBe("consumers.desc,name.asc");
  });

  it("writes nothing for an unsorted table", () => {
    expect(formatSort([])).toBe("");
  });
});

describe("sameSort", () => {
  it("compares by value and by order", () => {
    expect(sameSort([{ id: "a", desc: false }], [{ id: "a", desc: false }])).toBe(
      true,
    );
    expect(
      sameSort(
        [
          { id: "a", desc: false },
          { id: "b", desc: false },
        ],
        [
          { id: "b", desc: false },
          { id: "a", desc: false },
        ],
      ),
    ).toBe(false);
  });
});
