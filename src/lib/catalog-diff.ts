// What one catalog says that another does not.
//
// `gen:check` proves the documentation follows from the catalog. It says
// nothing about what a change DOES, and the diff it leaves a reviewer with is
// a hundred markdown pages - a shape no one reads and everyone approves. The
// reviewable statement is the other one: "shop.oms now publishes
// OrderCancelled, and nobody consumes it".
//
// So this compares two merged catalogs and answers with the changes as facts,
// not as text. A caller renders them - a command into markdown, a page into a
// panel - and the ordering is decided here, once, because "what did this
// break" is the same question wherever it is asked.
//
// Three rules hold the whole thing together:
//
//   - **Only what the estate declares.** A derived edge, a stamp, a generated
//     id: none of them are changes anybody made, and a diff full of them is a
//     diff nobody reads twice.
//   - **Identity is the id.** Everything the catalog holds is claimed by an
//     id, so an entity that appears under a new id is an addition and a
//     removal, never a rename. Guessing at renames turns one honest pair of
//     lines into one confident wrong one.
//   - **Deterministic.** Sorted by severity and then by id, so the same pair
//     of catalogs always produces the same report, and two reports can be
//     compared to each other.

// With the extension: scripts/diff.mjs runs this file under Node without a
// bundler, and Node resolves nothing it is not told. Same reason as enrich.ts.
import {
  allModules,
  allRepos,
  allServices,
  allStores,
  allTerms,
  ownersOf,
  walkSteps,
} from "../catalog.ts";
import type {
  Adr,
  Aggregate,
  Catalog,
  Event,
  Flow,
  RpcMethod,
  RpcService,
  Service,
  Status,
  Step,
} from "../catalog";

/**
 * How much a change asks of a reviewer.
 *
 * `breaking` is the one that earns the report: something the estate held is
 * gone, and whoever depended on it does not know yet. `addition` is new
 * surface - safe to land, worth reading. `change` is everything that stayed
 * and moved, where the pair of values IS the finding.
 */
export type Severity = "breaking" | "addition" | "change";

export const SEVERITIES: readonly Severity[] = [
  "breaking",
  "addition",
  "change",
];

export interface Change {
  /** A dotted kind, `event.removed`, so a caller can group or filter without parsing prose. */
  kind: string;
  severity: Severity;
  /** The catalog id this happened to, which is what a reader looks up. */
  where: string;
  /** One line, in the estate's own vocabulary. */
  summary: string;
}

/** What changed between `before` and `after`, most severe first. */
export function diffCatalogs(before: Catalog, after: Catalog): Change[] {
  const changes: Change[] = [];
  const add = (
    kind: string,
    severity: Severity,
    where: string,
    summary: string,
  ) => changes.push({ kind, severity, where, summary });

  diffContexts(before, after, add);
  diffServices(before, after, add);
  diffStores(before, after, add);
  diffModules(before, after, add);
  diffFlows(before, after, add);
  diffAdrs(before, after, add);
  diffTerms(before, after, add);
  diffRepos(before, after, add);

  return changes.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.where.localeCompare(b.where) ||
      a.kind.localeCompare(b.kind) ||
      a.summary.localeCompare(b.summary),
  );
}

type Add = (
  kind: string,
  severity: Severity,
  where: string,
  summary: string,
) => void;

/** Everything in `after` that `before` did not have, and the other way round. */
function partition<T>(
  before: Map<string, T>,
  after: Map<string, T>,
): { added: string[]; removed: string[]; kept: string[] } {
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const kept = [...after.keys()].filter((id) => before.has(id));

  return { added, removed, kept };
}

function byId<T>(items: T[], id: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [id(item), item]));
}

function diffContexts(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(before.contexts, (c) => c.id);
  const now = byId(after.contexts, (c) => c.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("context.added", "addition", id, `context "${id}" is new`);
  for (const id of removed) {
    add("context.removed", "breaking", id, `context "${id}" is gone`);
  }
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.classification !== b.classification) {
      add(
        "context.classification",
        "change",
        id,
        `context "${id}" is classified ${b.classification ?? "nothing"}, was ${a.classification ?? "nothing"}`,
      );
    }
  }
}

/** The context a service sits in, so a service moving between them is one change and not two. */
function contextOf(catalog: Catalog, serviceId: string): string {
  for (const context of catalog.contexts) {
    if (context.services.some((s) => s.id === serviceId)) return context.id;
  }

  return "";
}

function diffServices(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(allServices(before), (s) => s.id);
  const now = byId(allServices(after), (s) => s.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("service.added", "addition", id, `service "${id}" is new`);
  for (const id of removed) {
    add("service.removed", "breaking", id, `service "${id}" is gone`);
  }

  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;

    const from = contextOf(before, id);
    const to = contextOf(after, id);
    if (from !== to) {
      add("service.moved", "change", id, `service "${id}" moved from ${from} to ${to}`);
    }

    diffOwners(a, b, add);
    diffInterfaces(a, b, add);
    diffCalls(a, b, add);
    diffChannels(a, b, add);
    diffServiceStores(a, b, add);
    diffAggregates(a, b, add);
  }
}

function diffOwners(before: Service, after: Service, add: Add): void {
  const was = new Set(ownersOf(before));
  const now = new Set(ownersOf(after));

  for (const handle of now) {
    if (!was.has(handle)) {
      add("owner.added", "change", before.id, `${handle} now owns "${before.id}"`);
    }
  }
  for (const handle of was) {
    if (!now.has(handle)) {
      // Losing every owner is a different fact from handing one over, and the
      // first is the one nobody notices until they need somebody to ask.
      const severity: Severity = now.size === 0 ? "breaking" : "change";
      add("owner.removed", severity, before.id, `${handle} no longer owns "${before.id}"`);
    }
  }
}

/** The signature a caller is coupled to, as one string, so a change to any part of it is one finding. */
function signature(method: RpcMethod): string {
  const parts = [method.request ?? "?", method.response ?? "?"];
  if (method.streaming) parts.push(method.streaming);
  if (method.http) parts.push(`${method.http.method} ${method.http.path}`);

  return parts.join(" → ");
}

function diffInterfaces(before: Service, after: Service, add: Add): void {
  const was = byId(before.provides, (i) => i.id);
  const now = byId(after.provides, (i) => i.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) {
    add("interface.added", "addition", before.id, `"${before.id}" provides ${id}`);
  }
  for (const id of removed) {
    add("interface.removed", "breaking", before.id, `"${before.id}" no longer provides ${id}`);
  }
  for (const id of kept) diffMethods(before.id, was.get(id)!, now.get(id)!, add);
}

function diffMethods(
  serviceId: string,
  before: RpcService,
  after: RpcService,
  add: Add,
): void {
  const was = byId(before.methods, (m) => m.name);
  const now = byId(after.methods, (m) => m.name);
  const { added, removed, kept } = partition(was, now);

  for (const name of added) {
    add("method.added", "addition", serviceId, `${before.id} gained ${name}`);
  }
  for (const name of removed) {
    add("method.removed", "breaking", serviceId, `${before.id} lost ${name}`);
  }
  for (const name of kept) {
    const a = was.get(name)!;
    const b = now.get(name)!;
    if (signature(a) !== signature(b)) {
      add(
        "method.signature",
        "breaking",
        serviceId,
        `${before.id}/${name} is now ${signature(b)}, was ${signature(a)}`,
      );
    }
    if (!a.deprecated && b.deprecated) {
      add("method.deprecated", "change", serviceId, `${before.id}/${name} is deprecated`);
    }
  }
}

function diffCalls(before: Service, after: Service, add: Add): void {
  const was = byId(before.consumes, (c) => c.id);
  const now = byId(after.consumes, (c) => c.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) {
    add("call.added", "addition", before.id, `"${before.id}" now calls ${id}`);
  }
  for (const id of removed) {
    add("call.removed", "change", before.id, `"${before.id}" no longer calls ${id}`);
  }
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.status !== b.status) {
      add("call.status", statusSeverity(a.status, b.status), before.id, `"${before.id}" → ${id} is ${b.status}, was ${a.status}`);
    }
  }
}

function diffChannels(before: Service, after: Service, add: Add): void {
  const was = byId(before.channels ?? [], (c) => c.address);
  const now = byId(after.channels ?? [], (c) => c.address);
  const { added, removed } = partition(was, now);

  for (const address of added) {
    add("channel.added", "addition", before.id, `"${before.id}" declares channel ${address}`);
  }
  for (const address of removed) {
    add("channel.removed", "breaking", before.id, `"${before.id}" no longer declares channel ${address}`);
  }
}

function diffServiceStores(before: Service, after: Service, add: Add): void {
  const was = new Set(before.stores ?? []);
  const now = new Set(after.stores ?? []);

  for (const id of now) {
    if (!was.has(id)) add("service.store.added", "change", before.id, `"${before.id}" touches ${id}`);
  }
  for (const id of was) {
    if (!now.has(id)) add("service.store.removed", "change", before.id, `"${before.id}" no longer touches ${id}`);
  }
}

function diffAggregates(before: Service, after: Service, add: Add): void {
  const was = byId(before.aggregates, (a) => a.id);
  const now = byId(after.aggregates, (a) => a.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("aggregate.added", "addition", id, `aggregate "${id}" is new`);
  for (const id of removed) {
    add("aggregate.removed", "breaking", id, `aggregate "${id}" is gone`);
  }
  for (const id of kept) {
    diffEvents(was.get(id)!, now.get(id)!, add);
    diffLifecycle(was.get(id)!, now.get(id)!, add);
    diffOperations(was.get(id)!, now.get(id)!, add);
  }
}

function diffOperations(before: Aggregate, after: Aggregate, add: Add): void {
  const was = byId(before.operations, (o) => o.id);
  const now = byId(after.operations, (o) => o.id);
  const { added, removed } = partition(was, now);

  for (const id of added) add("operation.added", "addition", before.id, `${id} is new`);
  for (const id of removed) add("operation.removed", "breaking", before.id, `${id} is gone`);
}

function diffEvents(before: Aggregate, after: Aggregate, add: Add): void {
  const was = byId(before.events, (e) => e.id);
  const now = byId(after.events, (e) => e.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) {
    // The finding the whole report exists for: a new event nobody reads is a
    // publisher that thinks it told somebody.
    const consumers = now.get(id)!.consumers.length;
    add(
      "event.added",
      "addition",
      id,
      consumers === 0
        ? `${id} is published, and nothing consumes it`
        : `${id} is published, consumed by ${consumers}`,
    );
  }
  for (const id of removed) {
    const consumers = was.get(id)!.consumers.length;
    add(
      "event.removed",
      "breaking",
      id,
      consumers === 0
        ? `${id} is gone`
        : `${id} is gone, and ${consumers} consumed it`,
    );
  }
  for (const id of kept) diffConsumers(was.get(id)!, now.get(id)!, add);
}

function diffConsumers(before: Event, after: Event, add: Add): void {
  const was = byId(before.consumers, (c) => c.service);
  const now = byId(after.consumers, (c) => c.service);
  const { added, removed, kept } = partition(was, now);

  for (const service of added) {
    add("consumer.added", "addition", before.id, `${service} consumes ${before.id}`);
  }
  for (const service of removed) {
    add("consumer.removed", "change", before.id, `${service} no longer consumes ${before.id}`);
  }
  for (const service of kept) {
    const a = was.get(service)!;
    const b = now.get(service)!;
    if (a.status !== b.status) {
      add(
        "consumer.status",
        statusSeverity(a.status, b.status),
        before.id,
        `${service} consuming ${before.id} is ${b.status}, was ${a.status}`,
      );
    }
  }
}

/** A transition, as the pair of states and the command that makes it. */
function edgeOf(from: string, on: string, to: string): string {
  return `${from} --${on}--> ${to}`;
}

function diffLifecycle(before: Aggregate, after: Aggregate, add: Add): void {
  const was = before.lifecycle;
  const now = after.lifecycle;
  if (!was && !now) return;
  if (!was && now) {
    add("lifecycle.added", "addition", before.id, `"${before.id}" has a lifecycle`);

    return;
  }
  if (was && !now) {
    add("lifecycle.removed", "change", before.id, `"${before.id}" no longer declares a lifecycle`);

    return;
  }

  const states = { was: new Set(was!.states), now: new Set(now!.states) };
  for (const state of states.now) {
    if (!states.was.has(state)) {
      add("state.added", "addition", before.id, `"${before.id}" can now be ${state}`);
    }
  }
  for (const state of states.was) {
    if (!states.now.has(state)) {
      add("state.removed", "breaking", before.id, `"${before.id}" can no longer be ${state}`);
    }
  }

  const edges = {
    was: new Set(was!.transitions.map((t) => edgeOf(t.from, t.on, t.to))),
    now: new Set(now!.transitions.map((t) => edgeOf(t.from, t.on, t.to))),
  };
  for (const edge of edges.now) {
    if (!edges.was.has(edge)) {
      add("transition.added", "addition", before.id, `"${before.id}": ${edge}`);
    }
  }
  for (const edge of edges.was) {
    if (!edges.now.has(edge)) {
      add("transition.removed", "breaking", before.id, `"${before.id}" no longer: ${edge}`);
    }
  }
}

function diffStores(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(allStores(before), (s) => s.id);
  const now = byId(allStores(after), (s) => s.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("store.added", "addition", id, `store "${id}" is new`);
  for (const id of removed) add("store.removed", "breaking", id, `store "${id}" is gone`);
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.owner !== b.owner) {
      add("store.owner", "breaking", id, `store "${id}" is owned by ${b.owner}, was ${a.owner}`);
    }
    const tables = {
      was: new Set(a.tables.map((t) => t.name)),
      now: new Set(b.tables.map((t) => t.name)),
    };
    for (const name of tables.now) {
      if (!tables.was.has(name)) add("table.added", "addition", id, `${id}.${name} is new`);
    }
    for (const name of tables.was) {
      if (!tables.now.has(name)) add("table.removed", "breaking", id, `${id}.${name} is gone`);
    }
  }
}

function diffModules(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(allModules(before), (m) => m.id);
  const now = byId(allModules(after), (m) => m.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("module.added", "addition", id, `module "${id}" is new`);
  for (const id of removed) add("module.removed", "breaking", id, `module "${id}" is gone`);
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.commit !== b.commit) {
      add(
        "module.commit",
        "change",
        id,
        `module "${id}" is at ${short(b.commit)}, was ${short(a.commit)}`,
      );
    }
  }
}

function diffFlows(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(before.flows, (f) => f.id);
  const now = byId(after.flows, (f) => f.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("flow.added", "addition", id, `flow "${id}" is new`);
  for (const id of removed) add("flow.removed", "change", id, `flow "${id}" is gone`);
  for (const id of kept) diffSteps(was.get(id)!, now.get(id)!, add);
}

function diffSteps(before: Flow, after: Flow, add: Add): void {
  const was = byId(walkSteps(before.steps), (s) => s.id);
  const now = byId(walkSteps(after.steps), (s) => s.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) {
    add("step.added", "addition", before.id, `${before.slug} gained ${describe(now.get(id)!)}`);
  }
  for (const id of removed) {
    add("step.removed", "change", before.id, `${before.slug} lost ${describe(was.get(id)!)}`);
  }
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.status !== b.status) {
      // The regression the estate cares about: a hop a test used to pin and
      // no longer does is a claim that quietly went back to being a claim.
      add(
        "step.status",
        statusSeverity(a.status, b.status),
        before.id,
        `${before.slug} step ${id} is ${b.status}, was ${a.status}`,
      );
    }
  }
}

function describe(step: Step): string {
  return `${step.from} → ${step.to} ${step.label ?? step.ref ?? step.kind}`;
}

/**
 * Which way a status moved.
 *
 * `verified` is the strongest thing the estate can say about a hop, so falling
 * off it is a regression somebody should see, and climbing onto it is not a
 * change to review - it is the point of the work.
 */
function statusSeverity(before: Status, after: Status): Severity {
  const rank: Record<Status, number> = {
    verified: 2,
    declared: 1,
    unresolved: 0,
  };

  return rank[after] < rank[before] ? "breaking" : "change";
}

function diffAdrs(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(before.adrs, (a) => a.id);
  const now = byId(after.adrs, (a) => a.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) {
    add("adr.added", "addition", id, `${id} — ${now.get(id)!.title}`);
  }
  for (const id of removed) add("adr.removed", "change", id, `${id} is gone`);
  for (const id of kept) {
    const a = was.get(id)!;
    const b = now.get(id)!;
    if (a.status !== b.status) {
      add("adr.status", "change", id, `${id} is ${b.status}, was ${a.status}`);
    }
    if (a.supersededBy !== b.supersededBy && b.supersededBy) {
      add("adr.superseded", "change", id, `${id} is superseded by ${b.supersededBy}`);
    }
    if (settled(a) && a.body !== b.body) {
      // An accepted decision is a frozen document. Editing one is not the same
      // act as writing a new one, and the estate should be able to see it.
      add("adr.body", "change", id, `${id} was edited after being ${a.status}`);
    }
  }
}

function settled(adr: Adr): boolean {
  return adr.status === "accepted" || adr.status === "superseded";
}

function diffTerms(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(allTerms(before), (t) => t.id);
  const now = byId(allTerms(after), (t) => t.id);
  const { added, removed, kept } = partition(was, now);

  for (const id of added) add("term.added", "addition", id, `${id} is defined`);
  for (const id of removed) add("term.removed", "change", id, `${id} is no longer defined`);
  for (const id of kept) {
    if (was.get(id)!.definition !== now.get(id)!.definition) {
      add("term.definition", "change", id, `${id} means something else now`);
    }
  }
}

function diffRepos(before: Catalog, after: Catalog, add: Add): void {
  const was = byId(allRepos(before), (r) => r.repo);
  const now = byId(allRepos(after), (r) => r.repo);
  const { added, removed, kept } = partition(was, now);

  for (const repo of added) {
    add("repo.added", "addition", repo, `${repo} is vendored at ${short(now.get(repo)!.commit)}`);
  }
  for (const repo of removed) add("repo.removed", "change", repo, `${repo} is no longer vendored`);
  for (const repo of kept) {
    const a = was.get(repo)!.commit;
    const b = now.get(repo)!.commit;
    if (a !== b) {
      add("repo.commit", "change", repo, `${repo} moved from ${short(a)} to ${short(b)}`);
    }
  }
}

function short(commit: string | undefined): string {
  return commit ? commit.slice(0, 7) : "nothing";
}
