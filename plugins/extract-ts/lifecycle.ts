// The root's lifecycle, read off two things the code already has: a table
// that says where a status can go, and the one method that changes it.
//
//   export const TRANSITIONS = { open: ["checked-out", "abandoned"], "checked-out": [], abandoned: [] };
//   private moveTo(next: BasketStatus, now: Date) { … this.status = next; … }
//   checkout(…): BasketCheckedOut { this.moveTo("checked-out", now); … }
//
// The table gives the states, in its own order, and the edges. The method
// that assigns `this.status` is the mover; every public method that calls it
// with a literal makes the edges into that state, and hands back whatever
// event its return type names. Nothing is inferred beyond that: a status
// assigned anywhere else is reported, and an edge in the table no method
// makes is reported, because the table is a claim and the claim should be
// kept.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Lifecycle, Transition } from "../../src/catalog.ts";
import { readSource, at, bareType, type ClassInfo } from "./source.ts";
import { isArray, isAssign, isCall, isIdent, isMember, isObject, isProp, isString, isVarDecl, keyName, thisMember, unwrap, walk, type Node, type ObjectExpression } from "./ast.ts";
import type { Diagnostics } from "./domain.ts";

/** The exported constant the table is looked for under. */
export const TABLE = "TRANSITIONS";

export function readLifecycle(dir: string, root: ClassInfo, rootFile: string, events: Map<string, string>, id: string, rel: (abs: string) => string, b: Diagnostics): Lifecycle | undefined {
  const table = readTable(dir);
  if (!table) return undefined;
  const states = [...table.keys()];

  const rootSrc = readSource(rootFile);
  if (!rootSrc) return undefined;
  const mover = moverOf(root);
  if (!mover) {
    b.warn(id, `${rel(rootFile)}: ${root.name} has a ${TABLE} table but no method assigns this.status, so nothing is read as moving along it`);
    return { states, transitions: [] };
  }

  const transitions: Transition[] = [];
  const made = new Set<string>();
  for (const [name, m] of root.methods) {
    if (name === mover || m.isStatic || !m.body) continue;
    const returned = bareType(m.returns);
    const emits = events.get(returned);
    walk(m.body, (node) => {
      // this.moveTo("checked-out", …): the edges into that state, made here.
      const to = moveCall(node, mover);
      if (to !== undefined) {
        if (!table.has(to)) {
          b.warn(id, `${at(rootSrc, node, rel)}: ${name} moves to "${to}", which is not a state in ${TABLE}`);
          return;
        }
        for (const [from, targets] of table) {
          if (!targets.includes(to)) continue;
          made.add(`${from}→${to}`);
          const t: Transition = { from, to, on: name, source: at(rootSrc, node, rel) };
          if (emits) t.emits = emits;
          transitions.push(t);
        }
        return;
      }
      // this.status = …, anywhere but the mover: a move the table cannot see.
      if (assignsStatus(node)) {
        b.warn(id, `${at(rootSrc, node, rel)}: ${name} assigns this.status directly; a move outside ${mover} is not in the lifecycle`);
      }
    });
  }
  for (const [from, targets] of table) {
    for (const to of targets) {
      if (!made.has(`${from}→${to}`)) b.warn(id, `${TABLE} allows ${from} → ${to}, and no method of ${root.name} makes that move`);
    }
  }
  // In table order, so the page reads the way the table does.
  const order = new Map(states.map((s, i) => [s, i]));
  transitions.sort((x, y) => (order.get(x.from)! - order.get(y.from)!) || (order.get(x.to)! - order.get(y.to)!));

  return { states, transitions };
}

/** `export const TRANSITIONS = { a: ["b"], b: [] }` in any file of the directory. */
function readTable(dir: string): Map<string, string[]> | undefined {
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const src = readSource(join(dir, name));
    if (!src) continue;
    for (const stmt of src.parsed.program.body) {
      const decl = stmt.type === "ExportNamedDeclaration" ? (stmt as { declaration: Node | null }).declaration : stmt;
      if (!isVarDecl(decl)) continue;
      for (const d of decl.declarations) {
        if (!isIdent(d.id) || d.id.name !== TABLE || !d.init) continue;
        const init = unwrap(d.init);
        if (isObject(init)) return tableOf(init);
      }
    }
  }
  return undefined;
}

function tableOf(obj: ObjectExpression): Map<string, string[]> | undefined {
  const out = new Map<string, string[]>();
  for (const prop of obj.properties) {
    if (!isProp(prop) || prop.computed) return undefined;
    const key = keyName(prop.key);
    const value = unwrap(prop.value);
    if (key === undefined || !isArray(value)) return undefined;
    const targets: string[] = [];
    for (const el of value.elements) {
      if (!isString(el)) return undefined;
      targets.push(el.value);
    }
    out.set(key, targets);
  }
  return out;
}

/** The method whose body assigns `this.status`: the one way the status changes. */
function moverOf(root: ClassInfo): string | undefined {
  for (const [name, m] of root.methods) {
    if (!m.body) continue;
    let assigns = false;
    walk(m.body, (node) => {
      if (assignsStatus(node)) assigns = true;
    });
    if (assigns) return name;
  }
  return undefined;
}

function assignsStatus(node: Node): boolean {
  return isAssign(node) && node.operator === "=" && thisMember(node.left) === "status";
}

/** `this.<mover>("state", …)` → "state". */
function moveCall(node: Node, mover: string): string | undefined {
  if (!isCall(node) || !isMember(node.callee) || thisMember(node.callee) !== mover) return undefined;
  const first = node.arguments[0];
  return isString(first) ? first.value : undefined;
}
