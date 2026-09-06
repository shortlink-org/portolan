import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paramTypeOf, readSource, resolveImport, returnTypeText, sourceFiles, sourceNamed } from "./source.ts";
import { isPropertySig, typeText } from "./ast.ts";

// A JavaScript tree written to disk, because readSource reads files and the
// imports a doc comment implies are resolved against what sits beside them.
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "extract-ts-js-")));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  return root;
}

const ROOT = tree({
  "port.js": `
/** @typedef {import("./basket.js").Basket} Basket */
/**
 * @typedef {Object} Repo
 * @property {(id: string) => Promise<Basket>} byId
 * @property {(basket: Basket) => Promise<void>} save the write
 */
/** @typedef {{ quote(id: string): Promise<{ total: number }> }} Pricing */
/** @typedef {"open" | "closed"} Status */
export {};
`,
  "basket.js": `
/** @typedef {import("./port.js").Status} Status */
export class Basket {
  /** @type {string[]} */
  lines = [];
  /** @type {Status} */
  status = "open";
  count = 0;
  /**
   * @param {string} id
   * @param {number} version
   */
  constructor(id, version) {
    this.id = id;
    /** The write count, not the read count. */
    this.version = version;
    this.opened = new Date();
    this.name = "not a wire name";
  }
  /** @returns {Promise<Basket>} */
  async reload() { return this; }
  static create() { return new Basket("x", 0); }
}
/**
 * @param {import("./port.js").Repo} repo
 * @param {string} id
 * @returns {Promise<Basket>}
 */
export async function load(repo, id) { return repo.byId(id); }
`,
  "index.ts": `export const x = 1;`,
  "index.test.js": `export const y = 2;`,
  "types.d.ts": `export interface paths {}`,
});

describe("a JavaScript source", () => {
  const port = readSource(join(ROOT, "port.js"))!;
  const basket = readSource(join(ROOT, "basket.js"))!;

  it("files a typedef of an import() as the import it is", () => {
    const imp = port.imports.find((i) => i.local === "Basket");
    expect(imp).toMatchObject({ imported: "Basket", specifier: "./basket.js", typeOnly: true });
    expect(imp?.file).toBe(join(ROOT, "basket.js"));
  });

  it("reads an object typedef, by properties or by literal, as the interface it stands for; an alias is nothing", () => {
    const repo = port.interfaces.get("Repo")!;
    expect(repo.node.body.body.map((m) => m.type)).toEqual(["TSPropertySignature", "TSPropertySignature"]);
    expect(port.interfaces.get("Pricing")?.node.body.body.map((m) => m.type)).toEqual(["TSMethodSignature"]);
    expect(port.interfaces.has("Status")).toBe(false);
    // The interface carries its own text: the member's type reads back whole.
    const save = repo.node.body.body[1]!;
    expect(isPropertySig(save) && save.typeAnnotation?.typeAnnotation.type).toBe("TSFunctionType");
  });

  it("reads a class's fields off @type and off what the constructor assigns to this", () => {
    const cls = basket.classes[0]!;
    expect(cls.fields.map((f) => `${f.name}:${f.type}`)).toEqual(["lines:string[]", "status:Status", "count:number", "id:string", "version:number", "opened:Date"]);
    expect(cls.fields.find((f) => f.name === "version")?.doc).toBe("The write count, not the read count.");
    // `this.name = …` in a constructor is a field, not the wire name a class-level literal is.
    expect(cls.nameLiteral).toBeUndefined();
    expect(cls.params).toEqual([{ name: "id", type: "string" }, { name: "version", type: "number" }]);
    expect(cls.methods.get("reload")?.returns).toBe("Promise<Basket>");
    expect(cls.methods.get("create")?.returns).toBe("");
    // A typedef alias in the class's own file is an import too.
    expect(basket.imports.find((i) => i.local === "Status")?.file).toBe(join(ROOT, "port.js"));
  });

  it("reads a function's parameter and return types off its tags, an import() among them", () => {
    const fn = basket.functions.get("load")!;
    expect(returnTypeText(basket, fn)).toBe("Promise<Basket>");
    const repo = paramTypeOf(basket, fn, fn.params[0]!)!;
    expect(typeText(repo.p, repo.ann)).toBe("Repo");
    expect(basket.imports.find((i) => i.local === "Repo")?.file).toBe(join(ROOT, "port.js"));
  });

  it("lists sources of either language, and finds a fixed name in whichever it was written", () => {
    expect(sourceFiles(ROOT).map((f) => f.slice(ROOT.length + 1))).toEqual(["basket.js", "index.ts", "port.js"]);
    expect(sourceNamed(ROOT, "port")).toBe(join(ROOT, "port.js"));
    expect(sourceNamed(ROOT, "index")).toBe(join(ROOT, "index.ts"));
    expect(sourceNamed(ROOT, "missing")).toBe(join(ROOT, "missing.ts"));
  });

  it("resolves a specifier to the file that exists: as written, its TypeScript twin, or a declaration", () => {
    const from = join(ROOT, "basket.js");
    expect(resolveImport(from, "./port.js")).toBe(join(ROOT, "port.js"));
    expect(resolveImport(from, "./index.js")).toBe(join(ROOT, "index.ts"));
    expect(resolveImport(from, "./types.js")).toBe(join(ROOT, "types.d.ts"));
    expect(resolveImport(from, "./")).toBe(join(ROOT, "index.ts"));
    expect(resolveImport(from, "openapi-fetch")).toBeUndefined();
  });
});

// A repository with a tsconfig alias, a workspace package and a dependency:
// the three ways a bare specifier can go, and only the last is a package.
const REPO = tree({
  "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["services/cart/src/application/*"] } } }`,
  "services/cart/src/application/basket/shared.ts": `export function holderOf(): string { return ""; }`,
  "services/cart/src/infrastructure/handlers.ts": `
import { holderOf } from "@app/basket/shared.ts";
import { Money } from "@acme/domain";
import createClient from "openapi-fetch";
export const lazy = () => import("./adapter.js");
export const dynamic = (x: string) => import("./" + x);
`,
  "services/cart/src/infrastructure/adapter.ts": `export const a = 1;`,
  "packages/domain/package.json": `{ "name": "@acme/domain", "types": "./index.d.ts", "main": "./dist/index.js" }`,
  "packages/domain/index.d.ts": `export interface Money { amountMinor: number }`,
  "packages/domain/dist/index.js": `export const Money = {};`,
  "node_modules/openapi-fetch/package.json": `{ "name": "openapi-fetch", "main": "index.js" }`,
  "node_modules/openapi-fetch/index.js": `module.exports = {};`,
  "broken.ts": `export class C {\n  handle( {\n}`,
});
mkdirSync(join(REPO, "node_modules/@acme"), { recursive: true });
symlinkSync(join(REPO, "packages/domain"), join(REPO, "node_modules/@acme/domain"));

describe("what an import resolves to", () => {
  const src = readSource(join(REPO, "services/cart/src/infrastructure/handlers.ts"))!;
  const file = (local: string) => src.imports.find((i) => i.local === local)?.file;

  it("follows a tsconfig paths alias to the file it names", () => {
    expect(file("holderOf")).toBe(join(REPO, "services/cart/src/application/basket/shared.ts"));
  });

  it("follows a workspace package through its symlink to the declarations it ships", () => {
    expect(file("Money")).toBe(join(REPO, "packages/domain/index.d.ts"));
    expect(readSource(file("Money")!)?.interfaces.has("Money")).toBe(true);
  });

  it("leaves a dependency as a name: nothing in node_modules is read", () => {
    expect(src.imports.find((i) => i.local === "createClient")).toMatchObject({ imported: "default", specifier: "openapi-fetch", file: undefined });
  });

  it("records a lazy import with a literal request, and not one with an expression", () => {
    expect(src.dynamicImports).toEqual([{ specifier: "./adapter.js", file: join(REPO, "services/cart/src/infrastructure/adapter.ts") }]);
  });

  it("keeps a syntax error beside the partial tree it produced", () => {
    const broken = readSource(join(REPO, "broken.ts"))!;
    expect(broken.errors.map((e) => e.at)).toEqual([`${join(REPO, "broken.ts")}:3`]);
    expect(broken.errors[0]!.message).toMatch(/Expected/);
    expect(src.errors).toEqual([]);
  });
});
