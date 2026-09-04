// Bindings, read off src/di: which use case or which adapter fills a port a
// use case declares for itself. A use case states its need as an interface
// of its own so that it does not import what satisfies it; the binding
// therefore exists in assembly - as a provider function whose return type is
// the port and whose body says what it returns, or as an Inversify
// container's `bind<Port>(token).to(Impl)` - and both are read here.

import type * as TSNS from "ts-api";
import { existsSync, readdirSync, statSync } from "node:fs";
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

/**
 * Every binding under src/di, whichever way it is written: a provider
 * function whose return type is the port, or an Inversify container's
 * `bind<Port>(token).to(Impl)`. Both say the same thing - this port, filled
 * by that - and both are read into the same map.
 */
export function readBindings(diDir: string): Map<string, Binding> {
  const out = new Map<string, Binding>();
  if (!existsSync(diDir)) return out;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const src = readSource(path);
      if (!src) continue;
      for (const fn of src.functions.values()) {
        const binding = bindingOf(src, fn);
        if (binding) out.set(binding.port, binding);
      }
      for (const binding of containerBindings(src)) out.set(binding.port, binding);
    }
  };
  walk(diDir);
  return out;
}

/**
 * `container.bind<Sessions>(TOKENS.Sessions).to(AuthSessions)`: the type
 * argument names the port, the import of that type says which use case
 * declares it, and `.to(...)` says what fills it - a use case or an adapter.
 * `.toSelf()` and `.toDynamicValue(...)` bind a class to itself or to a
 * factory, which is a binding of a different kind and not one that pairs a
 * port with a service; those are left alone.
 */
function containerBindings(src: Source): Binding[] {
  const out: Binding[] = [];
  const visit = (node: TSNS.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "to") {
      const target = node.arguments[0];
      const bindCall = bindOf(node.expression.expression);
      if (bindCall && target && ts.isIdentifier(target)) {
        const binding = containerBinding(src, bindCall, target.text);
        if (binding) out.push(binding);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src.sf);
  return out;
}

/** Walks back along a chain - `.inSingletonScope()`, `.whenTargetNamed(...)` - to the `bind(...)` call. */
function bindOf(expr: TSNS.Expression): TSNS.CallExpression | undefined {
  let e: TSNS.Expression = expr;
  for (let i = 0; i < 8; i++) {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      if (e.expression.name.text === "bind") return e;
      e = e.expression.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(e)) {
      e = e.expression;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function containerBinding(src: Source, bind: TSNS.CallExpression, implName: string): Binding | undefined {
  // The port: the type argument of bind<Port>(...), or the token's last name.
  let portName: string | undefined;
  const typeArg = bind.typeArguments?.[0];
  if (typeArg && ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)) portName = typeArg.typeName.text;
  if (!portName) {
    const token = bind.arguments[0];
    if (token && ts.isPropertyAccessExpression(token)) portName = token.name.text;
    else if (token && ts.isIdentifier(token)) portName = token.text;
  }
  if (!portName) return undefined;
  const portImport = src.imports.find((i) => i.local === portName);
  if (!portImport?.file) return undefined;
  const key = useCaseKeyOf(portImport.file);
  if (!key) return undefined;
  const port = `${key}.${portImport.imported}`;

  const impl = src.imports.find((i) => i.local === implName);
  if (impl?.file && impl.imported === "UseCase") {
    const target = useCaseKeyOf(impl.file);
    if (target) return { port, useCase: target, source: src.path };
  }
  if (impl?.file) return { port, adapter: { file: impl.file, cls: impl.imported }, source: src.path };
  const local = src.classes.find((c) => c.name === implName);
  if (local) return { port, adapter: { file: src.path, cls: local.name }, source: src.path };
  return undefined;
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
