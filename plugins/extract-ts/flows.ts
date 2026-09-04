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

import type * as TSNS from "ts-api";
import { dirname, join } from "node:path";
import type { Alt, AltBranch, Flow, FlowNode, Participant, RpcCall, Status, Step } from "../../src/catalog.ts";
import { adapterCalls, callsIn, type RpcHop } from "./clients.ts";
import { camel, eventID, slug } from "./ids.ts";
import { readSource, ts, at, bareType, type ClassInfo, type Source } from "./source.ts";
import type { UseCase } from "./operations.ts";
import type { Binding } from "./wiring.ts";
import type { AggregateRead, Diagnostics } from "./domain.ts";
import type { Endpoint } from "./transport.ts";

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
  readonly bindings: Map<string, Binding>;
  readonly aggregates: AggregateRead[];
  readonly rel: (abs: string) => string;
  readonly b: Diagnostics;

  constructor(opts: FlowOptions, useCases: Map<string, UseCase>, bindings: Map<string, Binding>, aggregates: AggregateRead[], rel: (abs: string) => string, b: Diagnostics) {
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
        if (!cls.exported || !handle?.node.body) continue;
        const trigger = this.assertedEvent(src, handle.node);
        if (!trigger) {
          this.b.warn(cls.name, `${this.rel(src.path)}: ${cls.name}.handle tests for no event; the policy is not paired with what triggers it`);
          continue;
        }
        const d = new Draft();
        d.lane(this.busLane());
        d.lane(this.serviceLane());
        const line = at(src.sf, handle.node, this.rel);
        if (trigger.foreign) {
          this.b.warn(cls.name, `${this.rel(src.path)}: ${cls.name}.handle reacts to ${trigger.name} from ${trigger.foreign}, an event this repository does not declare and the manifest's \`events\` does not place; the step is unresolved`);
          d.add({ from: LANE_BUS, to: this.opts.svcID, kind: "event", label: trigger.name, status: "unresolved", note: `Reacts to \`${trigger.name}\` from \`${trigger.foreign}\`, which is not an event this repository declares.`, line });
        } else {
          d.add({ from: LANE_BUS, to: this.opts.svcID, kind: "event", label: trigger.name, ref: trigger.id, line });
          this.referenced.add(trigger.id!);
        }
        this.walkBody(d, { src, key: `policy/${cls.name}`, cls, ports: new Map(cls.params.map((p) => [p.name, p.type])), vars: new Map([[handle.node.parameters[0]?.name.getText() ?? "event", { name: trigger.name, event: trigger.id }]]) }, handle.node, 0);
        const id = `${this.opts.service}-${slug(cls.name)}`;
        out.push({ id: `flow.${id}`, slug: id, name: sentence(slug(cls.name)), summary: cls.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "", source: this.rel(src.path), owner: this.opts.context, participants: d.lanes, steps: d.steps });
      }
    }
    return out;
  }

  /** `event instanceof X`, `event.name === "…"`, or `switch (event.name) { case "…" }`. */
  private assertedEvent(src: Source, fn: TSNS.MethodDeclaration): { name: string; id?: string; foreign?: string } | undefined {
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
    const visit = (node: TSNS.Node): void => {
      if (found) return;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && ts.isIdentifier(node.right)) {
        found = byClass(node.right.text);
        return;
      }
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
        const lit = [node.left, node.right].find((e) => ts.isStringLiteral(e)) as TSNS.StringLiteral | undefined;
        if (lit) {
          found = byName(lit.text);
          return;
        }
      }
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
        found = byName(node.expression.text);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
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
    this.walkBody(d, { src: uc.source, key, cls: uc.cls, ports: new Map(uc.cls.params.map((p) => [p.name, p.type])), vars: new Map() }, handle.node, depth);
  }

  private walkBody(d: Draft, s: Scope, fn: TSNS.MethodDeclaration, depth: number): void {
    if (!fn.body) return;
    this.walkStmts(d, s, fn.body.statements, depth);
  }

  private walkStmts(d: Draft, s: Scope, list: readonly TSNS.Statement[], depth: number): void {
    for (const stmt of list) this.walkStmt(d, s, stmt, depth);
  }

  private walkStmt(d: Draft, s: Scope, stmt: TSNS.Statement, depth: number): void {
    if (ts.isIfStatement(stmt)) return this.walkIf(d, s, stmt, depth);
    if (ts.isSwitchStatement(stmt)) return this.walkSwitch(d, s, stmt, depth);
    if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
      this.callsIn(d, s, stmt.expression, depth);
      this.bindElement(s, stmt);
      d.enter(`inside a loop over \`${stmt.expression.getText()}\``);
      this.walkBlock(d, s, stmt.statement, depth);
      d.leave();
      return;
    }
    if (ts.isForStatement(stmt) || ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) {
      const cond = ts.isForStatement(stmt) ? stmt.condition : stmt.expression;
      if (ts.isForStatement(stmt) && stmt.initializer) this.callsIn(d, s, stmt.initializer, depth);
      d.enter(cond ? `inside a loop, while \`${cond.getText()}\`` : "inside a loop");
      this.walkBlock(d, s, stmt.statement, depth);
      d.leave();
      return;
    }
    if (ts.isBlock(stmt)) return this.walkStmts(d, s, stmt.statements, depth);
    if (ts.isTryStatement(stmt)) {
      this.walkStmts(d, s, stmt.tryBlock.statements, depth);
      if (stmt.catchClause) this.walkStmts(d, s, stmt.catchClause.block.statements, depth);
      if (stmt.finallyBlock) this.walkStmts(d, s, stmt.finallyBlock.statements, depth);
      return;
    }
    this.callsIn(d, s, stmt, depth);
  }

  private walkBlock(d: Draft, s: Scope, stmt: TSNS.Statement, depth: number): void {
    if (ts.isBlock(stmt)) this.walkStmts(d, s, stmt.statements, depth);
    else this.walkStmt(d, s, stmt, depth);
  }

  private walkIf(d: Draft, s: Scope, stmt: TSNS.IfStatement, depth: number): void {
    const branches: AltBranch[] = [];
    const titles = new Set<string>();
    let drew = false;
    let current: TSNS.IfStatement | undefined = stmt;
    while (current) {
      this.callsIn(d, s, current.expression, depth);
      d.push();
      this.walkBlock(d, s, current.thenStatement, depth);
      const steps = d.pop();
      drew ||= steps.length > 0;
      branches.push({ title: unique(current.expression.getText(), titles), steps, terminal: leaves(current.thenStatement) });
      const els: TSNS.Statement | undefined = current.elseStatement;
      if (!els) {
        branches.push({ title: unique("otherwise", titles), steps: [] });
        break;
      }
      if (ts.isIfStatement(els)) {
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

  private walkSwitch(d: Draft, s: Scope, stmt: TSNS.SwitchStatement, depth: number): void {
    this.callsIn(d, s, stmt.expression, depth);
    const subject = stmt.expression.getText();
    const branches: AltBranch[] = [];
    const titles = new Set<string>();
    let drew = false;
    let sawDefault = false;
    for (const clause of stmt.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) this.callsIn(d, s, clause.expression, depth);
      d.push();
      this.walkStmts(d, s, clause.statements, depth);
      const steps = d.pop();
      drew ||= steps.length > 0;
      const title = ts.isCaseClause(clause) ? `${subject} is ${clause.expression.getText()}` : "otherwise";
      if (!ts.isCaseClause(clause)) sawDefault = true;
      const last = clause.statements[clause.statements.length - 1];
      branches.push({ title: unique(title, titles), steps, terminal: last ? leaves(last) : false });
    }
    if (!drew) return;
    if (!sawDefault) branches.push({ title: unique("otherwise", titles), steps: [] });
    d.addAlt(unmarkIfAllLeave(branches));
  }

  /** Every call under a node, in source order. */
  private callsIn(d: Draft, s: Scope, node: TSNS.Node, depth: number): void {
    const assigned = new Map<TSNS.CallExpression, TSNS.BindingName>();
    const collect = (n: TSNS.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const call = unwrapAwait(n.initializer);
        if (call && ts.isCallExpression(call)) assigned.set(call, n.name);
      }
      ts.forEachChild(n, collect);
    };
    collect(node);
    const visit = (n: TSNS.Node): void => {
      if (ts.isCallExpression(n)) this.call(d, s, n, assigned.get(n), depth);
      ts.forEachChild(n, visit);
    };
    visit(node);
  }

  private call(d: Draft, s: Scope, call: TSNS.CallExpression, lhs: TSNS.BindingName | undefined, depth: number): void {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) {
      // A bare function: a domain constructor imported from the aggregate, `createBasket(...)`.
      if (ts.isIdentifier(callee)) this.bind(s, lhs, this.resultsOfFunction(s, callee.text));
      return;
    }
    const method = callee.name.text;
    const target = callee.expression;

    // this.<port>.<method>(...) — a hop.
    if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const port = target.name.text;
      const declared = s.ports.get(port);
      if (declared !== undefined) this.portCall(d, s, port, declared, method, call, lhs, depth);
      return;
    }
    // this.<helper>(...) — the same use case, another method.
    if (target.kind === ts.SyntaxKind.ThisKeyword) {
      const helper = s.cls.methods.get(method);
      if (helper?.node.body) this.walkStmts(d, s, helper.node.body.statements, depth);
      return;
    }
    // Basket.create(...) — a static domain constructor; basket.addItem(...) — a method on something the domain handed over.
    if (ts.isIdentifier(target)) {
      const held = s.vars.get(target.text);
      if (held?.aggregate) {
        this.bind(s, lhs, this.resultsOfMethod(held, method));
        return;
      }
      this.bind(s, lhs, this.resultsOfStatic(s, target.text, method));
    }
  }

  private portCall(d: Draft, s: Scope, port: string, declared: string, method: string, call: TSNS.CallExpression, lhs: TSNS.BindingName | undefined, depth: number): void {
    if (/^\(.*\)\s*=>/.test(declared) || declared === "") return; // a clock, an id generator

    const src = s.src;
    const line = at(src.sf, call, this.rel);
    const bare = bareType(declared);

    // A port bound in assembly to another use case, or to an adapter over a client.
    const binding = this.bindings.get(`${s.key}.${bare}`);
    if (binding?.useCase) {
      this.useCaseHop(d, binding.useCase, `Port \`${bare}\`, bound at assembly to the ${camel(binding.useCase.split("/")[1] ?? "")} use case.`, line, depth);
      return;
    }
    if (binding?.adapter) {
      const adapterSrc = readSource(binding.adapter.file);
      if (adapterSrc) {
        const hops = adapterCalls(adapterSrc, binding.adapter.cls, method, this.rel, this.b);
        if (hops.length === 0) this.b.warn(s.key, `port \`${bare}\` is adapted by ${binding.adapter.cls}.${method}, which calls no peer; the call is left out of the flow`);
        for (const hop of hops) this.rpcHop(d, hop, line);
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
    for (const arg of call.arguments) {
      const inner = ts.isSpreadElement(arg) ? arg.expression : arg;
      if (!ts.isIdentifier(inner)) continue;
      const held = s.vars.get(inner.text);
      if (held?.event) {
        d.add({ from: this.opts.svcID, to: d.lane(this.busLane()), kind: "event", ref: held.event, label: held.name, line });
        this.referenced.add(held.event);
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
    if (!iface) return [];
    for (const m of iface.members) {
      if ((ts.isMethodSignature(m) || ts.isPropertySignature(m)) && m.name.getText() === method) {
        const type = ts.isMethodSignature(m) ? m.type : ts.isPropertySignature(m) && m.type && ts.isFunctionTypeNode(m.type) ? m.type.type : undefined;
        return this.refsOfType(agg, type ? type.getText() : "");
      }
    }
    return [];
  }

  private resultsOfFunction(s: Scope, name: string): DomainRef[] {
    const imp = s.src.imports.find((i) => i.local === name);
    if (!imp?.file) return [];
    const agg = this.aggregates.find((a) => imp.file!.startsWith(a.dir));
    const fnSrc = readSource(imp.file);
    const fn = fnSrc?.functions.get(imp.imported);
    if (!agg || !fn) return [];
    return this.refsOfType(agg, fn.type?.getText() ?? "");
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

  private bind(s: Scope, lhs: TSNS.BindingName | undefined, results: DomainRef[]): void {
    if (!lhs) return;
    if (ts.isIdentifier(lhs)) {
      const r = results[0];
      if (r?.name) s.vars.set(lhs.text, r);
      return;
    }
    if (ts.isArrayBindingPattern(lhs)) {
      lhs.elements.forEach((el, i) => {
        const r = results[i];
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && r?.name) s.vars.set(el.name.text, r);
      });
    }
  }

  /** `for (const item of basket.items)`: nothing to say yet; a later reading may follow the element. */
  private bindElement(_s: Scope, _stmt: TSNS.ForOfStatement | TSNS.ForInStatement): void {}
}

function useCaseKeyFromFile(file: string): string | undefined {
  const m = /[\\/]application[\\/]([^\\/]+)[\\/]usecases[\\/]([^\\/]+)[\\/]usecase\.ts$/.exec(file);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

function unwrapAwait(e: TSNS.Expression): TSNS.Expression {
  let x = e;
  while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x;
}

/** A block ends the path when its last statement returns or throws. */
function leaves(stmt: TSNS.Statement): boolean {
  const last = ts.isBlock(stmt) ? stmt.statements[stmt.statements.length - 1] : stmt;
  return !!last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
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
