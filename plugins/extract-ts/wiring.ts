// Bindings, read off src/di: which use case or which adapter fills a port a
// use case declares for itself. A use case states its need as an interface
// of its own so that it does not import what satisfies it; the binding
// therefore exists in assembly - as a provider function whose return type is
// the port and whose body says what it returns, or as an Inversify
// container's `bind<Port>(token).to(Impl)` - and both are read here.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, text, type Source } from "./source.ts";
import { isCall, isIdent, isMember, isNew, isReturn, isTypeRef, memberName, walk, type BlockStatement, type CallExpression, type FunctionNode, type Node } from "./ast.ts";
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
export function readBindings(diDir: string): Map<string, Binding[]> {
  const out = new Map<string, Binding[]>();
  if (!existsSync(diDir)) return out;
  // One port, several bindings, is assembly choosing by a setting: the
  // adapter over a real peer when the peer is named, a stand-in when it is
  // not. Every one is kept, and the flow reader picks the one that goes
  // somewhere.
  const add = (binding: Binding): void => {
    out.set(binding.port, [...(out.get(binding.port) ?? []), binding]);
  };
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
        if (binding) add(binding);
      }
      for (const binding of containerBindings(src)) add(binding);
    }
  };
  walk(diDir);
  return out;
}

/**
 * `container.bind<Sessions>(TOKENS.Sessions).to(AuthSessions)`: the type
 * argument names the port, the import of that type says which use case
 * declares it, and `.to(...)` says what fills it - a use case or an adapter.
 * `.toConstantValue(new AuthSessions(url))` says the same with the instance
 * made on the spot, and is read the same. `.toSelf()` and
 * `.toDynamicValue(...)` bind a class to itself or to a factory, which is a
 * binding of a different kind and not one that pairs a port with a service;
 * those are left alone.
 */
function containerBindings(src: Source): Binding[] {
  const out: Binding[] = [];
  walk(src.parsed.program, (node) => {
    if (!isCall(node) || !isMember(node.callee)) return;
    const method = memberName(node.callee);
    if (method !== "to" && method !== "toConstantValue") return;
    const arg = node.arguments[0];
    const target = arg && isNew(arg) ? arg.callee : arg;
    const bindCall = bindOf(node.callee.object);
    if (bindCall && isIdent(target)) {
      const binding = containerBinding(src, bindCall, target.name);
      if (binding) out.push(binding);
    }
  });
  return out;
}

/** Walks back along a chain - `.inSingletonScope()`, `.whenTargetNamed(...)` - to the `bind(...)` call. */
function bindOf(expr: Node): CallExpression | undefined {
  let e: Node = expr;
  for (let i = 0; i < 8; i++) {
    if (isCall(e) && isMember(e.callee)) {
      if (memberName(e.callee) === "bind") return e;
      e = e.callee.object;
      continue;
    }
    if (isMember(e)) {
      e = e.object;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function containerBinding(src: Source, bind: CallExpression, implName: string): Binding | undefined {
  // The port: the type argument of bind<Port>(...), or the token's last name.
  let portName: string | undefined;
  const typeArg = bind.typeArguments?.params[0];
  if (isTypeRef(typeArg) && isIdent(typeArg.typeName)) portName = typeArg.typeName.name;
  if (!portName) {
    const token = bind.arguments[0];
    if (isMember(token)) portName = memberName(token);
    else if (isIdent(token)) portName = token.name;
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

function bindingOf(src: Source, fn: FunctionNode): Binding | undefined {
  if (!fn.returnType || !fn.body) return undefined;
  const returned = fn.returnType.typeAnnotation;
  const typeName = isTypeRef(returned) && isIdent(returned.typeName) ? returned.typeName.name : undefined;
  if (!typeName) return undefined;
  const portImport = src.imports.find((i) => i.local === typeName);
  if (!portImport?.file) return undefined;
  const key = useCaseKeyOf(portImport.file);
  if (!key) return undefined;
  const port = `${key}.${portImport.imported}`;

  // A parameter that is another use case binds the port to it.
  for (const p of fn.params) {
    const ann = isIdent(p) ? p.typeAnnotation?.typeAnnotation : undefined;
    const t = isTypeRef(ann) && isIdent(ann.typeName) ? ann.typeName.name : undefined;
    const imp = t ? src.imports.find((i) => i.local === t) : undefined;
    if (imp?.file && imp.imported === "UseCase") {
      const target = useCaseKeyOf(imp.file);
      if (target) return { port, useCase: target, source: src.path };
    }
  }

  // Otherwise the body says what it builds: `return new Adapter(...)`.
  const built = lastReturn(fn.body);
  if (isNew(built) && isIdent(built.callee)) {
    const name = text(src, built.callee);
    const imp = src.imports.find((i) => i.local === name);
    if (imp?.file) return { port, adapter: { file: imp.file, cls: imp.imported }, source: src.path };
    const local = src.classes.find((c) => c.name === name);
    if (local) return { port, adapter: { file: src.path, cls: local.name }, source: src.path };
  }
  return undefined;
}

function lastReturn(body: BlockStatement): Node | undefined {
  const last = body.body[body.body.length - 1];
  return isReturn(last) ? (last.argument ?? undefined) : undefined;
}
