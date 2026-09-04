// Use cases, read off src/application: each `usecases/<name>/usecase.ts`
// is an operation of the aggregate its directory is named after, and the
// constructor of its UseCase is the list of ports it reaches through.

import type * as TSNS from "ts-api";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Operation } from "../../src/catalog.ts";
import { camel } from "./ids.ts";
import { readSource, ts, type ClassInfo, type Source } from "./source.ts";
import type { Diagnostics } from "./domain.ts";

/** A use case: where it is, what it is called, and what it holds. */
export interface UseCase {
  /** "<aggregate>/<name>", the key the flows and the bindings use. */
  key: string;
  aggregate: string;
  name: string;
  dir: string;
  source: Source;
  cls: ClassInfo;
}

/** The verbs that make a use case a command: what it does to a port that changes the world. */
const WRITES = new Set(["save", "delete", "create", "update", "publish", "remove", "insert", "upsert"]);

export function readUseCases(applicationDir: string, rel: (abs: string) => string, b: Diagnostics): UseCase[] {
  if (!existsSync(applicationDir)) return [];
  const out: UseCase[] = [];
  for (const aggregate of readdirSync(applicationDir).sort()) {
    const usecases = join(applicationDir, aggregate, "usecases");
    if (aggregate === "policy" || !existsSync(usecases) || !statSync(usecases).isDirectory()) continue;
    for (const name of readdirSync(usecases).sort()) {
      const dir = join(usecases, name);
      if (!statSync(dir).isDirectory()) continue;
      const file = join(dir, "usecase.ts");
      const source = readSource(file);
      const cls = source?.classes.find((c) => c.name === "UseCase");
      if (!source || !cls) {
        b.warn(`${aggregate}/${name}`, `${rel(dir)} has no exported class UseCase in usecase.ts; the use case contributes nothing`);
        continue;
      }
      if (!cls.methods.has("handle")) {
        b.warn(`${aggregate}/${name}`, `${rel(file)}: UseCase has no handle method; the use case contributes no steps`);
      }
      out.push({ key: `${aggregate}/${name}`, aggregate, name, dir, source, cls });
    }
  }
  return out;
}

/** The use case as an operation of its aggregate. `exposedBy` is filled by the transport reader. */
export function operationOf(uc: UseCase): Operation {
  return { id: camel(uc.name), kind: isCommand(uc) ? "command" : "query", doc: docOf(uc) };
}

/** README.md's first paragraph after the title, or the JSDoc above the class. */
function docOf(uc: UseCase): string {
  const readme = join(uc.dir, "README.md");
  if (existsSync(readme)) {
    const text = readFileSync(readme, "utf8");
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("#"));
    if (paragraphs[0]) return paragraphs[0].replace(/\s+/g, " ");
  }
  return uc.cls.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "";
}

/** A command writes through a port; a query only reads. Read off every method of the class. */
function isCommand(uc: UseCase): boolean {
  let command = false;
  const ports = new Set(uc.cls.params.map((p) => p.name));
  const visit = (node: TSNS.Node): void => {
    if (command) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      const method = callee.name.text.toLowerCase();
      if (WRITES.has(method) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.expression.kind === ts.SyntaxKind.ThisKeyword && ports.has(callee.expression.name.text)) {
        command = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const m of uc.cls.methods.values()) visit(m.node);
  return command;
}

export function useCaseKeyOf(file: string): string | undefined {
  // .../application/<aggregate>/usecases/<name>/usecase.ts
  const m = /[\\/]application[\\/]([^\\/]+)[\\/]usecases[\\/]([^\\/]+)[\\/]usecase\.ts$/.exec(file);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

export { basename as _b };
