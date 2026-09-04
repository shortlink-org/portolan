// Reading TypeScript files: the few shapes the extractor looks at, pulled out
// of the syntax tree once so the modules above it work on names and strings.
//
// The parser is TypeScript 5's, installed as `ts-api` beside the project's
// TypeScript 7, which is a native compiler with no syntax tree to offer. No
// type checker: everything here is resolved by name and by relative import,
// which is all a layout that is the claim needs.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type * as TS from "ts-api";

const require = createRequire(import.meta.url);
export const ts: typeof TS = require("ts-api");

export interface Field {
  name: string;
  type: string;
  doc: string;
}

export interface Method {
  name: string;
  node: TS.MethodDeclaration;
  /** The return type as written, or "" when it is not. */
  returns: string;
  isStatic: boolean;
}

export interface ClassInfo {
  name: string;
  node: TS.ClassDeclaration;
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
  sf: TS.SourceFile;
  classes: ClassInfo[];
  imports: Import[];
  /** Exported interfaces, by name. */
  interfaces: Map<string, TS.InterfaceDeclaration>;
  /** Exported functions, by name. */
  functions: Map<string, TS.FunctionDeclaration>;
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
  const text = readFileSync(key, "utf8");
  const sf = ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source: Source = { path: key, sf, classes: [], imports: [], interfaces: new Map(), functions: new Map() };
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) source.imports.push(...importsOf(stmt, key));
    else if (ts.isClassDeclaration(stmt) && stmt.name) source.classes.push(classInfo(stmt, sf));
    else if (ts.isInterfaceDeclaration(stmt)) source.interfaces.set(stmt.name.text, stmt);
    else if (ts.isFunctionDeclaration(stmt) && stmt.name) source.functions.set(stmt.name.text, stmt);
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

function importsOf(decl: TS.ImportDeclaration, from: string): Import[] {
  const specifier = (decl.moduleSpecifier as TS.StringLiteral).text;
  const file = resolveImport(from, specifier);
  const out: Import[] = [];
  const clause = decl.importClause;
  if (!clause) return out;
  const typeOnly = clause.isTypeOnly;
  if (clause.name) out.push({ local: clause.name.text, imported: "default", specifier, file, typeOnly });
  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) {
      out.push({ local: bindings.name.text, imported: "*", specifier, file, typeOnly });
    } else {
      for (const el of bindings.elements) {
        out.push({
          local: el.name.text,
          imported: el.propertyName?.text ?? el.name.text,
          specifier,
          file,
          typeOnly: typeOnly || el.isTypeOnly,
        });
      }
    }
  }
  return out;
}

export function jsdoc(node: TS.Node): string {
  const docs = (node as { jsDoc?: TS.JSDoc[] }).jsDoc;
  if (!docs || docs.length === 0) return "";
  const last = docs[docs.length - 1]!;
  const comment = last.comment;
  if (!comment) return "";
  return (typeof comment === "string" ? comment : comment.map((c) => c.text).join("")).trim();
}

function typeText(node: TS.TypeNode | undefined): string {
  return node ? node.getText() : "";
}

function classInfo(node: TS.ClassDeclaration, sf: TS.SourceFile): ClassInfo {
  const info: ClassInfo = {
    name: node.name!.text,
    node,
    doc: jsdoc(node),
    exported: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false,
    fields: [],
    params: [],
    methods: new Map(),
    nameLiteral: undefined,
  };
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
      const name = member.name.text;
      const init = member.initializer;
      if (name === "name" && init && ts.isStringLiteral(init)) {
        info.nameLiteral = init.text;
        continue;
      }
      if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
      info.fields.push({ name, type: typeText(member.type) || inferred(init), doc: jsdoc(member) });
    } else if (ts.isConstructorDeclaration(member)) {
      for (const p of member.parameters) {
        if (!ts.isIdentifier(p.name)) continue;
        const type = typeText(p.type);
        info.params.push({ name: p.name.text, type });
        const isProperty = p.modifiers?.some((m) =>
          [ts.SyntaxKind.ReadonlyKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind),
        );
        if (isProperty) info.fields.push({ name: p.name.text, type, doc: jsdoc(p) });
      }
    } else if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
      info.methods.set(member.name.text, {
        name: member.name.text,
        node: member,
        returns: typeText(member.type),
        isStatic: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      });
    }
  }
  void sf;
  return info;
}

function inferred(init: TS.Expression | undefined): string {
  if (!init) return "";
  if (ts.isStringLiteral(init)) return "string";
  if (ts.isNumericLiteral(init)) return "number";
  if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
  if (ts.isArrayLiteralExpression(init)) return "[]";
  if (ts.isNewExpression(init)) return init.expression.getText();
  return "";
}

/** `file:line` for a node, relative to the repository the way the catalog spells it. */
export function at(sf: TS.SourceFile, node: TS.Node, rel: (abs: string) => string): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${rel(sf.fileName)}:${line + 1}`;
}

/** The type behind `Promise<X>`, `X | undefined`, `readonly X[]` and friends, as a bare name. */
export function bareType(type: string): string {
  let t = type.trim();
  const promise = /^Promise<(.*)>$/s.exec(t);
  if (promise) t = promise[1]!.trim();
  t = t.replace(/\s*\|\s*(undefined|null)\b/g, "").replace(/^(readonly\s+)/, "");
  return t;
}
