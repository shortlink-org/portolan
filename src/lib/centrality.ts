// Which services the estate's paths run through.
//
// The dependency graph shows who talks to whom; the context map shows which
// contexts depend on which. Neither answers a third question a reader asks
// before touching a service: if this one goes, what stops reaching what? A
// service with three neighbours can be the only road between two contexts,
// and a service with twelve can be a leaf of every one of them. Degree does
// not tell them apart. Betweenness does: the share of shortest paths between
// every pair of services that pass through this one.
//
// The graph is the same two facts the context map is drawn from - an event
// with a consumer, a call with a peer - collapsed to one undirected edge per
// pair of services. Undirected, because the question is "who is between",
// and a reader who asks it means the road, not which way the traffic runs.
// Unweighted, because a pair joined by one call and a pair joined by twenty
// are both joined.
//
// Two things are counted, and the page says which is which:
//
//   betweenness - Brandes' number, normalised so 1 means every shortest path
//                 between every other pair runs through this service. It ranks.
//   between     - the pairs of CONTEXTS for which at least half of the
//                 shortest paths between their services run through this one.
//                 It is the finding: "auth reaches payments only through cart".
//
// Consumers with no service of their own and calls to a peer the catalog does
// not know are left out. A ghost has no context to be between, and an
// unresolved peer is a problem the problems page already lists.

import type { Catalog } from "../catalog";

/** A pair of contexts this service stands between. */
export interface Brokered {
  /** The two contexts, in catalog order. */
  a: string;
  b: string;
  /** Share of shortest paths between the two that pass through the service. */
  share: number;
}

export interface Centrality {
  id: string;
  context: string;
  /** Distinct services it exchanges anything with. */
  degree: number;
  /** Normalised to 0..1; 0 on an estate of fewer than three services. */
  betweenness: number;
  between: Brokered[];
}

/**
 * The least share of a context pair's paths a service must carry to be said to
 * stand between them. Half: below it there is another road as good.
 */
export const BROKER_SHARE = 0.5;

export interface ServiceGraph {
  /** Service ids in catalog order. */
  nodes: string[];
  /** Service id -> context id. */
  context: Map<string, string>;
  /** Undirected adjacency, neighbours in first-seen order. */
  adjacent: Map<string, string[]>;
}

/** One undirected edge per pair of catalog services that exchange anything. */
export function serviceGraph(catalog: Catalog): ServiceGraph {
  const nodes: string[] = [];
  const context = new Map<string, string>();
  for (const ctx of catalog.contexts) {
    for (const service of ctx.services) {
      nodes.push(service.id);
      context.set(service.id, ctx.id);
    }
  }

  const adjacent = new Map<string, string[]>(nodes.map((id) => [id, []]));
  const join = (a: string, b: string): void => {
    if (a === b || !context.has(a) || !context.has(b)) return;
    const ofA = adjacent.get(a) as string[];
    if (ofA.includes(b)) return;
    ofA.push(b);
    (adjacent.get(b) as string[]).push(a);
  };

  for (const ctx of catalog.contexts) {
    for (const service of ctx.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) join(service.id, consumer.service);
        }
      }
      for (const call of service.consumes) join(service.id, call.peer);
    }
  }
  return { nodes, context, adjacent };
}

/**
 * Brandes' algorithm, with the dependency of each source split by the target's
 * context, so the same pass that sums betweenness also says which context
 * pairs a service carries.
 */
export function centrality(catalog: Catalog): Centrality[] {
  const graph = serviceGraph(catalog);
  const { nodes, context, adjacent } = graph;
  const n = nodes.length;
  const order = catalog.contexts.map((c) => c.id);
  const rank = new Map(order.map((id, i) => [id, i]));

  const raw = new Map<string, number>(nodes.map((id) => [id, 0]));
  // node -> (source context ~ target context) -> summed dependency.
  const carried = new Map<string, Map<string, number>>(
    nodes.map((id) => [id, new Map()]),
  );
  // source -> target context -> reachable targets (the source excluded).
  const reach = new Map<string, Map<string, number>>();

  for (const s of nodes) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>(nodes.map((id) => [id, []]));
    const sigma = new Map<string, number>(nodes.map((id) => [id, 0]));
    const dist = new Map<string, number>(nodes.map((id) => [id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head] as string;
      stack.push(v);
      const dv = dist.get(v) as number;
      for (const w of adjacent.get(v) as string[]) {
        if ((dist.get(w) as number) < 0) {
          dist.set(w, dv + 1);
          queue.push(w);
        }
        if ((dist.get(w) as number) === dv + 1) {
          sigma.set(w, (sigma.get(w) as number) + (sigma.get(v) as number));
          (pred.get(w) as string[]).push(v);
        }
      }
    }

    const seen = new Map<string, number>();
    for (const t of stack) {
      if (t === s) continue;
      const c = context.get(t) as string;
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    reach.set(s, seen);

    // delta[w][targetContext]: dependency of s on w, over targets in that context.
    const delta = new Map<string, Map<string, number>>(
      nodes.map((id) => [id, new Map()]),
    );
    while (stack.length > 0) {
      const w = stack.pop() as string;
      const dw = delta.get(w) as Map<string, number>;
      const own = context.get(w) as string;
      for (const v of pred.get(w) as string[]) {
        const ratio = (sigma.get(v) as number) / (sigma.get(w) as number);
        const dv = delta.get(v) as Map<string, number>;
        dv.set(own, (dv.get(own) ?? 0) + ratio);
        for (const [c, d] of dw) dv.set(c, (dv.get(c) ?? 0) + ratio * d);
      }
      if (w === s) continue;
      const from = context.get(s) as string;
      const bucket = carried.get(w) as Map<string, number>;
      let sum = 0;
      for (const [to, d] of dw) {
        sum += d;
        const key = pairKey(from, to, rank);
        bucket.set(key, (bucket.get(key) ?? 0) + d);
      }
      raw.set(w, (raw.get(w) as number) + sum);
    }
  }

  // Ordered (u, v) pairs with u in A and v in B, both reachable, any u and v.
  const pairs = (a: string, b: string): number => {
    let count = 0;
    for (const s of nodes) {
      if (context.get(s) !== a) continue;
      count += reach.get(s)?.get(b) ?? 0;
    }
    return count;
  };

  const scale = n < 3 ? 0 : 2 / ((n - 1) * (n - 2));
  return nodes.map((id) => {
    const own = context.get(id) as string;
    const between: Brokered[] = [];
    for (const [key, sum] of carried.get(id) as Map<string, number>) {
      const [a, b] = key.split("~") as [string, string];
      // Every (u, v) was counted from both ends; and pairs with the service
      // itself at an end are roads it is on, not roads it is between.
      let total = a === b ? pairs(a, a) / 2 : pairs(a, b);
      if (own === a) total -= reach.get(id)?.get(b) ?? 0;
      else if (own === b) total -= reach.get(id)?.get(a) ?? 0;
      const share = total > 0 ? sum / 2 / total : 0;
      if (a !== b && share >= BROKER_SHARE) between.push({ a, b, share });
    }
    between.sort(
      (x, y) =>
        y.share - x.share ||
        (rank.get(x.a) ?? 0) - (rank.get(y.a) ?? 0) ||
        (rank.get(x.b) ?? 0) - (rank.get(y.b) ?? 0),
    );
    return {
      id,
      context: own,
      degree: (adjacent.get(id) as string[]).length,
      betweenness: ((raw.get(id) as number) / 2) * scale,
      between,
    };
  });
}

function pairKey(a: string, b: string, rank: Map<string, number>): string {
  return (rank.get(a) ?? 0) <= (rank.get(b) ?? 0) ? `${a}~${b}` : `${b}~${a}`;
}

/**
 * The services worth a reader's attention: on some shortest path, and the
 * main road between at least one pair of contexts. Highest betweenness first,
 * catalog order between equals.
 */
export function bridges(catalog: Catalog): Centrality[] {
  return centrality(catalog)
    .filter((c) => c.betweenness > 0 && c.between.length > 0)
    .sort((x, y) => y.betweenness - x.betweenness);
}
