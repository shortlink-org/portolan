import { describe, expect, it } from "vitest";
import { inferColumnType, inferColumnTypes } from "./infer";

describe("inferColumnType", () => {
  it("calls a column of integers a number, not a version", () => {
    expect(inferColumnType(["1", "2", "10"])).toBe("number");
  });

  it("calls a dotted column a version", () => {
    expect(inferColumnType(["v1", "v2.1", "10.0.3"])).toBe("version");
  });

  it("calls an ISO column a date", () => {
    expect(inferColumnType(["2024-01-01", "2024-11-30"])).toBe("date");
  });

  it("accepts an ISO timestamp", () => {
    expect(inferColumnType(["2024-01-01T09:30:00Z"])).toBe("date");
  });

  it("refuses a date that only Date.parse would accept", () => {
    expect(inferColumnType(["Jan 3", "Sat"])).toBe("text");
  });

  it("falls back to text on one disagreeing cell", () => {
    expect(inferColumnType(["1", "2", "many"])).toBe("text");
  });

  it("ignores empty cells when sampling", () => {
    expect(inferColumnType(["1", "", "  ", "2"])).toBe("number");
  });

  it("calls an empty column text", () => {
    expect(inferColumnType(["", " "])).toBe("text");
  });

  it("rejects an impossible ISO date", () => {
    expect(inferColumnType(["2024-13-45"])).toBe("text");
  });
});

describe("inferColumnTypes", () => {
  it("infers each column on its own", () => {
    const body = [
      ["a", "1", "2024-01-01"],
      ["b", "2", "2024-02-01"],
    ];
    expect(inferColumnTypes(body, 3)).toEqual(["text", "number", "date"]);
  });

  it("treats a short row as empty in the columns it lacks", () => {
    expect(inferColumnTypes([["1"], ["2", "3"]], 2)).toEqual([
      "number",
      "number",
    ]);
  });
});
