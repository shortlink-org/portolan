// Reading TypeScript files: the few shapes the extractor looks at, pulled out
// of the syntax tree once so the modules above it work on names and strings.
//
// No type checker: everything here is resolved by name and by relative
// import, which is all a layout that is the claim needs. The tree itself is
// oxc-parser's, through `ast.ts`.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parse,
  jsdoc as docOf,
  firstTokenOf,
  isArray,
  isBoolean,
  isClassDecl,
  isExportNamed,
  isFunctionDecl,
  isIdent,
  isImport,
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
  text as textOf,
  typeText,
} from "./ast.ts";
import type { BlockStatement, ClassDeclaration, FunctionNode, InterfaceDeclaration, MethodDefinition, Node, Parsed } from "./ast.ts";

export interface Field {
  name: string;
  type: string;
  doc: string;
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

export interface ClassInfo {
  name: string;
  node: ClassDeclaration;
  doc: string;
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
  /** The file a relative specifier resolves to, or undefined for a package. */
  file: string | undefined;
  typeOnly: boolean;
}

export interface Source {
  path: string;
  parsed: Parsed;
  classes: ClassInfo[];
  imports: Import[];
  /** Exported interfaces, by name. */
  interfaces: Map<string, InterfaceDeclaration>;
  /** Exported functions, by name. */
  functions: Map<string, FunctionNode>;
}

const cache = new Map<string, Source | null>();

export function readSource(path: string): Source | null {
  const key = resolve(path);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!existsSync(key)) {
    cache.set(key, null);
    return null;
  }
  const parsed = parse(key, readFileSync(key, "utf8"));
  const source: Source = { path: key, parsed, classes: [], imports: [], interfaces: new Map(), functions: new Map() };
  for (const stmt of parsed.program.body) {
    const exported = isExportNamed(stmt);
    const decl = exported ? stmt.declaration : stmt;
    if (!decl) continue;
    if (isImport(decl)) source.imports.push(...importsOf(decl, key));
    else if (isClassDecl(decl) && decl.id) source.classes.push(classInfo(parsed, decl, exported ? stmt : undefined));
    else if (isInterface(decl)) source.interfaces.set(decl.id.name, decl);
    else if (isFunctionDecl(decl) && decl.id) source.functions.set(decl.id.name, decl);
  }
  cache.set(key, source);
  return source;
}

/** Resolves a relative specifier the way Node does for a `.ts` tree. */
export function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function importsOf(decl: import("./ast.ts").ImportDeclaration, from: string): Import[] {
  const specifier = String(decl.source.value);
  const file = resolveImport(from, specifier);
  const typeOnly = decl.importKind === "type";
  const out: Import[] = [];
  for (const s of decl.specifiers) {
    if (s.type === "ImportDefaultSpecifier") out.push({ local: s.local.name, imported: "default", specifier, file, typeOnly });
    else if (s.type === "ImportNamespaceSpecifier") out.push({ local: s.local.name, imported: "*", specifier, file, typeOnly });
    else out.push({ local: s.local.name, imported: (s.imported && keyName(s.imported)) ?? s.local.name, specifier, file, typeOnly: typeOnly || s.importKind === "type" });
  }
  return out;
}

/** The doc comment above a node, allowing for a decorator or an `export` in front of it. */
export function jsdoc(src: Source, node: Node, exportNode?: Node): string {
  return docOf(src.parsed, node, firstTokenOf(node, exportNode));
}

function classInfo(p: Parsed, node: ClassDeclaration, exportNode: Node | undefined): ClassInfo {
  const info: ClassInfo = {
    name: node.id!.name,
    node,
    doc: docOf(p, node, firstTokenOf(node, exportNode)),
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
      info.fields.push({ name, type: typeText(p, member.typeAnnotation) || inferred(p, init), doc: docOf(p, member, firstTokenOf(member)) });
    } else if (isMethod(member) && member.kind === "constructor") {
      for (const param of member.value.params) {
        const id = paramIdent(param);
        if (!id) continue;
        const type = typeText(p, id.typeAnnotation);
        info.params.push({ name: id.name, type });
        if (isParamProperty(param)) info.fields.push({ name: id.name, type, doc: docOf(p, param, firstTokenOf(param)) });
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
        returns: typeText(p, member.value.returnType),
        isStatic: member.static,
      });
    }
  }
  return info;
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
