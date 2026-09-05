// Flows, read out of the same layout as everything else here, and the layout
// is again the claim.
//
// Two things start one. An endpoint is somebody calling in, and the handler
// says which use cases it runs and in what order. A policy is an event
// arriving, and the type or the name it tests for says which. Everything
// after that is the use case's own body: a constructor parameter is a port, a
// call on that port is a hop, and a value that a domain method handed back as
// an event is what puts the event on the bus when a port is given it.
//
// Statements are read in source order. An `if` or a `switch` becomes an alt
// only when something happens inside it, and its branch is terminal when the
// block ends in a return or a throw. A loop is a note on the steps inside it.
// Nothing is observed running, so every step is declared; a call whose peer
// the manifest does not name is unresolved.

import { dirname, join } from "node:path";
import type { Alt, AltBranch, Flow, FlowNode, Participant, RpcCall, Status, Step } from "../../src/catalog.ts";
import { adapterCalls, callsIn, type RpcHop } from "./clients.ts";
import { camel, eventID, slug } from "./ids.ts";
import { readSource, at, bareType, text, type ClassInfo, type Source } from "./source.ts";
import { isArrayPattern, isBinary, isBlock, isCall, isForEach, isFor, isFunctionType, isIdent, isIf, isMember, isMethodSig, isPropertySig, isReturn, isSpread, isString, isSwitch, isSwitchCase, isThis, isThrow, isTry, isVarDecl, isWhile, isAssign, keyName, memberName, paramIdent, thisMember, typeText, unwrap, walk, type CallExpression, type ForEachStatement, type IfStatement, type Node, type SwitchStatement } from "./ast.ts";
import type { UseCase } from "./operations.ts";
import { PORTS, type Binding } from "./wiring.ts";
import type { AggregateRead, WarningSink } from "./domain.ts";
import type { Endpoint } from "./transport.ts";
import type { Resolver } from "./graphql.ts";

export const LANE_CLIENT = "client";
export const LANE_BUS = "bus";
const MAX_INLINE = 2;

export interface FlowOptions {
  context: string;
  svcID: string;
  service: string;
  store: string;
  peers: Record<string, string>;
  /** Import specifier of another service's events → the aggregate id they belong to. */
  events: Record<string, string>;
}

/** What one use case body is being read against. */
interface Scope {
  src: Source;
  key: string;
  cls: ClassInfo;
  /**
   * The identifier the ports arrive on, for a body that is not a method: a
   * resolver is handed a context rather than holding fields, so `ctx.baskets`
   * is what `this.baskets` is to a use case. Empty for a method.
   */
  self?: string;
  /** Port name → type as written. */
  ports: Map<string, string>;
  /** Local name → what it holds, when it is an event or a domain object. */
  vars: Map<string, DomainRef>;
}

interface DomainRef {
  /** The class name. */
  name: string;
  /** Its event id, when it is an event. */
  event?: string;
  /** The aggregate it belongs to, for a domain object whose methods hand back events. */
  aggregate?: AggregateRead;
  /** What a list the use case is collecting has been given, for `events.push(...)` handed on as `...events`. */
  items?: DomainRef[];
}

class Draft {
  lanes: Participant[] = [];
  steps: FlowNode[] = [];
  private sinks: FlowNode[][] = [];
  private n = 0;
  readonly seen = new Set<string>();
  private loops: string[] = [];

  lane(p: Participant): string {
    if (!this.lanes.some((l) => l.id === p.id)) this.lanes.push(p);
    return p.id;
  }
  sink(): FlowNode[] {
    return this.sinks[this.sinks.length - 1] ?? this.steps;
  }
  push(): void {
    this.sinks.push([]);
  }
  pop(): FlowNode[] {
    return this.sinks.pop() ?? [];
  }
  enter(loop: string): void {
    this.loops.push(loop);
  }
  leave(): void {
    this.loops.pop();
  }
  note(own: string): string {
    const loops = [...new Set(this.loops.filter(Boolean))];
    const prefix = loops.length ? `${loops.join(", ")}.` : "";
    return `${prefix} ${own}`.trim();
  }
  add(step: Omit<Step, "type" | "id" | "status"> & { status?: Status }): void {
    this.n += 1;
    const note = this.note(step.note ?? "");
    const out: Step = { type: "step", id: `s${this.n}`, from: step.from, to: step.to, kind: step.kind, label: step.label, status: step.status ?? "declared" };
    if (step.ref) out.ref = step.ref;
    if (note) out.note = note;
    if (step.line) out.line = step.line;
    this.sink().push(out);
  }
  addAlt(branches: AltBranch[]): void {
    this.n += 1;
    const alt: Alt = { type: "alt", id: `alt${this.n}`, branches };
    this.sink().push(alt);
  }
}

export class FlowReader {
  readonly calls = new Map<string, RpcCall>();
  readonly referenced = new Set<string>();
  private warnedStore = false;
  private readonly warnedPeer = new Set<string>();
  readonly opts: FlowOptions;
  readonly useCases: Map<string, UseCase>;
  readonly bindings: Map<string, Binding[]>;
  readonly aggregates: AggregateRead[];
  readonly rel: (abs: string) => string;
  readonly b: WarningSink;

  constructor(opts: FlowOptions, useCases: Map<string, UseCase>, bindings: Map<string, Binding[]>, aggregates: AggregateRead[], rel: (abs: string) => string, b: WarningSink) {
    this.opts = opts;
    this.useCases = useCases;
    this.bindings = bindings;
    this.aggregates = aggregates;
    this.rel = rel;
    this.b = b;
  }

  serviceLane(): Participant {
    return { id: this.opts.svcID, kind: "service", context: this.opts.context };
  }
  busLane(): Participant {
    return { id: LANE_BUS, kind: "broker", context: null };
  }
  storeLane(d: Draft): string {
    if (!this.opts.store) {
      if (!this.warnedStore) {
        this.b.warn(this.opts.svcID, "no store named in the options, so repository calls stay on the service's own lane");
        this.warnedStore = true;
      }
      return this.opts.svcID;
    }
    return d.lane({ id: `${this.opts.service}-${this.opts.store}`, kind: "store", context: this.opts.context });
  }
  peerLane(d: Draft, pkg: string): { lane: string; peer: string; status: Status } {
    const service = this.opts.peers[pkg];
    if (service) {
      const context = service.slice(0, service.indexOf("."));
      return { lane: d.lane({ id: service, kind: "service", context }), peer: service, status: "declared" };
    }
    if (!this.warnedPeer.has(pkg)) {
      this.warnedPeer.add(pkg);
      this.b.warn(this.opts.svcID, `calls ${pkg} and the manifest names no peer for that package; add it under \`peers\` to say which service answers, until then the calls are unresolved`);
    }
    return { lane: d.lane({ id: pkg.replaceAll(".", "-"), kind: "unknown", context: null, label: pkg }), peer: pkg, status: "unresolved" };
  }

  consumes(): RpcCall[] {
    return [...this.calls.values()].sort((a, c) => a.id.localeCompare(c.id));
  }

  // --- the two openings -----------------------------------------------------

  endpointFlow(endpoint: Endpoint): Flow | null {
    const d = new Draft();
    d.lane({ id: LANE_CLIENT, kind: "actor", context: null });
    d.lane(this.serviceLane());
    d.add({ from: LANE_CLIENT, to: this.opts.svcID, kind: "rpc", label: endpoint.id, line: endpoint.line });
    for (const key of endpoint.useCases) this.walkUseCase(d, key, 0);
    const last = endpoint.useCases[endpoint.useCases.length - 1];
    const name = slug(endpoint.id);
    const id = `${this.opts.service}-${name}`;
    return {
      id: `flow.${id}`,
      slug: id,
      name: sentence(name),
      summary: last ? this.useCaseSummary(last) : "",
      source: endpoint.source,
      owner: this.opts.context,
      participants: d.lanes,
      steps: d.steps,
    };
  }

  /**
   * A field of the schema, opened by whoever asked for it.
   *
   * The counterpart of endpointFlow for a service whose way in is a graph:
   * the step from the client is the field, named as the schema names it, and
   * everything after it is the resolver's own body - a call on a port is a
   * hop, exactly as it is inside a use case.
   */
  resolverFlow(resolver: Resolver): Flow | null {
    const d = new Draft();
    d.lane({ id: LANE_CLIENT, kind: "actor", context: null });
    d.lane(this.serviceLane());
    d.add({ from: LANE_CLIENT, to: this.opts.svcID, kind: "rpc", label: resolver.id, line: resolver.line });

    const cls: ClassInfo = { name: resolver.id, node: null as never, doc: "", exported: true, fields: [], params: [], methods: new Map(), nameLiteral: undefined };
    const scope: Scope = { src: resolver.src, key: `resolver/${resolver.id}`, cls, ports: resolver.ports, vars: new Map() };
    if (resolver.self) scope.self = resolver.self;
    this.walkBody(d, scope, resolver.body, 0);

    const name = slug(resolver.id);
    const id = `${this.opts.service}-${name}`;
    return {
      id: `flow.${id}`,
      slug: id,
      name: sentence(name),
      summary: resolver.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "",
      source: this.rel(resolver.src.path),
      owner: this.opts.context,
      participants: d.lanes,
      steps: d.steps,
    };
  }

  policyFlows(policyDir: string): Flow[] {
    const out: Flow[] = [];
    let files: string[] = [];
    try {
      files = require("node:fs").readdirSync(policyDir).filter((f: string) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
    } catch {
      return out;
    }
    for (const file of files) {
      const src = readSource(join(policyDir, file));
      if (!src) continue;
      for (const cls of src.classes) {
        const handle = cls.methods.get("handle");
        if (!cls.exported || !handle?.body) continue;
        const trigger = this.assertedEvent(src, handle.node);
        if (!trigger) {
          this.b.warn(cls.name, `${this.rel(src.path)}: ${cls.name}.handle tests for no event; the policy is not paired with what triggers it`);
          continue;
        }
        const d = new Draft();
        d.lane(this.busLane());
        d.lane(this.serviceLane());
        const line = at(src, handle.node, this.rel);
        if (trigger.foreign) {
          this.b.warn(cls.name, `${this.rel(src.path)}: ${cls.name}.handle reacts to ${trigger.name} from ${trigger.foreign}, an event this repository does not declare and the manifest's \`events\` does not place; the step is unresolved`);
          d.add({ from: LANE_BUS, to: this.opts.svcID, kind: "event", label: trigger.name, status: "unresolved", note: `Reacts to \`${trigger.name}\` from \`${trigger.foreign}\`, which is not an event this repository declares.`, line });
        } else {
          d.add({ from: LANE_BUS, to: this.opts.svcID, kind: "event", label: trigger.name, ref: trigger.id, line });
          this.referenced.add(trigger.id!);
        }
        this.walkBody(d, { src, key: `policy/${cls.name}`, cls, ports: new Map(cls.params.map((p) => [p.name, p.type])), vars: new Map([[paramIdent(handle.params[0]!)?.name ?? "event", { name: trigger.name, event: trigger.id }]]) }, handle.body, 0);
        const id = `${this.opts.service}-${slug(cls.name)}`;
        out.push({ id: `flow.${id}`, slug: id, name: sentence(slug(cls.name)), summary: cls.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "", source: this.rel(src.path), owner: this.opts.context, participants: d.lanes, steps: d.steps });
      }
    }
    return out;
  }

  /** `event instanceof X`, `event.name === "…"`, or `switch (event.name) { case "…" }`. */
  private assertedEvent(src: Source, fn: Node): { name: string; id?: string; foreign?: string } | undefined {
    let found: { name: string; id?: string; foreign?: string } | undefined;
    const byName = (wire: string): typeof found => {
      for (const agg of this.aggregates) {
        for (const [cls, id] of agg.events) {
          const evSrc = readSource(join(agg.dir, "events", `${slug(cls)}.ts`)) ?? readSource(join(agg.dir, "events", `${cls}.ts`));
          const lit = evSrc?.classes.find((c) => c.name === cls)?.nameLiteral;
          if (lit === wire) return { name: cls, id };
        }
      }
      return undefined;
    };
    const byClass = (local: string): typeof found => {
      const imp = src.imports.find((i) => i.local === local);
      for (const agg of this.aggregates) {
        const id = agg.events.get(imp?.imported ?? local);
        if (id && imp?.file && imp.file.startsWith(agg.dir)) return { name: imp.imported, id };
      }
      if (imp && !imp.file) {
        const aggregate = this.opts.events[imp.specifier];
        return aggregate ? { name: imp.imported, id: eventID(aggregate, imp.imported) } : { name: imp.imported, foreign: imp.specifier };
      }
      if (imp?.file) {
        const aggregate = this.opts.events[imp.specifier];
        return aggregate ? { name: imp.imported, id: eventID(aggregate, imp.imported) } : { name: imp.imported, foreign: imp.specifier };
      }
      return undefined;
    };
    walk(fn, (node) => {
      if (found) return;
      if (isBinary(node) && node.operator === "instanceof" && isIdent(node.right)) {
        found = byClass(node.right.name);
        return;
      }
      if (isBinary(node) && (node.operator === "===" || node.operator === "==")) {
        const lit = [node.left, node.right].find((e) => isString(e));
        if (isString(lit)) found = byName(lit.value);
        return;
      }
      if (isSwitchCase(node) && isString(node.test)) found = byName(node.test.value);
    });
    return found;
  }

  // --- reading one use case ---------------------------------------------------

  private useCaseSummary(key: string): string {
    const uc = this.useCases.get(key);
    if (!uc) return "";
    return uc.cls.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "";
  }

  walkUseCase(d: Draft, key: string, depth: number): void {
    if (depth > MAX_INLINE || d.seen.has(key)) return;
    d.seen.add(key);
    const uc = this.useCases.get(key);
    if (!uc) return;
    const handle = uc.cls.methods.get("handle");
    if (!handle) return;
    this.walkBody(d, { src: uc.source, key, cls: uc.cls, ports: new Map(uc.cls.params.map((p) => [p.name, p.type])), vars: new Map() }, handle.body, depth);
  }

  private walkBody(d: Draft, s: Scope, body: Node | null, depth: number): void {
    if (!body || !isBlock(body)) return;
    this.walkStmts(d, s, body.body, depth);
  }

  private walkStmts(d: Draft, s: Scope, list: readonly Node[], depth: number): void {
    for (const stmt of list) this.walkStmt(d, s, stmt, depth);
  }

  private walkStmt(d: Draft, s: Scope, stmt: Node, depth: number): void {
    if (isIf(stmt)) return this.walkIf(d, s, stmt, depth);
    if (isSwitch(stmt)) return this.walkSwitch(d, s, stmt, depth);
    if (isForEach(stmt)) {
      this.callsIn(d, s, stmt.right, depth);
      this.bindElement(s, stmt);
      d.enter(`inside a loop over \`${text(s.src, stmt.right)}\``);
      this.walkBlock(d, s, stmt.body, depth);
      d.leave();
      return;
    }
    if (isFor(stmt) || isWhile(stmt)) {
      const cond = stmt.test;
      if (isFor(stmt) && stmt.init) this.callsIn(d, s, stmt.init, depth);
      d.enter(cond ? `inside a loop, while \`${text(s.src, cond)}\`` : "inside a loop");
      this.walkBlock(d, s, stmt.body, depth);
      d.leave();
      return;
    }
    if (isBlock(stmt)) return this.walkStmts(d, s, stmt.body, depth);
    if (isTry(stmt)) {
      this.walkStmts(d, s, stmt.block.body, depth);
      if (stmt.handler) this.walkStmts(d, s, stmt.handler.body.body, depth);
      if (stmt.finalizer) this.walkStmts(d, s, stmt.finalizer.body, depth);
      return;
    }
    this.callsIn(d, s, stmt, depth);
  }

  private walkBlock(d: Draft, s: Scope, stmt: Node, depth: number): void {
    if (isBlock(stmt)) this.walkStmts(d, s, stmt.body, depth);
    else this.walkStmt(d, s, stmt, depth);
  }

  private walkIf(d: Draft, s: Scope, stmt: IfStatement, depth: number): void {
    const branches: AltBranch[] = [];
    const titles = new Set<string>();
    let drew = false;
    let current: IfStatement | undefined = stmt;
    while (current) {
      this.callsIn(d, s, current.test, depth);
      d.push();
      this.walkBlock(d, s, current.consequent, depth);
      const steps = d.pop();
      drew ||= steps.length > 0;
      branches.push({ title: unique(text(s.src, current.test), titles), steps, terminal: leaves(current.consequent) });
      const els: Node | null = current.alternate;
      if (!els) {
        branches.push({ title: unique("otherwise", titles), steps: [] });
        break;
      }
      if (isIf(els)) {
        current = els;
        continue;
      }
      d.push();
      this.walkBlock(d, s, els, depth);
      const elseSteps = d.pop();
      drew ||= elseSteps.length > 0;
      branches.push({ title: unique("otherwise", titles), steps: elseSteps, terminal: leaves(els) });
      break;
    }
    if (!drew) return;
    d.addAlt(unmarkIfAllLeave(branches));
  }

  private walkSwitch(d: Draft, s: Scope, stmt: SwitchStatement, depth: number): void {
    this.callsIn(d, s, stmt.discriminant, depth);
    const subject = text(s.src, stmt.discriminant);
    const branches: AltBranch[] = [];
    const titles = new Set<string>();
    let drew = false;
    let sawDefault = false;
    for (const clause of stmt.cases) {
      if (clause.test) this.callsIn(d, s, clause.test, depth);
      d.push();
      this.walkStmts(d, s, clause.consequent, depth);
      const steps = d.pop();
      drew ||= steps.length > 0;
      const title = clause.test ? `${subject} is ${text(s.src, clause.test)}` : "otherwise";
      if (!clause.test) sawDefault = true;
      const last = clause.consequent[clause.consequent.length - 1];
      branches.push({ title: unique(title, titles), steps, terminal: last ? leaves(last) : false });
    }
    if (!drew) return;
    if (!sawDefault) branches.push({ title: unique("otherwise", titles), steps: [] });
    d.addAlt(unmarkIfAllLeave(branches));
  }

  /** Every call under a node, in source order. */
  private callsIn(d: Draft, s: Scope, node: Node, depth: number): void {
    const assigned = new Map<CallExpression, Node>();
    walk(node, (n) => {
      if (isVarDecl(n)) {
        for (const decl of n.declarations) {
          const call = decl.init ? unwrap(decl.init) : undefined;
          if (isCall(call)) assigned.set(call, decl.id);
        }
      }
    });
    walk(node, (n) => {
      if (isCall(n)) this.call(d, s, n, assigned.get(n), depth);
      // `into = created`: a later assignment carries what the right side held.
      if (isAssign(n) && n.operator === "=" && isIdent(n.left)) {
        const r = this.resultsOfExpr(s, n.right)[0];
        if (r?.name) s.vars.set(n.left.name, r);
      }
    });
  }

  private call(d: Draft, s: Scope, call: CallExpression, lhs: Node | undefined, depth: number): void {
    const callee = call.callee;
    if (!isMember(callee)) {
      // A bare function: a domain constructor imported from the aggregate, `createBasket(...)`.
      if (isIdent(callee)) this.bind(s, lhs, this.resultsOfFunction(s, callee.name));
      return;
    }
    const method = memberName(callee);
    if (method === undefined) return;
    const target = callee.object;

    // events.push(into.addItem(...)) — a list the use case collects, to hand to a port later as `...events`.
    if (method === "push" && isIdent(target)) {
      const list = s.vars.get(target.name) ?? { name: target.name };
      list.items ??= [];
      for (const arg of call.arguments) for (const r of this.resultsOfExpr(s, arg)) if (r.event) list.items.push(r);
      s.vars.set(target.name, list);
      return;
    }

    // this.<port>.<method>(...) — a hop. And `ctx.<port>.<method>(...)`, which
    // is the same sentence in a resolver: the ports arrive on a parameter
    // rather than on the instance.
    const port = thisMember(target) ?? selfMember(s, target);
    if (port !== undefined) {
      const declared = s.ports.get(port);
      if (declared !== undefined) this.portCall(d, s, port, declared, method, call, lhs, depth);
      return;
    }
    // this.<helper>(...) — the same use case, another method.
    if (isThis(target)) {
      const helper = s.cls.methods.get(method);
      if (helper?.body) this.walkStmts(d, s, helper.body.body, depth);
      return;
    }
    // Basket.create(...) — a static domain constructor; basket.addItem(...) — a method on something the domain handed over.
    if (isIdent(target)) {
      const held = s.vars.get(target.name);
      if (held?.aggregate) {
        this.bind(s, lhs, this.resultsOfMethod(held, method));
        return;
      }
      this.bind(s, lhs, this.resultsOfStatic(s, target.name, method));
    }
  }

  private portCall(d: Draft, s: Scope, port: string, declared: string, method: string, call: CallExpression, lhs: Node | undefined, depth: number): void {
    if (/^\(.*\)\s*=>/.test(declared) || declared === "") return; // a clock, an id generator

    const src = s.src;
    const line = at(src, call, this.rel);
    const bare = bareType(declared);

    // A port bound in assembly to another use case, or to an adapter over a
    // client. It is looked up under the use case that declares it, which is
    // not always this one: a use case may take a port another declared rather
    // than say the same thing twice. And assembly may bind it more than once -
    // the adapter over a peer when the peer is named, a stand-in when it is
    // not - so the binding shown is the first that reaches a peer.
    const bound = this.bindings.get(`${this.portOwner(src, bare) ?? s.key}.${bare}`) ?? this.bindings.get(`${PORTS}.${bare}`) ?? [];
    const toUseCase = bound.find((b) => b.useCase)?.useCase;
    if (toUseCase) {
      this.useCaseHop(d, toUseCase, `Port \`${bare}\`, bound at assembly to the ${camel(toUseCase.split("/")[1] ?? "")} use case.`, line, depth);
      return;
    }
    const adapters = bound.flatMap((b) => (b.adapter ? [b.adapter] : []));
    if (adapters.length > 0) {
      for (const adapter of adapters) {
        const adapterSrc = readSource(adapter.file);
        if (!adapterSrc) continue;
        const hops = adapterCalls(adapterSrc, adapter.cls, method, this.rel, this.b);
        if (hops.length === 0) continue;
        for (const hop of hops) this.rpcHop(d, hop, line);
        return;
      }
      // An adapter over the bus calls nobody: it waits, and what it hears is
      // said by the channel the service declares, not by a step in a flow.
      // Every other adapter that reaches no peer is worth reporting.
      if (!adapters.every((a) => isBusAdapter(a.file))) {
        this.b.warn(s.key, `port \`${bare}\` is adapted by ${adapters.map((a) => `${a.cls}.${method}`).join(" and by ")}, which calls no peer; the call is left out of the flow`);
      }
      return;
    }

    // A port that is another use case outright.
    const imp = src.imports.find((i) => i.local === bare);
    if (imp?.file && imp.imported === "UseCase") {
      const key = useCaseKeyFromFile(imp.file);
      if (key) this.useCaseHop(d, key, "", line, depth);
      return;
    }

    // The generated client itself.
    const direct = callsIn(src, call, this.rel, this.b);
    if (direct.length > 0) {
      for (const hop of direct) this.rpcHop(d, hop, line);
      return;
    }

    // A port of the domain: the store is at the other end of it.
    const aggregate = this.domainPortAggregate(src, bare);
    if (!aggregate) {
      this.b.warn(s.key, `${this.rel(src.path)}: port \`${port}: ${declared}\` is neither a domain port, a use case nor a client; its calls are left out of the flow`);
      return;
    }
    d.add({ from: this.opts.svcID, to: this.storeLane(d), kind: "call", label: method, line });

    // An event handed to the port - the value itself, not a field read off
    // one - is the event leaving for the bus. What carries it there, an
    // outbox, a relay, is the adapter's business and not a step the source
    // can show.
    const handed = new Set<string>();
    for (const arg of call.arguments) {
      const inner = isSpread(arg) ? arg.argument! : arg;
      if (!isIdent(inner)) continue;
      const held = s.vars.get(inner.name);
      for (const item of held?.items ?? (held ? [held] : [])) {
        // A list handed over says which events leave, not how many times.
        if (!item.event || handed.has(item.event)) continue;
        handed.add(item.event);
        d.add({ from: this.opts.svcID, to: d.lane(this.busLane()), kind: "event", ref: item.event, label: item.name, line });
        this.referenced.add(item.event);
      }
    }

    // What the port handed back: `const basket = await this.repo.byId(...)` holds a Basket.
    this.bind(s, lhs, this.resultsOfPortMethod(src, aggregate, bare, method));
  }

  private useCaseHop(d: Draft, target: string, note: string, line: string, depth: number): void {
    d.add({ from: this.opts.svcID, to: this.opts.svcID, kind: "call", label: camel(target.split("/")[1] ?? target), note, line });
    this.walkUseCase(d, target, depth + 1);
  }

  private rpcHop(d: Draft, hop: RpcHop, line: string): void {
    const { lane, peer, status } = this.peerLane(d, hop.pkg);
    d.add({ from: this.opts.svcID, to: lane, kind: "rpc", ref: hop.id, label: hop.id.slice(hop.id.lastIndexOf("/") + 1), status, line });
    if (!this.calls.has(hop.id)) this.calls.set(hop.id, { id: hop.id, peer, status, source: hop.source });
  }

  // --- following a value back to its type ---------------------------------------

  /** The use case whose file declares the port `bare`, when this one imports it from there. */
  private portOwner(src: Source, bare: string): string | undefined {
    const imp = src.imports.find((i) => i.local === bare);
    return imp?.file ? useCaseKeyFromFile(imp.file) : undefined;
  }

  /** What an expression holds, for a value read somewhere other than a declaration. */
  private resultsOfExpr(s: Scope, expr: Node): DomainRef[] {
    const e = unwrap(expr);
    if (isIdent(e)) {
      const held = s.vars.get(e.name);
      return held ? [held] : [];
    }
    if (!isCall(e)) return [];
    const callee = e.callee;
    if (isIdent(callee)) return this.resultsOfFunction(s, callee.name);
    if (isMember(callee) && isIdent(callee.object)) {
      const method = memberName(callee);
      if (method === undefined) return [];
      const held = s.vars.get(callee.object.name);
      if (held?.aggregate) return this.resultsOfMethod(held, method);
      return this.resultsOfStatic(s, callee.object.name, method);
    }
    return [];
  }

  /** The aggregate whose port.ts declares `bare`, when the use case imports it from there. */
  private domainPortAggregate(src: Source, bare: string): AggregateRead | undefined {
    const imp = src.imports.find((i) => i.local === bare);
    if (!imp?.file) return undefined;
    return this.aggregates.find((a) => imp.file!.startsWith(a.dir));
  }

  private resultsOfPortMethod(src: Source, agg: AggregateRead, port: string, method: string): DomainRef[] {
    const imp = src.imports.find((i) => i.local === port);
    const portSrc = imp?.file ? readSource(imp.file) : undefined;
    const iface = portSrc?.interfaces.get(imp?.imported ?? port);
    if (!iface || !portSrc) return [];
    for (const m of iface.body.body) {
      if (isMethodSig(m) && keyName(m.key) === method) return this.refsOfType(agg, typeText(portSrc.parsed, m.returnType));
      if (isPropertySig(m) && keyName(m.key) === method) {
        const fn = m.typeAnnotation?.typeAnnotation;
        return this.refsOfType(agg, isFunctionType(fn) ? typeText(portSrc.parsed, fn.returnType) : "");
      }
    }
    return [];
  }

  private resultsOfFunction(s: Scope, name: string): DomainRef[] {
    const imp = s.src.imports.find((i) => i.local === name);
    if (!imp?.file) return [];
    const fn = readSource(imp.file)?.functions.get(imp.imported);
    if (!fn) return [];
    // A domain constructor is read against its own aggregate; a helper kept
    // elsewhere - `holderOf(repo, id, token)` under application/ - against
    // whichever aggregate its return type names.
    const own = this.aggregates.find((a) => imp.file!.startsWith(a.dir));
    const fnSrc = readSource(imp.file)!;
    const type = typeText(fnSrc.parsed, fn.returnType);
    for (const agg of own ? [own] : this.aggregates) {
      const refs = this.refsOfType(agg, type);
      if (refs.some((r) => r.name)) return refs;
    }
    return [];
  }

  private resultsOfStatic(s: Scope, cls: string, method: string): DomainRef[] {
    const imp = s.src.imports.find((i) => i.local === cls);
    if (!imp?.file) return [];
    const agg = this.aggregates.find((a) => imp.file!.startsWith(a.dir));
    const clsSrc = readSource(imp.file);
    const m = clsSrc?.classes.find((c) => c.name === imp.imported)?.methods.get(method);
    if (!agg || !m?.isStatic) return [];
    return this.refsOfType(agg, m.returns);
  }

  private resultsOfMethod(held: DomainRef, method: string): DomainRef[] {
    const agg = held.aggregate!;
    for (const file of require("node:fs").readdirSync(agg.dir) as string[]) {
      if (!file.endsWith(".ts")) continue;
      const src = readSource(join(agg.dir, file));
      const m = src?.classes.find((c) => c.name === held.name)?.methods.get(method);
      if (m) return this.refsOfType(agg, m.returns);
    }
    return [];
  }

  /** `Promise<[Basket, BasketCreated]>` → a Basket and an event, by position. */
  private refsOfType(agg: AggregateRead, type: string): DomainRef[] {
    let t = bareType(type);
    const tuple = /^\[(.*)\]$/s.exec(t);
    const parts = tuple ? splitTop(tuple[1]!) : [t];
    return parts.map((p) => {
      const name = bareType(p).replace(/\[\]$/, "");
      const event = agg.events.get(name);
      if (event) return { name, event };
      if (agg.own.has(name)) return { name, aggregate: agg };
      return { name: "" };
    });
  }

  private bind(s: Scope, lhs: Node | undefined, results: DomainRef[]): void {
    if (!lhs) return;
    if (isIdent(lhs)) {
      const r = results[0];
      if (r?.name) s.vars.set(lhs.name, r);
      return;
    }
    if (isArrayPattern(lhs)) {
      lhs.elements.forEach((el, i) => {
        const r = results[i];
        if (isIdent(el) && r?.name) s.vars.set(el.name, r);
      });
    }
  }

  /** `for (const basket of idle)`: the element holds what the list was read as holding. */
  private bindElement(s: Scope, stmt: ForEachStatement): void {
    if (stmt.type !== "ForOfStatement" || !isIdent(stmt.right) || !isVarDecl(stmt.left)) return;
    const held = s.vars.get(stmt.right.name);
    const decl = stmt.left.declarations[0];
    if (held && !held.items && decl && isIdent(decl.id)) s.vars.set(decl.id.name, held);
  }
}

function useCaseKeyFromFile(file: string): string | undefined {
  const m = /[\\/]application[\\/]([^\\/]+)[\\/]usecases[\\/]([^\\/]+)[\\/]usecase\.ts$/.exec(file);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** A block ends the path when its last statement returns or throws. */
function leaves(stmt: Node): boolean {
  const last = isBlock(stmt) ? stmt.body[stmt.body.length - 1] : stmt;
  return !!last && (isReturn(last) || isThrow(last));
}

function unmarkIfAllLeave(branches: AltBranch[]): AltBranch[] {
  if (branches.every((b) => b.terminal)) return branches.map((b) => ({ ...b, terminal: false }));
  return branches;
}

function unique(title: string, seen: Set<string>): string {
  let out = title;
  for (let n = 2; seen.has(out); n++) out = `${title} (${n})`;
  seen.add(out);
  return out;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "<" || c === "[" || c === "(") depth++;
    if (c === ">" || c === "]" || c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** A slug written the way a person would: one capital at the front. */
export function sentence(s: string): string {
  const words = s.split("-");
  if (!words[0]) return s;
  words[0] = words[0][0]!.toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

// `require` for the two places above that list a directory; the module is
// ESM, and this keeps the imports at the top to what the readers need.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export { dirname as _dirname };

/**
 * `ctx.<port>` where `ctx` is what this body's ports arrive on.
 *
 * The resolver's counterpart of `this.<port>`. Nothing else on the context is
 * a port, so a member that is not one is not found in the scope's map and the
 * call is not a hop, exactly as it works for a use case's fields.
 */
function selfMember(s: Scope, n: Node): string | undefined {
  return s.self && isMember(n) && isIdent(n.object) && n.object.name === s.self ? memberName(n) : undefined;
}

/** The bus, by where it sits: `infrastructure/bus` beside the peers, or `pkg/messaging` beside the rest of the plumbing. */
function isBusAdapter(file: string): boolean {
  return /[\\/](?:infrastructure[\\/]bus|pkg[\\/]messaging)[\\/]/.test(file);
}
