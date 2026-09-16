import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Field } from "../../src/catalog.ts";
import { readSource } from "./source.ts";
import { zodFields } from "./rules.ts";

// The schemas are read off disk, because a schema is followed by name and a
// name may have been given in the file next door.
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "extract-ts-zod-")));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  return root;
}

/** The fields of `const schema = …` in a file that imports zod. */
function fields(body: string, name = "schema", files: Record<string, string> = {}): Field[] | undefined {
  const root = tree({ "schema.ts": `import { z } from "zod";\n${body}\n`, ...files });
  const src = readSource(join(root, "schema.ts"))!;
  return zodFields(src, src.consts.get(name)!);
}

/** The one field named, for the cases that are about one field. */
function field(schema: string, name = "value"): Field {
  return fields(`const schema = z.object({ ${name}: ${schema} });`)!.find((f) => f.name === name)!;
}

describe("what a field must satisfy", () => {
  it("reads a string's bounds as the catalog spells them", () => {
    expect(field("z.string().min(1).max(64)")).toEqual({
      name: "value",
      type: "string",
      doc: "",
      required: true,
      rules: [
        { name: "min_len", value: "1" },
        { name: "max_len", value: "64" },
      ],
    });
  });

  it("tells a number's bounds from a string's, under the same call", () => {
    expect(field("z.number().min(1).max(99)").rules).toEqual([
      { name: "gte", value: "1" },
      { name: "lte", value: "99" },
    ]);
    expect(field("z.string().length(3)").rules).toEqual([{ name: "len", value: "3" }]);
  });

  it("reads the bounds a word stands for", () => {
    expect(field("z.number().positive()").rules).toEqual([{ name: "gt", value: "0" }]);
    expect(field("z.number().nonnegative()").rules).toEqual([{ name: "gte", value: "0" }]);
    expect(field("z.string().nonempty()").rules).toEqual([{ name: "min_len", value: "1" }]);
    expect(field("z.number().multipleOf(5)").rules).toEqual([{ name: "multiple_of", value: "5" }]);
  });

  it("keeps an integer in the type, where every other source keeps it", () => {
    const value = field("z.number().int().gte(0)");
    expect(value.type).toBe("integer");
    expect(value.rules).toEqual([{ name: "gte", value: "0" }]);
    expect(field("z.int().max(99)").type).toBe("integer");
  });

  it("reads a string's shape as a format, in the spelling a document uses", () => {
    expect(field("z.string().uuid()").rules).toEqual([{ name: "format", value: "uuid" }]);
    expect(field("z.string().url()").rules).toEqual([{ name: "format", value: "uri" }]);
    expect(field("z.email()").rules).toEqual([{ name: "format", value: "email" }]);
    expect(field("z.iso.datetime()").rules).toEqual([{ name: "format", value: "date-time" }]);
  });

  it("reads a pattern without the slashes a flag hangs off", () => {
    expect(field("z.string().regex(/^[A-Z]{3}$/i)").rules).toEqual([{ name: "pattern", value: "^[A-Z]{3}$" }]);
  });

  it("reads what a string must begin, end or hold", () => {
    expect(field("z.string().startsWith('sku-').endsWith('-x').includes('mid')").rules).toEqual([
      { name: "prefix", value: "sku-" },
      { name: "suffix", value: "-x" },
      { name: "contains", value: "mid" },
    ]);
  });

  it("reads a closed set as one rule, from an enum or a union of literals", () => {
    expect(field("z.enum(['draft', 'paid'])").rules).toEqual([{ name: "in", value: "draft, paid" }]);
    expect(field("z.union([z.literal('s'), z.literal('m')])").rules).toEqual([{ name: "in", value: "s, m" }]);
    expect(field("z.literal('order')").rules).toEqual([{ name: "const", value: "order" }]);
  });

  it("puts a rule on what a list holds under items", () => {
    const lines = field("z.array(z.string().min(1)).min(1).max(10)");
    expect(lines.type).toBe("string[]");
    expect(lines.rules).toEqual([
      { name: "items.min_len", value: "1" },
      { name: "min_items", value: "1" },
      { name: "max_items", value: "10" },
    ]);
  });

  it("says a list of exactly n as the two bounds it is", () => {
    expect(field("z.array(z.string()).length(2)").rules).toEqual([
      { name: "min_items", value: "2" },
      { name: "max_items", value: "2" },
    ]);
  });

  it("puts a map's rules under its keys and its values", () => {
    const totals = field("z.record(z.string().length(3), z.number().gte(0))");
    expect(totals.type).toBe("Record<string, number>");
    expect(totals.rules).toEqual([
      { name: "keys.len", value: "3" },
      { name: "values.gte", value: "0" },
    ]);
  });

  it("names a predicate it has no words for, with the message the call gives", () => {
    expect(field("z.string().refine((s) => s.length > 2, 'too short')").rules).toEqual([{ name: "refine", value: "too short" }]);
    expect(field("z.string().refine((s) => s !== '')").rules).toEqual([{ name: "refine" }]);
  });

  it("leaves out what says how a value is carried rather than what it must be", () => {
    expect(field("z.string().trim().toLowerCase().brand('Sku').describe('the sku')").rules).toBeUndefined();
    expect(field("z.string().describe('the sku')").doc).toBe("the sku");
  });

  it("writes a bound as the source wrote it", () => {
    expect(field("z.number().lte(9_007_199_254_740_993)").rules).toEqual([{ name: "lte", value: "9007199254740993" }]);
  });
});

describe("whether a field must be sent", () => {
  it("is required unless the schema lets it be left out", () => {
    expect(field("z.string()").required).toBe(true);
    expect(field("z.string().optional()").required).toBeUndefined();
    expect(field("z.string().nullish()").required).toBeUndefined();
    expect(field("z.string().default('x')").required).toBeUndefined();
  });

  it("stays required when null is only a value it may hold", () => {
    expect(field("z.string().nullable()").required).toBe(true);
  });

  it("follows what partial and required say about every field at once", () => {
    expect(fields("const schema = z.object({ a: z.string(), b: z.number() }).partial();")!.every((f) => f.required === undefined)).toBe(true);
    expect(fields("const schema = z.object({ a: z.string().optional() }).required();")![0]!.required).toBe(true);
  });
});

describe("a schema that was given a name", () => {
  it("is followed to what it was given", () => {
    const out = fields(`
const money = z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().length(3) });
const schema = z.object({ sku: z.string().min(1), unitPrice: money });
`)!;
    expect(out.map((f) => `${f.name}:${f.type}`)).toEqual(["sku:string", "unitPrice:money"]);
    expect(out[1]!.rules).toBeUndefined();
  });

  it("is followed across the file it was given in", () => {
    const out = fields(`import { params } from "./params.ts";\nconst schema = params.extend({ sku: z.string().min(1) });`, "schema", {
      "params.ts": `import { z } from "zod";\nexport const params = z.object({ basketId: z.string().uuid() });\n`,
    })!;
    expect(out.map((f) => f.name)).toEqual(["basketId", "sku"]);
    expect(out[0]!.rules).toEqual([{ name: "format", value: "uuid" }]);
  });

  it("takes the later word when one extends another", () => {
    const out = fields(`
const base = z.object({ sku: z.string(), quantity: z.number() });
const schema = base.extend({ quantity: z.number().int().max(99) });
`)!;
    expect(out.map((f) => f.name)).toEqual(["sku", "quantity"]);
    expect(out[1]!.rules).toEqual([{ name: "lte", value: "99" }]);
  });

  it("keeps or drops what pick and omit name", () => {
    expect(fields(`const base = z.object({ a: z.string(), b: z.string() });\nconst schema = base.pick({ a: true });`)!.map((f) => f.name)).toEqual(["a"]);
    expect(fields(`const base = z.object({ a: z.string(), b: z.string() });\nconst schema = base.omit({ a: true });`)!.map((f) => f.name)).toEqual(["b"]);
  });
});

describe("what is not a zod schema", () => {
  it("is not read as one", () => {
    expect(fields("const schema = JSON.parse('{}');")).toBeUndefined();
    expect(fields("const schema = { sku: 'x' };")).toBeUndefined();
    expect(fields("const schema = other.extend({ a: z.string() });")).toBeUndefined();
  });

  it("is not read from a module that imports something else called z", () => {
    const root = tree({ "schema.ts": `import { z } from "not-zod";\nconst schema = z.object({ a: z.string() });\n` });
    const src = readSource(join(root, "schema.ts"))!;
    expect(zodFields(src, src.consts.get("schema")!)).toBeUndefined();
  });
});
