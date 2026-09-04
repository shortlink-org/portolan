// Endpoints, read off src/infrastructure/transport/http: the document's
// operationIds name the handlers, and a handler's body names the use cases
// it runs, in order.

import type * as TSNS from "ts-api";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSpec, type Spec } from "./openapi.ts";
import { readSource, ts, type ClassInfo, type Source, at } from "./source.ts";
import { useCaseKeyOf } from "./operations.ts";
import type { Diagnostics } from "./domain.ts";

export interface Endpoint {
  /** The operationId. */
  id: string;
  /** file:line of the handler. */
  line: string;
  source: string;
  /** Use case keys, in the order the handler runs them. */
  useCases: string[];
}

export interface Transport {
  spec: Spec | undefined;
  endpoints: Endpoint[];
}

export function readTransport(httpDir: string, rel: (abs: string) => string, b: Diagnostics): Transport {
  const specPath = join(httpDir, "gen", "openapi.yaml");
  if (!existsSync(specPath)) return { spec: undefined, endpoints: [] };
  const spec = readSpec(specPath);
  const wanted = new Map(spec.operations.map((op) => [op.id, op]));
  const endpoints: Endpoint[] = [];
  const found = new Set<string>();

  for (const pkg of readdirSync(httpDir).sort()) {
    const dir = join(httpDir, pkg);
    if (pkg === "gen" || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const src = readSource(join(dir, name));
      if (!src) continue;
      for (const cls of src.classes) {
        const ports = useCasePorts(src, cls);
        for (const [method, m] of cls.methods) {
          if (!wanted.has(method) || found.has(method)) continue;
          found.add(method);
          endpoints.push({
            id: method,
            line: at(src.sf, m.node, rel),
            source: rel(src.path),
            useCases: useCasesRun(m.node, ports),
          });
        }
      }
    }
  }
  for (const id of wanted.keys()) {
    if (!found.has(id)) b.warn(id, `${rel(specPath)} declares ${id} but no handler under ${rel(httpDir)} is named by it`);
  }
  endpoints.sort((a, c) => a.id.localeCompare(c.id));
  return { spec, endpoints };
}

/** Constructor parameters whose type is a UseCase import: field name → use case key. */
export function useCasePorts(src: Source, cls: ClassInfo): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of cls.params) {
    const local = p.type.replace(/^typeof\s+/, "").trim();
    const imp = src.imports.find((i) => i.local === local);
    if (!imp?.file || imp.imported !== "UseCase") continue;
    const key = useCaseKeyOf(imp.file);
    if (key) out.set(p.name, key);
  }
  return out;
}

/** `this.<port>.handle(...)` calls, in source order, as use case keys. */
function useCasesRun(node: TSNS.Node, ports: Map<string, string>): string[] {
  const out: string[] = [];
  const visit = (n: TSNS.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "handle") {
      const target = n.expression.expression;
      if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const key = ports.get(target.name.text);
        if (key) out.push(key);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
