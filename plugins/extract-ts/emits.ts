// What a use case can publish, read off the domain calls it makes.
//
//   checkout(total: Money, quoteId: string): BasketCheckedOut { … }
//
//   async handle(input: Input) {
//     const checkedOut = basket.checkout(quote.total, quote.quoteId);
//     await this.repo.save(basket, checkedOut);
//   }
//
// The domain says which of its functions produce which events: a root method
// or a module-level function produces the events its return type names and
// the events it constructs with `new`, and whatever the domain functions and
// root methods it calls produce. The use case says which of those it calls.
// The event is the domain's to name, and the use case only decides whether to
// run the method that names it - so the operation emits what it reaches,
// whether or not a branch keeps the result. This is extract-go's rule, read
// in TypeScript's words.
//
// Calls are matched by name: a root method by its name on any receiver but
// the use case's own `this`, which holds ports and helpers, never the
// aggregate; a domain function through the import that names the file it is
// declared in. A port method that shares a name with an emitting root method
// and is called on a local is read as that method; the names in a domain are
// chosen to say what the aggregate does, and the collision is rare enough to
// take.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { Event } from "../../src/catalog.ts";
import { isArrow, isCall, isClassDecl, isExportNamed, isFunctionDecl, isIdent, isMember, isMethod, isNew, isThis, isVarDecl, keyName, typeText, unwrap, walk, type ClassDeclaration, type FunctionNode, type MemberExpression, type Node } from "./ast.ts";
import { readSource, returnTypeText, sourceFiles, type Source } from "./source.ts";

export interface Emitters {
  /** Public root method → event ids, in the aggregate's order. */
  methods: Map<string, string[]>;
  /** `<file>#<function>` → event ids, for a function the domain declares at module level. */
  funcs: Map<string, string[]>;
  /** Event class name → event id. */
  events: Map<string, string>;
  /** Event id → position in the aggregate. */
  order: Map<string, number>;
  /** The aggregate's directory, with a trailing separator: what a domain import resolves under. */
  dir: string;
}

interface Emitter {
  own: Set<string>;
  calls: string[];
}

/** The emitting functions of one aggregate's domain directory: the root's methods and every module-level function under it. */
export function domainEmitters(dir: string, root: string, events: Event[]): Emitters {
  const e: Emitters = { methods: new Map(), funcs: new Map(), events: new Map(), order: new Map(), dir: dir.endsWith(sep) ? dir : dir + sep };
  events.forEach((ev, i) => {
    e.events.set(ev.name, ev.id);
    e.order.set(ev.id, i);
  });
  if (events.length === 0) return e;

  // Each function's own events and the calls it makes, then the calls folded
  // in until nothing changes: a method that builds its event through a
  // helper emits what the helper builds.
  const nodes = new Map<string, Emitter>();
  const hidden = new Set<string>();
  for (const file of filesUnder(dir)) {
    const src = readSource(file);
    if (!src) continue;
    for (const stmt of src.parsed.program.body) {
      const decl = isExportNamed(stmt) ? stmt.declaration : stmt;
      if (!decl) continue;
      if (isClassDecl(decl) && decl.id?.name === root) {
        readRoot(e, src, decl, nodes, hidden);
      } else if (isFunctionDecl(decl) && decl.id && decl.body) {
        nodes.set(funcKey(src.path, decl.id.name), emitter(e, src, decl.body, returnTypeText(src, decl)));
      } else if (isVarDecl(decl)) {
        // `export const price = (…): PriceSet => …`: a function by another spelling.
        for (const d of decl.declarations) {
          const init = d.init ? unwrap(d.init) : undefined;
          if (!isIdent(d.id) || !init || !(isArrow(init) || init.type === "FunctionExpression")) continue;
          const fn = init as unknown as FunctionNode;
          if (fn.body) nodes.set(funcKey(src.path, d.id.name), emitter(e, src, fn.body, typeText(src.parsed, fn.returnType)));
        }
      }
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of nodes.values()) {
      for (const callee of n.calls) {
        for (const id of nodes.get(callee)?.own ?? []) {
          if (n.own.has(id)) continue;
          n.own.add(id);
          changed = true;
        }
      }
    }
  }
  for (const [key, n] of nodes) {
    if (n.own.size === 0) continue;
    if (key.startsWith("m:")) {
      if (!hidden.has(key)) e.methods.set(key.slice(2), sorted(e, n.own));
    } else e.funcs.set(key.slice(2), sorted(e, n.own));
  }
  return e;
}

/** The root's methods, static and instance alike; a private one is followed but never matched from outside. */
function readRoot(e: Emitters, src: Source, cls: ClassDeclaration, nodes: Map<string, Emitter>, hidden: Set<string>): void {
  // The return types as the class reader took them, which in JavaScript are
  // the `@returns` above the method rather than an annotation.
  const info = src.classes.find((c) => c.node === cls);
  for (const member of cls.body.body) {
    if (!isMethod(member) || member.computed || member.kind !== "method" || !member.value.body) continue;
    const name = methodName(member.key);
    if (name === undefined) continue;
    const key = `m:${name}`;
    const accessibility = (member as unknown as { accessibility?: string | null }).accessibility;
    if (name.startsWith("#") || accessibility === "private" || accessibility === "protected") hidden.add(key);
    nodes.set(key, emitter(e, src, member.value.body, info?.methods.get(name)?.returns ?? returnTypeText(src, member.value)));
  }
}

/** One function's own events and the domain calls it makes, read off its body. */
function emitter(e: Emitters, src: Source, body: Node, returns: string): Emitter {
  const n: Emitter = { own: new Set(typeEvents(e, returns)), calls: [] };
  walk(body, (node) => {
    const ev = constructed(e, node);
    if (ev) n.own.add(ev);
    if (!isCall(node)) return;
    const callee = node.callee;
    if (isIdent(callee)) {
      const key = functionKey(e, src, callee.name);
      if (key) n.calls.push(key);
    } else if (isMember(callee)) {
      const name = memberCallName(callee);
      if (name === undefined) return;
      // ns.helper(…) through a namespace import of a domain file, else a
      // method: this.moveTo(…), Basket.create(…), into.addItem(…).
      n.calls.push(namespaceKey(e, src, callee) ?? `m:${name}`);
    }
  });
  return n;
}

/**
 * What one use case reaches: root methods by name, domain functions through
 * the imports that name the files they are declared in, and events the use
 * case constructs itself. Empty when it reaches nothing.
 */
export function useCaseEmits(e: Emitters, dir: string): string[] {
  if (e.events.size === 0) return [];
  const found = new Set<string>();
  for (const file of sourceFiles(dir)) {
    const src = readSource(file);
    if (!src) continue;
    walk(src.parsed.program, (node) => {
      const ev = constructed(e, node);
      if (ev) found.add(ev);
      if (!isCall(node)) return;
      const callee = node.callee;
      let ids: string[] | undefined;
      if (isIdent(callee)) {
        const key = functionKey(e, src, callee.name);
        ids = key ? e.funcs.get(key.slice(2)) : undefined;
      } else if (isMember(callee)) {
        const name = memberCallName(callee);
        if (name === undefined || heldByThis(callee.object)) return;
        const key = namespaceKey(e, src, callee);
        ids = key ? e.funcs.get(key.slice(2)) : e.methods.get(name);
      }
      for (const id of ids ?? []) found.add(id);
    });
  }
  return sorted(e, found);
}

/** `new BasketCheckedOut(…)` → its event id. */
function constructed(e: Emitters, node: Node): string | undefined {
  return isNew(node) && isIdent(node.callee) ? e.events.get(node.callee.name) : undefined;
}

/** The events a return type names, wherever in it they sit: `Promise<[Basket, BasketCreated]>` names one. */
function typeEvents(e: Emitters, type: string): string[] {
  const out: string[] = [];
  for (const name of type.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const id = e.events.get(name);
    if (id) out.push(id);
  }
  return out;
}

/** A bare call's function: declared in the same file, or imported from a file of the domain. */
function functionKey(e: Emitters, src: Source, name: string): string | undefined {
  const imp = src.imports.find((i) => i.local === name);
  if (imp) return imp.file?.startsWith(e.dir) && imp.imported !== "*" ? funcKey(imp.file, imp.imported) : undefined;
  return src.path.startsWith(e.dir) ? funcKey(src.path, name) : undefined;
}

/** `rules.whyNot(…)`, where `rules` is `import * as rules` of a domain file. */
function namespaceKey(e: Emitters, src: Source, callee: MemberExpression): string | undefined {
  if (!isIdent(callee.object)) return undefined;
  const local = callee.object.name;
  const imp = src.imports.find((i) => i.local === local && i.imported === "*");
  const name = memberCallName(callee);
  return imp?.file?.startsWith(e.dir) && name !== undefined ? funcKey(imp.file, name) : undefined;
}

function funcKey(file: string, name: string): string {
  return `f:${file}#${name}`;
}

/** `this.repo` and `this` itself: what a use case holds is ports and helpers, never the aggregate. */
function heldByThis(n: Node): boolean {
  const o = unwrap(n);
  return isThis(o) || (isMember(o) && heldByThis(o.object));
}

function memberCallName(callee: MemberExpression): string | undefined {
  return callee.computed ? undefined : methodName(callee.property);
}

/** A method's name, `#name` for a private one. */
function methodName(key: Node): string | undefined {
  if (key.type === "PrivateIdentifier") return `#${(key as unknown as { name: string }).name}`;
  return keyName(key);
}

function sorted(e: Emitters, ids: Set<string>): string[] {
  return [...ids].sort((a, b) => (e.order.get(a) ?? 0) - (e.order.get(b) ?? 0));
}

/** Every source file under a directory, its subdirectories included: `rules/`, `vo/` and `events/` are the domain too. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out = sourceFiles(dir);
  for (const name of readdirSync(dir).sort()) {
    const sub = join(dir, name);
    if (statSync(sub).isDirectory()) out.push(...filesUnder(sub));
  }
  return out;
}
