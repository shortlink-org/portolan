// Bindings, read off src/di/providers: which use case or which adapter fills
// a port a use case declares for itself. A use case states its need as an
// interface of its own so that it does not import what satisfies it; the
// binding therefore exists in assembly, as a function whose return type is
// the port and whose body says what it returns.

import type * as TSNS from "ts-api";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, ts, type Source } from "./source.ts";
import { useCaseKeyOf } from "./operations.ts";

export interface Binding {
  /** "<usecase key>.<PortName>" */
  port: string;
  /** The use case that fills it, when one does. */
  useCase?: string;
  /** The adapter that fills it: its class, in its file. */
  adapter?: { file: string; cls: string };
  /** Where the binding was read from. */
  source: string;
}

export function readBindings(providersDir: string): Map<string, Binding> {
  const out = new Map<string, Binding>();
  if (!existsSync(providersDir)) return out;
  for (const name of readdirSync(providersDir).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const src = readSource(join(providersDir, name));
    if (!src) continue;
    for (const fn of src.functions.values()) {
      const binding = bindingOf(src, fn);
      if (binding) out.set(binding.port, binding);
    }
  }
  return out;
}

function bindingOf(src: Source, fn: TSNS.FunctionDeclaration): Binding | undefined {
  if (!fn.type || !fn.body) return undefined;
  const typeName = ts.isTypeReferenceNode(fn.type) && ts.isIdentifier(fn.type.typeName) ? fn.type.typeName.text : undefined;
  if (!typeName) return undefined;
  const portImport = src.imports.find((i) => i.local === typeName);
  if (!portImport?.file) return undefined;
  const key = useCaseKeyOf(portImport.file);
  if (!key) return undefined;
  const port = `${key}.${portImport.imported}`;

  // A parameter that is another use case binds the port to it.
  for (const p of fn.parameters) {
    const t = p.type && ts.isTypeReferenceNode(p.type) && ts.isIdentifier(p.type.typeName) ? p.type.typeName.text : undefined;
    const imp = t ? src.imports.find((i) => i.local === t) : undefined;
    if (imp?.file && imp.imported === "UseCase") {
      const target = useCaseKeyOf(imp.file);
      if (target) return { port, useCase: target, source: src.path };
    }
  }

  // Otherwise the body says what it builds: `return new Adapter(...)`.
  const returned = lastReturn(fn.body);
  if (returned && ts.isNewExpression(returned) && ts.isIdentifier(returned.expression)) {
    const imp = src.imports.find((i) => i.local === returned.expression.getText());
    if (imp?.file) return { port, adapter: { file: imp.file, cls: imp.imported }, source: src.path };
    const local = src.classes.find((c) => c.name === returned.expression.getText());
    if (local) return { port, adapter: { file: src.path, cls: local.name }, source: src.path };
  }
  return undefined;
}

function lastReturn(body: TSNS.Block): TSNS.Expression | undefined {
  const last = body.statements[body.statements.length - 1];
  if (last && ts.isReturnStatement(last)) return last.expression;
  return undefined;
}
