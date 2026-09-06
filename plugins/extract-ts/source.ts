// Reading TypeScript files: the few shapes the extractor looks at, pulled out
// of the syntax tree once so the modules above it work on names and strings.
//
// No type checker: everything here is resolved by name and by import - the
// resolver is oxc's, so a tsconfig `paths` alias and a workspace package
// resolve as Node and TypeScript would - which is all a layout that is the
// claim needs. The tree itself is
// oxc-parser's, through `ast.ts`.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import {
  parse,
  docBlock,
  docParams,
  docReturns,
  docType,
  docTypedefs,
  interfaceFromDoc,
  isAssign,
  isExprStmt,
  isIdent,
  isSourceFile,
  jsdoc as docOf,
  firstTokenOf,
  isArray,
  isBoolean,
  isClassDecl,
  isExportNamed,
  isFunctionDecl,
  isInterface,
  isMethod,
  isNew,
  isNumber,
  isParamProperty,
  isPropertyDef,
  isString,
  keyName,
  lineOf,
  paramIdent,
  parseDoc,
  text as textOf,
  thisMember,
  typeFromDoc,
  typeText,
  SOURCE_EXTENSIONS,
} from "./ast.ts";
import type { BlockStatement, ClassDeclaration, DocBlock, FunctionNode, InterfaceDeclaration, MethodDefinition, Node, Parsed, Typed } from "./ast.ts";

/** What a doc comment says about the thing it sits on, beyond its prose. */
export interface Documented {
  doc: string;
  /** The `@deprecated` reason, "" for a bare tag, absent when not deprecated. */
  deprecated?: string;
  /** The `@example` bodies, when the comment had any. */
  examples?: string[];
}

export interface Field extends Documented {
  name: string;
  type: string;
}

export interface Method {
  name: string;
  node: MethodDefinition;
  /** The parameters, in order. */
  params: Node[];
  /** The body, or null for an overload signature. */
  body: BlockStatement | null;
  /** The return type as written, or "" when it is not. */
  returns: string;
  isStatic: boolean;
}

export interface ClassInfo extends Documented {
  name: string;
  node: ClassDeclaration;
  exported: boolean;
  fields: Field[];
  /** Constructor parameters, in order: what a use case holds as ports. */
  params: { name: string; type: string }[];
  methods: Map<string, Method>;
  /** `readonly name = "x"` or `static readonly name = "x"`, when present. */
  nameLiteral: string | undefined;
}

export interface Import {
  /** The local name, or the imported one for a namespace import. */
  local: string;
  /** What it is called in the module it came from; "*" for a namespace. */
  imported: string;
  specifier: string;
  /** The file the specifier resolves to - relative, aliased or a workspace package - or undefined for a dependency. */
  file: string | undefined;
  typeOnly: boolean;
}

/**
 * An interface with the text its nodes point into: the file's own for one
 * written in the syntax, its own for one declared by a `@typedef`, which is
 * parsed apart from the file it sits in.
 */
export interface Iface {
  p: Parsed;
  node: InterfaceDeclaration;
}

export interface Source {
  path: string;
  parsed: Parsed;
  classes: ClassInfo[];
  imports: Import[];
  /** Exported interfaces, by name - `interface X` in TypeScript, `@typedef {{…}} X` in JavaScript. */
  interfaces: Map<string, Iface>;
  /** Exported functions, by name. */
  functions: Map<string, FunctionNode>;
  /** `import("./x.js")` with a literal request: what the file loads lazily, resolved the same way. */
  dynamicImports: { specifier: string; file: string | undefined }[];
  /** Syntax errors, `file:line` and message. The tree past the first is partial, and so is what was read from it. */
  errors: { at: string; message: string }[];
}

const cache = new Map<string, Source | null>();

/** Every source read so far that sits under a root, for reporting what was wrong with them once the reading is done. */
export function sourcesUnder(root: string): Source[] {
  if (!existsSync(root)) return [];
  const prefix = realpathSync(root) + "/";
  return [...cache.values()].filter((s): s is Source => s !== null && s.path.startsWith(prefix));
}

/**
 * A file, read once. Keyed by its real path, because the resolver hands back
 * real paths - a workspace package is followed through its symlink - and a
 * file reached by two names is still one file.
 */
export function readSource(path: string): Source | null {
  const asked = resolve(path);
  if (!existsSync(asked)) return null;
  const key = realpathSync(asked);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const parsed = parse(key, readFileSync(key, "utf8"));
  const source: Source = {
    path: key,
    parsed,
    classes: [],
    imports: importsOf(parsed, key),
    interfaces: new Map(),
    functions: new Map(),
    dynamicImports: dynamicImportsOf(parsed, key),
    errors: parsed.errors.map((e) => ({ at: `${key}:${lineOf(parsed, e.labels?.[0]?.start ?? 0)}`, message: e.message })),
  };
  for (const stmt of parsed.program.body) {
    const exported = isExportNamed(stmt);
    const decl = exported ? stmt.declaration : stmt;
    if (!decl) continue;
    if (isInterface(decl)) source.interfaces.set(decl.id.name, { p: parsed, node: decl });
    else if (isFunctionDecl(decl) && decl.id) source.functions.set(decl.id.name, decl);
  }
  // Typedefs before classes: a class's `@param {Port}` may name a typedef,
  // and the typedef's `import(...)` is what says where the port came from.
  if (parsed.js) readTypedefs(source);
  for (const stmt of parsed.program.body) {
    const exported = isExportNamed(stmt);
    const decl = exported ? stmt.declaration : stmt;
    if (decl && isClassDecl(decl) && decl.id) source.classes.push(classInfo(source, decl, exported ? stmt : undefined));
  }
  cache.set(key, source);
  return source;
}

/**
 * Every `@typedef` in a JavaScript file, wherever its comment sits - a typedef
 * is attached to nothing, so the comments are read rather than the tree.
 * `@typedef {import("./port.js").Port} Port` is an import of a type and is
 * filed as one. `@typedef {{ save(): Promise<void> }} Port`, and
 * `@typedef {Object} Port` with `@property` lines under it, is an interface,
 * and becomes the node `interface Port {…}` would have been. Any other
 * typedef - a union, an alias of a primitive - names nothing the extractor
 * follows, and is left alone.
 */
function readTypedefs(src: Source): void {
  for (const c of src.parsed.comments) {
    if (c.type !== "Block" || !c.value.startsWith("*")) continue;
    for (const def of docTypedefs(parseDoc(c.value.slice(1)))) {
      const imported = /^import\(\s*["']([^"']+)["']\s*\)\.([\w$]+)$/.exec(def.type);
      if (imported) {
        addImport(src, { local: def.name, imported: imported[2]!, specifier: imported[1]!, file: resolveImport(src.path, imported[1]!), typeOnly: true });
        continue;
      }
      let body: string | undefined;
      if (/^\{[\s\S]*\}$/.test(def.type)) body = docTypeIn(src, def.type.slice(1, -1));
      else if (/^object$/i.test(def.type)) body = def.properties.map((p) => `${p.name}: ${docTypeIn(src, p.type)};`).join(" ");
      if (body === undefined) continue;
      const iface = interfaceFromDoc(def.name, body);
      if (iface) src.interfaces.set(def.name, iface);
    }
  }
}

/** An import a doc comment implies, added once: the first mention of a local name wins, as it would in the syntax. */
function addImport(src: Source, imp: Import): void {
  if (!src.imports.some((i) => i.local === imp.local)) src.imports.push(imp);
}

/**
 * A type expression from a doc comment, with each `import("./x.js").Y` in it
 * read as the import it is and shortened to `Y`, so that what is left is a
 * name the rest of the reader resolves the way it resolves any other: through
 * `src.imports`. Returns the expression as the syntax would have written it.
 */
export function docTypeIn(src: Source, expr: string): string {
  return expr.replace(/\btypeof\s+import\(\s*["']([^"']+)["']\s*\)\.([\w$]+)|\bimport\(\s*["']([^"']+)["']\s*\)\.([\w$]+)/g, (_m, s1: string | undefined, n1: string | undefined, s2: string | undefined, n2: string | undefined) => {
    const specifier = (s1 ?? s2)!;
    const name = (n1 ?? n2)!;
    addImport(src, { local: name, imported: name, specifier, file: resolveImport(src.path, specifier), typeOnly: true });
    return s1 ? `typeof ${name}` : name;
  });
}

/** A doc-comment type as the annotation it stands in for, or undefined when there is none or it does not parse. */
function docTyped(src: Source, expr: string): Typed | undefined {
  return expr ? typeFromDoc(docTypeIn(src, expr)) : undefined;
}

/** The files the extractor reads in a directory, sorted: TypeScript and JavaScript alike, tests and declarations left out. */
export function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isSourceFile)
    .sort()
    .map((f) => join(dir, f));
}

/** `<dir>/<base>.ts`, or the `.js`/`.mjs` beside where it would have been: the fixed names of the layout, in whichever language the tree is written. */
export function sourceNamed(dir: string, base: string): string {
  for (const ext of SOURCE_EXTENSIONS) {
    const path = join(dir, base + ext);
    if (existsSync(path)) return path;
  }
  return join(dir, `${base}.ts`);
}

/**
 * Node's resolution, with what a TypeScript tree adds to it: `./x.js` means
 * `./x.ts`, a bare `./x` tries every source extension and then an index,
 * `@app/domain/basket` is whatever the nearest tsconfig's `paths` say, and a
 * workspace package is followed through its symlink to the source it is. The
 * `types` condition comes first so a package that ships declarations resolves
 * to the shape a port reader can walk rather than to compiled output.
 */
const resolver = new ResolverFactory({
  tsconfig: "auto",
  extensions: [...SOURCE_EXTENSIONS, ".d.ts", ".mts", ".cts"],
  extensionAlias: { ".js": [".ts", ".tsx", ".d.ts", ".js"], ".mjs": [".mts", ".mjs"], ".cjs": [".cts", ".cjs"], ".jsx": [".tsx", ".jsx"] },
  conditionNames: ["types", "import", "default"],
  mainFields: ["types", "module", "main"],
});

/**
 * The file a specifier names, or undefined for a package.
 *
 * A package is a specifier that lands in `node_modules`: what is there is a
 * dependency, and the extractor does not read dependencies - a client library
 * is recognised by the name it is imported under, not by its source. A
 * workspace package is the exception, and needs none: its symlink resolves
 * to a directory of the repository, outside any `node_modules`, and is read
 * like the rest of the tree.
 */
export function resolveImport(from: string, specifier: string): string | undefined {
  const found = resolver.resolveFileSync(from, specifier);
  if (!found.path || /[\\/]node_modules[\\/]/.test(found.path)) return undefined;
  return found.path;
}

/**
 * The static imports as the parser records them: every declaration, every
 * entry, with the name it is imported under, the name it had, and whether
 * it is type-only - `import type { A }` and `import { type A }` alike.
 * Nothing here walks the tree; the record is a by-product of parsing.
 */
function importsOf(parsed: Parsed, from: string): Import[] {
  const out: Import[] = [];
  for (const decl of parsed.module.staticImports) {
    const specifier = decl.moduleRequest.value;
    const file = resolveImport(from, specifier);
    for (const entry of decl.entries) {
      const imported = entry.importName.kind === "Default" ? "default" : entry.importName.kind === "NamespaceObject" ? "*" : (entry.importName.name ?? entry.localName.value);
      out.push({ local: entry.localName.value, imported, specifier, file, typeOnly: entry.isType });
    }
  }
  return out;
}

/** `import("./x.js")` with a literal request, resolved; one with an expression names nothing that can be followed. */
function dynamicImportsOf(parsed: Parsed, from: string): { specifier: string; file: string | undefined }[] {
  const out: { specifier: string; file: string | undefined }[] = [];
  for (const d of parsed.module.dynamicImports) {
    const request = parsed.text.slice(d.moduleRequest.start, d.moduleRequest.end);
    const m = /^(["'])(.*)\1$/s.exec(request);
    if (!m) continue;
    out.push({ specifier: m[2]!, file: resolveImport(from, m[2]!) });
  }
  return out;
}

/** The doc comment above a node, allowing for a decorator or an `export` in front of it. */
export function jsdoc(src: Source, node: Node, exportNode?: Node): string {
  return docOf(src.parsed, node, firstTokenOf(node, exportNode));
}

/** A parsed doc block as the optional fields a `Documented` carries: nothing is written down when the tag is absent. */
function withTags(block: DocBlock): Documented {
  const out: Documented = { doc: block.text };
  if (block.deprecated !== undefined) out.deprecated = block.deprecated;
  if (block.examples.length) out.examples = block.examples;
  return out;
}

/**
 * The prose with the deprecation written into it, for a catalog field that
 * holds only a sentence: "Deprecated: use `total` instead." is what a reader
 * wants next to a struck-through name, and the boolean beside it is what the
 * page strikes it through by.
 */
export function docWithDeprecation(d: Documented): string {
  if (d.deprecated === undefined) return d.doc;
  const note = d.deprecated ? `Deprecated: ${d.deprecated.replace(/[.\s]+$/, "")}.` : "Deprecated.";
  return d.doc ? `${d.doc}\n\n${note}` : note;
}

/**
 * A class as the reader sees it. In TypeScript the types are in the syntax;
 * in JavaScript they are in the doc comments - `@type` on a field, `@param`
 * on the constructor, `@returns` on a method - and a field is what the
 * constructor assigns to `this`, since there is no parameter property to
 * declare it with. Each reading falls back to the next, so a TypeScript file
 * with a JSDoc type on an unannotated field reads that too.
 */
function classInfo(src: Source, node: ClassDeclaration, exportNode: Node | undefined): ClassInfo {
  const p = src.parsed;
  const info: ClassInfo = {
    name: node.id!.name,
    node,
    ...withTags(docBlock(p, node, firstTokenOf(node, exportNode))),
    exported: exportNode !== undefined,
    fields: [],
    params: [],
    methods: new Map(),
    nameLiteral: undefined,
  };
  for (const member of node.body.body) {
    if (isPropertyDef(member) && !member.computed) {
      const name = keyName(member.key);
      if (name === undefined) continue;
      const init = member.value;
      if (name === "name" && isString(init)) {
        info.nameLiteral = init.value;
        continue;
      }
      if (member.static) continue;
      const block = docBlock(p, member, firstTokenOf(member));
      info.fields.push({ name, type: typeText(p, member.typeAnnotation) || docTypeIn(src, docType(block)) || inferred(p, init), ...withTags(block) });
    } else if (isMethod(member) && member.kind === "constructor") {
      const documented = docParams(docBlock(p, member, firstTokenOf(member)));
      const params = new Map<string, string>();
      for (const param of member.value.params) {
        const id = paramIdent(param);
        if (!id) continue;
        const type = typeText(p, id.typeAnnotation) || docTypeIn(src, documented.get(id.name) ?? "");
        info.params.push({ name: id.name, type });
        params.set(id.name, type);
        if (isParamProperty(param)) info.fields.push({ name: id.name, type, ...withTags(docBlock(p, param, firstTokenOf(param))) });
      }
      if (p.js && member.value.body) {
        // `this.id = id`: the field is declared by being assigned, typed by
        // the parameter it takes or by what it is given.
        for (const stmt of member.value.body.body) {
          if (!isExprStmt(stmt) || !isAssign(stmt.expression) || stmt.expression.operator !== "=") continue;
          const name = thisMember(stmt.expression.left);
          if (name === undefined || name === "name" || info.fields.some((f) => f.name === name)) continue;
          const value = stmt.expression.right;
          const block = docBlock(p, stmt);
          const fromParam = isIdent(value) ? params.get(value.name) : undefined;
          info.fields.push({ name, type: docTypeIn(src, docType(block)) || fromParam || inferred(p, value), ...withTags(block) });
        }
      }
    } else if (isMethod(member) && !member.computed && member.kind === "method") {
      const name = keyName(member.key);
      // An overload signature has no body; the implementation that follows is
      // the one read, so the last declaration of a name wins.
      if (name === undefined) continue;
      info.methods.set(name, {
        name,
        node: member,
        params: member.value.params,
        body: member.value.body,
        returns: typeText(p, member.value.returnType) || docTypeIn(src, docReturns(docBlock(p, member, firstTokenOf(member)))),
        isStatic: member.static,
      });
    }
  }
  return info;
}

/** The doc block above an exported function, found through its export statement when it has one. */
function functionDoc(src: Source, fn: FunctionNode): DocBlock {
  for (const stmt of src.parsed.program.body) {
    if (stmt === fn) return docBlock(src.parsed, fn);
    if (isExportNamed(stmt) && stmt.declaration === fn) return docBlock(src.parsed, fn, firstTokenOf(fn, stmt));
  }
  return docBlock(src.parsed, fn);
}

/** What a function returns: the annotation, or the `@returns {T}` above it, with the text the node points into. */
export function returnTypeOf(src: Source, fn: FunctionNode): Typed | undefined {
  if (fn.returnType) return { p: src.parsed, ann: fn.returnType };
  return docTyped(src, docReturns(functionDoc(src, fn)));
}

/** The type of one of a function's parameters: the annotation, or the `@param {T} name` above the function. */
export function paramTypeOf(src: Source, fn: FunctionNode, param: Node): Typed | undefined {
  const id = paramIdent(param);
  if (!id) return undefined;
  if (id.typeAnnotation) return { p: src.parsed, ann: id.typeAnnotation };
  return docTyped(src, docParams(functionDoc(src, fn)).get(id.name) ?? "");
}

/** The return type of a function as written, or "". */
export function returnTypeText(src: Source, fn: FunctionNode): string {
  const t = returnTypeOf(src, fn);
  return t ? typeText(t.p, t.ann) : "";
}

function inferred(p: Parsed, init: Node | null): string {
  if (!init) return "";
  if (isString(init)) return "string";
  if (isNumber(init)) return "number";
  if (isBoolean(init)) return "boolean";
  if (isArray(init)) return "[]";
  if (isNew(init)) return textOf(p, init.callee);
  return "";
}

/** The source of a node, as written. */
export function text(src: Source, node: Node): string {
  return textOf(src.parsed, node);
}

/** `file:line` for a node, relative to the repository the way the catalog spells it. */
export function at(src: Source, node: Node, rel: (abs: string) => string): string {
  return `${rel(src.path)}:${lineOf(src.parsed, node.start)}`;
}

/** The type behind `Promise<X>`, `X | undefined`, `readonly X[]` and friends, as a bare name. */
export function bareType(type: string): string {
  let t = type.trim();
  const promise = /^Promise<(.*)>$/s.exec(t);
  if (promise) t = promise[1]!.trim();
  t = t.replace(/\s*\|\s*(undefined|null)\b/g, "").replace(/^(readonly\s+)/, "");
  return t;
}
