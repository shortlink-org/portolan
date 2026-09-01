import { describe, expect, it } from "vitest";
import {
  TABLE_DIRECTIVE_ATTR,
  columnSlug,
  parseTableComment,
  parseTableDirective,
  remarkTableDirective,
} from "./table-directive";

describe("parseTableComment", () => {
  it("reads the body of a table comment", () => {
    expect(parseTableComment("<!-- table: static -->")).toBe("static");
  });

  it("tolerates the spacing an author actually types", () => {
    expect(parseTableComment("<!--table:static-->")).toBe("static");
    expect(parseTableComment("  <!--   table:   static   -->  ")).toBe("static");
  });

  it("leaves an ordinary comment alone", () => {
    expect(parseTableComment("<!-- prettier-ignore -->")).toBeNull();
  });

  it("reads an empty directive as empty, not as absent", () => {
    expect(parseTableComment("<!-- table: -->")).toBe("");
  });
});

describe("parseTableDirective", () => {
  it("reads static", () => {
    expect(parseTableDirective("static")).toEqual({ static: true, sort: null });
  });

  it("reads a default sort", () => {
    expect(parseTableDirective("sort=name.desc")).toEqual({
      static: false,
      sort: { id: "name", desc: true },
    });
  });

  it("reads both at once", () => {
    expect(parseTableDirective("static sort=name.asc")).toEqual({
      static: true,
      sort: { id: "name", desc: false },
    });
  });

  it("keeps a column id containing a dot", () => {
    expect(parseTableDirective("sort=a.b.desc").sort).toEqual({
      id: "a.b",
      desc: true,
    });
  });

  it("ignores a word it does not know", () => {
    expect(parseTableDirective("sideways sort=a.asc")).toEqual({
      static: false,
      sort: { id: "a", desc: false },
    });
  });

  it("ignores a direction that is not one", () => {
    expect(parseTableDirective("sort=a.sideways").sort).toBeNull();
  });
});

describe("columnSlug", () => {
  it("slugs a header", () => {
    expect(columnSlug("Last seen", new Set())).toBe("last-seen");
  });

  it("numbers a repeat rather than colliding", () => {
    const taken = new Set(["name"]);
    expect(columnSlug("name", taken)).toBe("name-2");
  });

  it("falls back for a header with nothing sluggable in it", () => {
    expect(columnSlug("—", new Set())).toBe("col");
  });
});

describe("remarkTableDirective", () => {
  const run = (tree: unknown) => {
    remarkTableDirective()(tree as never);
    return tree as { children: { data?: { hProperties?: Record<string, string> } }[] };
  };

  it("attaches the comment above a table to it", () => {
    const tree = run({
      type: "root",
      children: [
        { type: "html", value: "<!-- table: static -->" },
        { type: "table", children: [] },
      ],
    });
    expect(tree.children[1]?.data?.hProperties).toEqual({
      [TABLE_DIRECTIVE_ATTR]: "static",
    });
  });

  it("leaves a table with nothing above it alone", () => {
    const tree = run({ type: "root", children: [{ type: "table", children: [] }] });
    expect(tree.children[0]?.data).toBeUndefined();
  });

  it("ignores a comment separated from the table by a paragraph", () => {
    const tree = run({
      type: "root",
      children: [
        { type: "html", value: "<!-- table: static -->" },
        { type: "paragraph", children: [] },
        { type: "table", children: [] },
      ],
    });
    expect(tree.children[2]?.data).toBeUndefined();
  });

  it("reaches a table nested inside a blockquote", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "blockquote",
          children: [
            { type: "html", value: "<!-- table: sort=n.desc -->" },
            { type: "table", children: [] },
          ],
        },
      ],
    }) as never as {
      children: {
        children: { data?: { hProperties?: Record<string, string> } }[];
      }[];
    };
    expect(tree.children[0]?.children[1]?.data?.hProperties).toEqual({
      [TABLE_DIRECTIVE_ATTR]: "sort=n.desc",
    });
  });
});
