// Resolvers, read off src/schema.
//
// The third way into a service, beside HTTP and gRPC. Over HTTP the document's
// operationIds name the handlers and over gRPC the vendored contract does;
// over GraphQL the layout does, because the generator that scaffolds a
// resolver puts it at `schema/<module>/resolvers/<Root>/<field>.ts`, and that
// path is the field's name in the schema. `Query.basket` is what
// `extract-graphql` calls the method it read out of the SDL, so the two meet
// without this reader parsing a schema of its own.
//
// What a resolver holds is not a constructor's parameters - it has none - but
// the context it is handed. Its type is never written in the resolver: the
// signature comes from the generated resolver type, so the parameter is typed
// by where it sits and not by anything a reader of that file can see. The
// context is one interface for the whole service, and this reads it by the
// name codegen's own `contextType` conventionally points at - `GraphQLContext`
// - which is the same fact a use case states in its constructor, written in
// the one place GraphQL leaves for it.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readSource, at, bareType, jsdoc, type Source } from "./source.ts";
import { isArrow, isBlock, isExportNamed, isIdent, isPropertySig, isVarDecl, keyName, paramIdent, typeText, type BlockStatement, type Node } from "./ast.ts";
import type { WarningSink } from "./domain.ts";

/** The three types a client may open a request on. */
const ROOTS = ["Query", "Mutation", "Subscription"];

export interface Resolver {
  /** `Query.basket`: what extract-graphql calls the method this answers. */
  id: string;
  /** The source of the field's body, and where it is. */
  src: Source;
  body: BlockStatement;
  line: string;
  /** The parameter the ports arrive on, and what each of them is declared as. */
  self: string;
  ports: Map<string, string>;
  /** The doc comment above it, which is the flow's summary. */
  doc: string;
}

/**
 * Every resolver under a schema directory, in the order a reader meets them:
 * ask, change, keep listening, and alphabetically within each.
 *
 * A directory that is not one of the three root types is skipped rather than
 * reported: a resolver for a field of a returned type is a legitimate thing to
 * write, and it is not a way into the service.
 */
export function readResolvers(schemaDir: string, srcDir: string, rel: (abs: string) => string, b: WarningSink): Resolver[] {
  if (!existsSync(schemaDir)) return [];

  const ports = readContext(srcDir, schemaDir);
  if (ports.size === 0) {
    b.warn("", `no exported \`${CONTEXT}\` interface under ${rel(srcDir)}; the resolvers are read as reaching nothing`);
  }

  const out: Resolver[] = [];
  for (const root of ROOTS) {
    const found: Resolver[] = [];
    for (const module of readdirSync(schemaDir).sort()) {
      const dir = join(schemaDir, module, "resolvers", root);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

      for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const resolver = readResolver(join(dir, name), `${root}.${basename(name, ".ts")}`, ports, rel, b);
        if (resolver) found.push(resolver);
      }
    }
    out.push(...found);
  }

  return out;
}

function readResolver(file: string, id: string, ports: Map<string, string>, rel: (abs: string) => string, b: WarningSink): Resolver | undefined {
  const src = readSource(file);
  if (!src) return undefined;

  const fn = exportedResolver(src, basename(file, ".ts"));
  if (!fn) {
    b.warn(id, `${rel(file)}: no resolver is exported under the field's name; the field is left out of the flows`);
    return undefined;
  }

  // (parent, args, context): the third parameter is the one with the ports on
  // it. A resolver that ignores it - `_ctx` - reaches nothing, and a flow that
  // opens on it has one step, which is the truth about that field.
  const context = fn.params[2];
  const self = context ? paramIdent(context)?.name : undefined;
  const line = at(src, fn.body, rel);
  if (!context || !self || self.startsWith("_")) return { id, src, body: fn.body, line, self: "", ports: new Map(), doc: fn.doc };

  return { id, src, body: fn.body, line, self, ports, doc: fn.doc };
}

/**
 * The function the field is answered by.
 *
 * A field is a function; a subscription is an object with a `subscribe` that
 * is one, because a subscription has to be able to say how it stops as well as
 * what it yields. Both are exported under the field's own name.
 */
function exportedResolver(src: Source, name: string): { params: Node[]; body: BlockStatement; doc: string } | undefined {
  for (const stmt of src.parsed.program.body) {
    const decl = isExportNamed(stmt) ? stmt.declaration : undefined;
    if (!isVarDecl(decl)) continue;
    for (const d of decl.declarations) {
      if (!isIdent(d.id) || d.id.name !== name || !d.init) continue;
      const fn = functionOf(d.init);
      if (fn) return { ...fn, doc: jsdoc(src, decl, stmt) };
    }
  }

  return undefined;
}

function functionOf(node: Node): { params: Node[]; body: BlockStatement } | undefined {
  if (isArrow(node) && isBlock(node.body)) return { params: node.params, body: node.body };
  // `{ subscribe: async function* (...) { ... } }`
  const properties = (node as { properties?: Node[] }).properties ?? [];
  for (const property of properties) {
    const key = (property as { key?: Node }).key;
    const value = (property as { value?: Node }).value;
    if (!key || keyName(key) !== "subscribe" || !value) continue;
    const body = (value as { body?: Node }).body;
    const params = (value as { params?: Node[] }).params ?? [];
    if (isArrow(value) && isBlock(body)) return { params, body };
    if (isBlock(body)) return { params, body };
  }

  return undefined;
}

/** The name the one context interface goes by; codegen's `contextType` points at it. */
const CONTEXT = "GraphQLContext";

/**
 * The ports a resolver may reach: the members of the context interface.
 *
 * A property is a port - `baskets: Baskets` - and its type is what assembly
 * binds. Anything else on the context is what the transport put there for the
 * resolvers to read, `bearer` and its like, and a call on one of those is not
 * a hop because nothing is at the other end of it.
 */
function readContext(srcDir: string, schemaDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const file = findContext(srcDir, schemaDir);
  if (!file) return out;

  const src = readSource(file);
  const iface = src?.interfaces.get(CONTEXT);
  if (!src || !iface) return out;

  for (const member of iface.body.body) {
    if (!isPropertySig(member)) continue;
    const name = keyName(member.key);
    if (name) out.set(name, bareType(typeText(src.parsed, member.typeAnnotation)));
  }

  return out;
}

function findContext(dir: string, schemaDir: string): string | undefined {
  if (!existsSync(dir) || dir === schemaDir) return undefined;

  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const found = findContext(path, schemaDir);
      if (found) return found;
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    if (readSource(path)?.interfaces.has(CONTEXT)) return path;
  }

  return undefined;
}
