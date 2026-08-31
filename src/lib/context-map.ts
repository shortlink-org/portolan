// The context map, derived.
//
// A bounded context in this catalog states no relationships to its neighbours
// (see BoundedContext in catalog.ts): who talks to whom is already written in
// the events and the calls, and asking an estate to also declare it is asking
// it to keep a second copy that will disagree with the first. So the map is
// computed here, from the same two facts the dependency graph is drawn from -
// an event with a consumer, and a call with a peer - plus a third the graph
// throws away: which shared types the two sides both name.
//
// What can be COUNTED and what can only be READ are kept apart, and the page
// says which is which.
//
//   counted - follows from the graph and cannot be otherwise. If the arrows
//             run both ways the two contexts are partners; if they run one
//             way one is the supplier and the other the customer; if the same
//             type definition is named by shapes on both sides there is a
//             kernel between them, whether or not anyone meant there to be.
//
//   read    - the shapes hint at it and nothing states it. A downstream that
//             names the upstream's types in its own model has conformed to
//             that model; one that names none of them is translating at the
//             boundary, which is what an anticorruption layer is for. Both
//             are readings of an absence or a presence, not declarations, and
//             the map must never print them as if the estate had said so.
//
// Nothing here invents a relationship. Two contexts that neither depend on
// each other nor share a type go their separate ways, and that is a finding.

import type { Catalog, Status } from "../catalog";

/** One measured dependency: something the downstream takes from the upstream. */
export interface MapLink {
  kind: "event" | "rpc";
  /** Event id, or rpc call id. */
  id: string;
  /** What to print - the event name, or the method. */
  label: string;
  /** The service on the upstream side: it publishes the event, answers the call. */
  from: string;
  /** The service on the downstream side: it consumes, it calls. */
  to: string;
  status: Status;
}

/** Everything one context takes from another, in one direction. */
export interface ContextDependency {
  /** Depended ON - its events are consumed, its rpc answered. */
  upstream: string;
  /** Depends - it consumes, it calls. */
  downstream: string;
  links: MapLink[];
}

/** A type definition named by shapes owned on both sides of a relationship. */
export interface SharedKernel {
  /** Key into `catalog.defs`. */
  def: string;
  /** Block ids on each side that name it, keyed by context. */
  blocks: Record<string, string[]>;
}

export type PatternName =
  | "partnership"
  | "customer-supplier"
  | "shared-kernel"
  | "conformist"
  | "anticorruption-layer"
  | "separate-ways";

export interface MapPattern {
  name: PatternName;
  /**
   * `counted` follows from the graph. `read` is a reading of what the shapes
   * name, and is drawn as such - it is a question worth asking of the team,
   * not an answer the catalog gave.
   */
  basis: "counted" | "read";
  /** Why this pattern, in one line, naming the numbers it was read from. */
  why: string;
  /** Set on the directional patterns; absent on the symmetric ones. */
  upstream?: string;
  downstream?: string;
}

/** One pair of contexts, and everything the catalog says stands between them. */
export interface ContextRelation {
  /** The two contexts, in catalog order, so a pair has exactly one identity. */
  a: string;
  b: string;
  /** `${a}~${b}`. */
  id: string;
  /** At most two - one per direction that carries anything. */
  dependencies: ContextDependency[];
  shared: SharedKernel[];
  patterns: MapPattern[];
}

// ---------------------------------------------------------------------------
// What each context owns and names
// ---------------------------------------------------------------------------

interface ContextFacts {
  /** Defs named by the value objects and entities this context owns. */
  modelDefs: Map<string, string[]>;
  /** Defs carried by the events this context publishes. */
  eventDefs: Set<string>;
}

function factsFor(catalog: Catalog): Map<string, ContextFacts> {
  const out = new Map<string, ContextFacts>();
  for (const context of catalog.contexts) {
    const modelDefs = new Map<string, string[]>();
    const eventDefs = new Set<string>();
    const note = (def: string, blockId: string): void => {
      const list = modelDefs.get(def) ?? [];
      if (!list.includes(blockId)) list.push(blockId);
      modelDefs.set(def, list);
    };

    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const block of [
          ...aggregate.valueObjects,
          ...aggregate.entities,
        ]) {
          if (block.ref) note(block.ref, block.id);
          for (const field of block.fields ?? []) {
            if (field.ref) note(field.ref, block.id);
          }
        }
        for (const event of aggregate.events) {
          for (const version of event.versions) {
            for (const field of version.fields) {
              if (field.ref) eventDefs.add(field.ref);
            }
          }
        }
      }
    }
    out.set(context.id, { modelDefs, eventDefs });
  }
  return out;
}

/** Service id -> context id, for both ends of every edge. */
function serviceContexts(catalog: Catalog): Map<string, string> {
  const out = new Map<string, string>();
  for (const context of catalog.contexts) {
    for (const service of context.services) out.set(service.id, context.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

const pairId = (a: string, b: string): string => `${a}~${b}`;

/**
 * Every pair of contexts the catalog has anything to say about, plus the pairs
 * it has nothing to say about - which is the finding "separate ways", and the
 * only way a map can show that two domains were never wired together.
 */
export function contextMap(catalog: Catalog): ContextRelation[] {
  const order = catalog.contexts.map((c) => c.id);
  const rank = new Map(order.map((id, i) => [id, i]));
  const owner = serviceContexts(catalog);
  const facts = factsFor(catalog);

  /** upstream -> downstream -> the links that run that way. */
  const byDirection = new Map<string, MapLink[]>();
  const addLink = (up: string, down: string, link: MapLink): void => {
    const key = pairId(up, down);
    const list = byDirection.get(key) ?? [];
    list.push(link);
    byDirection.set(key, list);
  };

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      // An event crossing a context boundary makes its publisher upstream.
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            const down = owner.get(consumer.service);
            // A consumer outside the catalog is a Problem, not a relationship:
            // there is no second context for the line to reach.
            if (!down || down === context.id) continue;
            addLink(context.id, down, {
              kind: "event",
              id: event.id,
              label: event.name,
              from: service.id,
              to: consumer.service,
              status: consumer.status,
            });
          }
        }
      }

      // A call crossing a boundary makes the ANSWERING context upstream: the
      // caller is the one who has to live with the other's model.
      for (const call of service.consumes) {
        const up = owner.get(call.peer);
        if (!up || up === context.id) continue;
        addLink(up, context.id, {
          kind: "rpc",
          id: call.id,
          label: call.id,
          from: call.peer,
          to: service.id,
          status: call.status,
        });
      }
    }
  }

  const relations: ContextRelation[] = [];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      const a = order[i] as string;
      const b = order[j] as string;

      const dependencies: ContextDependency[] = [];
      const aUp = byDirection.get(pairId(a, b));
      const bUp = byDirection.get(pairId(b, a));
      if (aUp?.length) {
        dependencies.push({ upstream: a, downstream: b, links: aUp });
      }
      if (bUp?.length) {
        dependencies.push({ upstream: b, downstream: a, links: bUp });
      }

      const shared = sharedKernel(facts, a, b);
      relations.push({
        a,
        b,
        id: pairId(a, b),
        dependencies,
        shared,
        patterns: patternsFor(facts, dependencies, shared),
      });
    }
  }

  // Loudest first: a pair that is wired together says more than one that is
  // not, and the pairs that say nothing sink to the bottom where they read as
  // the list of domains nobody has connected.
  return relations.sort(
    (x, y) =>
      weight(y) - weight(x) ||
      (rank.get(x.a) ?? 0) - (rank.get(y.a) ?? 0) ||
      (rank.get(x.b) ?? 0) - (rank.get(y.b) ?? 0),
  );
}

function weight(relation: ContextRelation): number {
  return (
    relation.dependencies.reduce((n, d) => n + d.links.length, 0) +
    relation.shared.length
  );
}

/** Types both contexts name in shapes of their own. */
function sharedKernel(
  facts: Map<string, ContextFacts>,
  a: string,
  b: string,
): SharedKernel[] {
  const left = facts.get(a)?.modelDefs;
  const right = facts.get(b)?.modelDefs;
  if (!left || !right) return [];
  const out: SharedKernel[] = [];
  for (const [def, blocks] of left) {
    const other = right.get(def);
    if (!other) continue;
    out.push({ def, blocks: { [a]: blocks, [b]: other } });
  }
  return out.sort((x, y) => x.def.localeCompare(y.def));
}

/**
 * The patterns, in the order a reader wants them: what the two contexts ARE to
 * each other first, then what is shared, then how the downstream is holding
 * the upstream's model.
 */
function patternsFor(
  facts: Map<string, ContextFacts>,
  dependencies: ContextDependency[],
  shared: SharedKernel[],
): MapPattern[] {
  const out: MapPattern[] = [];

  if (dependencies.length === 0 && shared.length === 0) {
    return [
      {
        name: "separate-ways",
        basis: "counted",
        why: "no event, no call and no shared type joins these two domains",
      },
    ];
  }

  if (dependencies.length === 2) {
    out.push({
      name: "partnership",
      basis: "counted",
      why: `each depends on the other — ${describe(dependencies[0])} and ${describe(dependencies[1])}`,
    });
  } else if (dependencies.length === 1) {
    const only = dependencies[0] as ContextDependency;
    out.push({
      name: "customer-supplier",
      basis: "counted",
      why: `${only.downstream} depends on ${only.upstream} and not the other way — ${describe(only)}`,
      upstream: only.upstream,
      downstream: only.downstream,
    });
  }

  if (shared.length > 0) {
    out.push({
      name: "shared-kernel",
      basis: "counted",
      why: `${shared.length === 1 ? "one type is" : `${shared.length} types are`} named by shapes both domains own: ${shared.map((s) => s.def).join(", ")}`,
    });
  }

  // How the downstream holds the upstream's model. Read per direction, and
  // only where there is a dependency to read it from: with no arrow between
  // them there is no model to conform to or translate.
  for (const dependency of dependencies) {
    const carried = facts.get(dependency.upstream)?.eventDefs;
    const named = facts.get(dependency.downstream)?.modelDefs;
    if (!carried || !named || carried.size === 0) continue;
    const adopted = [...carried].filter((def) => named.has(def)).sort();

    out.push(
      adopted.length > 0
        ? {
            name: "conformist",
            basis: "read",
            why: `${dependency.downstream} names ${adopted.join(", ")} in its own model — the same ${adopted.length === 1 ? "type" : "types"} ${dependency.upstream} puts on the wire`,
            upstream: dependency.upstream,
            downstream: dependency.downstream,
          }
        : {
            name: "anticorruption-layer",
            basis: "read",
            why: `${dependency.downstream} names none of the ${carried.size === 1 ? "one type" : `${carried.size} types`} ${dependency.upstream} puts on the wire — something translates at the boundary`,
            upstream: dependency.upstream,
            downstream: dependency.downstream,
          },
    );
  }

  return out;
}

function describe(dependency: ContextDependency | undefined): string {
  if (!dependency) return "";
  const events = dependency.links.filter((l) => l.kind === "event").length;
  const calls = dependency.links.length - events;
  const parts: string[] = [];
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (calls > 0) parts.push(`${calls} ${calls === 1 ? "call" : "calls"}`);
  return `${dependency.downstream} takes ${parts.join(" and ")} from ${dependency.upstream}`;
}

// ---------------------------------------------------------------------------
// What the page prints
// ---------------------------------------------------------------------------

export const PATTERN_LABEL: Record<PatternName, string> = {
  partnership: "partnership",
  "customer-supplier": "customer / supplier",
  "shared-kernel": "shared kernel",
  conformist: "conformist",
  "anticorruption-layer": "anticorruption layer",
  "separate-ways": "separate ways",
};

/** What the pattern means, for the reader who has not read Evans this month. */
export const PATTERN_MEANING: Record<PatternName, string> = {
  partnership:
    "Neither can move without the other. A change on either side is a change to both.",
  "customer-supplier":
    "One side is upstream: it can change and the other has to follow. Whose schedule wins is the question this raises.",
  "shared-kernel":
    "A piece of model both domains own. It cannot be changed by one of them alone.",
  conformist:
    "The downstream has taken the upstream's model as its own, translating nothing.",
  "anticorruption-layer":
    "The downstream keeps its own model and translates at the boundary.",
  "separate-ways":
    "Nothing joins them. Integrating them later is a decision nobody has taken yet.",
};
