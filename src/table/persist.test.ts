import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMORY,
  hiddenOf,
  parseMemory,
  serializeMemory,
  visibilityOf,
} from "./persist";

describe("parseMemory", () => {
  it("round-trips what it wrote", () => {
    const memory = { sizing: { title: 320 }, hidden: ["scope"] };
    expect(parseMemory(serializeMemory(memory))).toEqual(memory);
  });

  it("reads nothing out of nothing", () => {
    expect(parseMemory(null)).toEqual(EMPTY_MEMORY);
  });

  it("survives a value that is not JSON", () => {
    expect(parseMemory("{not json")).toEqual(EMPTY_MEMORY);
  });

  it("survives JSON that is not an object", () => {
    expect(parseMemory("42")).toEqual(EMPTY_MEMORY);
    expect(parseMemory("null")).toEqual(EMPTY_MEMORY);
  });

  it("drops a width that is not a width", () => {
    const raw = JSON.stringify({
      sizing: { a: 100, b: "wide", c: -5, d: 0 },
      hidden: [],
    });
    expect(parseMemory(raw).sizing).toEqual({ a: 100 });
  });

  it("drops a hidden entry that is not a column id", () => {
    const raw = JSON.stringify({ sizing: {}, hidden: ["a", 7, null] });
    expect(parseMemory(raw).hidden).toEqual(["a"]);
  });

  it("tolerates a half-written shape", () => {
    expect(parseMemory('{"hidden":["a"]}')).toEqual({
      sizing: {},
      hidden: ["a"],
    });
  });
});

describe("visibilityOf", () => {
  it("marks hidden columns with an explicit false", () => {
    expect(visibilityOf(["scope", "date"])).toEqual({
      scope: false,
      date: false,
    });
  });

  it("says nothing about columns that are shown", () => {
    expect(visibilityOf([])).toEqual({});
  });

  it("inverts back to the same list", () => {
    expect(hiddenOf(visibilityOf(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("ignores columns explicitly switched on", () => {
    expect(hiddenOf({ a: true, b: false })).toEqual(["b"]);
  });
});
