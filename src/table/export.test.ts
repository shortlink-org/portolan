import { describe, expect, it } from "vitest";
import { csvFilename, toCsv, toMarkdown } from "./export";

const SHEET = {
  headers: ["name", "consumers"],
  rows: [
    ["order.placed", "3"],
    ["order.cancelled", "1"],
  ],
};

describe("toMarkdown", () => {
  it("writes a header, a delimiter and one line per row", () => {
    expect(toMarkdown(SHEET)).toBe(
      [
        "| name | consumers |",
        "| --- | --- |",
        "| order.placed | 3 |",
        "| order.cancelled | 1 |",
      ].join("\n"),
    );
  });

  it("escapes a pipe so the row keeps its width", () => {
    const out = toMarkdown({ headers: ["a"], rows: [["x | y"]] });
    expect(out.split("\n")[2]).toBe("| x \\| y |");
  });

  it("flattens a newline rather than breaking the row", () => {
    const out = toMarkdown({ headers: ["a"], rows: [["one\ntwo"]] });
    expect(out.split("\n")).toHaveLength(3);
    expect(out.split("\n")[2]).toBe("| one two |");
  });

  it("pads a short row out to the header width", () => {
    const out = toMarkdown({ headers: ["a", "b"], rows: [["x"]] });
    expect(out.split("\n")[2]).toBe("| x |  |");
  });

  it("writes nothing when there are no columns", () => {
    expect(toMarkdown({ headers: [], rows: [] })).toBe("");
  });
});

describe("toCsv", () => {
  it("writes CRLF rows", () => {
    expect(toCsv(SHEET)).toBe(
      "name,consumers\r\norder.placed,3\r\norder.cancelled,1",
    );
  });

  it("quotes a cell holding a comma", () => {
    expect(toCsv({ headers: ["a"], rows: [["x,y"]] })).toBe('a\r\n"x,y"');
  });

  it("doubles an embedded quote", () => {
    expect(toCsv({ headers: ["a"], rows: [['say "hi"']] })).toBe(
      'a\r\n"say ""hi"""',
    );
  });

  it("keeps a newline inside its quotes", () => {
    expect(toCsv({ headers: ["a"], rows: [["one\ntwo"]] })).toBe(
      'a\r\n"one\ntwo"',
    );
  });
});

describe("csvFilename", () => {
  it("slugs the table id", () => {
    expect(csvFilename("adr.index")).toBe("adr-index.csv");
  });

  it("falls back when the id slugs to nothing", () => {
    expect(csvFilename("///")).toBe("table.csv");
  });
});
