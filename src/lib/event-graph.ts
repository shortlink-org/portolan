// The dependency graph's model: services AND events are nodes.
//
// The old shape drew one labelled arrow per (event, consumer) pair, so an
// event with four consumers was four lines carrying the same word four times.
// The word was the densest thing on the canvas and it was also the most
// duplicated. Promoting the event to a node fixes both at once: it is written
// once, it is a thing a reader can click, and every line around it can then be
// bare - the node IS the label.
//
// Two derivations live here. `eventGraph` is the bipartite one; `bundles`
// collapses it back to services only, one edge per ordered pair with a count.
// Both are pure, so the acceptance criteria are assertions rather than
// eyeballing.

import type { Catalog, Status } from "../catalog";

/** Worst wins: a bundle is known no better than its least-known event. */
export function worstStatus(statuses: readonly Status[]): Status {
  if (statuses.includes("unresolved")) return "unresolved";
  if (statuses.includes("declared")) return "declared";
  return "verified";
}

export interface GraphService {
  id: string;
  label: string;
  context: string | null;
  /** named as a consumer but absent from the catalog */
  ghost: boolean;
  /** events it publishes */
  publishes: number;
  /** distinct events it consumes, its own included */
  consumes: number;
}

export interface EventConsumer {
  service: string;
  status: Status;
  /**
   * The consumer is the publisher. It is held here rather than dropped so the
   * status filter treats it like any other consumption; the canvas renders it
   * as a chip on the pill, never as a loop edge.
   */
  self: boolean;
}

export interface GraphEvent {
  id: string;
  name: string;
  /** service id; the pill is tinted by this service's context */
  publisher: string;
  context: string | null;
  consumers: EventConsumer[];
}

export interface EventGraph {
  services: GraphService[];
  events: GraphEvent[];
}

/** Services in catalog order, events grouped by publisher in the same order. */
export function eventGraph(catalog: Catalog): EventGraph {
  const services = new Map<string, GraphService>();
  const events: GraphEvent[] = [];

  const blank = (id: string, context: string | null, ghost: boolean) => ({
    id,
    label: id,
    context,
    ghost,
    publishes: 0,
    consumes: 0,
  });

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      services.set(service.id, blank(service.id, context.id, false));
    }
  }

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const consumers: EventConsumer[] = event.consumers.map((c) => ({
            service: c.service,
            status: c.status,
            self: c.service === service.id,
          }));
          for (const consumer of consumers) {
            // A consumer with no service of its own is still a real
            // dependency. Drawing it as a ghost keeps the gap visible instead
            // of hiding it.
            if (!services.has(consumer.service)) {
              services.set(consumer.service, blank(consumer.service, null, true));
            }
          }
          events.push({
            id: event.id,
            name: event.name,
            publisher: service.id,
            context: context.id,
            consumers,
          });
        }
      }
    }
  }

  return { services: [...services.values()], events: counted(events, services) };
}

/** Fills in each service's two footer numbers from the events around it. */
function counted(
  events: GraphEvent[],
  services: Map<string, GraphService>,
): GraphEvent[] {
  for (const event of events) {
    const publisher = services.get(event.publisher);
    if (publisher) publisher.publishes += 1;
    // Distinct, because one event consumed twice by the same service is still
    // one thing that service listens to.
    const seen = new Set<string>();
    for (const consumer of event.consumers) {
      if (seen.has(consumer.service)) continue;
      seen.add(consumer.service);
      const service = services.get(consumer.service);
      if (service) service.consumes += 1;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface GraphFilter {
  /** Active context chips. Empty means every context. */
  contexts: ReadonlySet<string>;
  /** Active status chips. Empty means every status. */
  statuses: ReadonlySet<Status>;
}

export const NO_FILTER: GraphFilter = {
  contexts: new Set(),
  statuses: new Set(),
};

/**
 * How many lines the canvas would draw for a graph: one per event that has a
 * publisher to hang off, plus one per consumption that is not the publisher
 * listening to itself.
 *
 * The header subtracts a filtered count from an unfiltered one to say how many
 * edges a chip is hiding, so "edge" has to mean exactly one drawn line.
 */
export function edgeCount(graph: EventGraph): number {
  const present = new Set(graph.services.map((s) => s.id));
  let n = 0;
  for (const event of graph.events) {
    if (present.has(event.publisher)) n += 1;
    for (const consumer of event.consumers) {
      if (!consumer.self && present.has(consumer.service)) n += 1;
    }
  }
  return n;
}

/**
 * The graph a set of chips leaves standing.
 *
 * Contexts filter SERVICES, and only services. An event survives if either end
 * of it does, so filtering to one context still shows what that context emits
 * into the dark and what reaches it from outside - the pill keeps its
 * publisher's colour, which is what says the traffic comes from somewhere no
 * longer on screen.
 *
 * Statuses filter CONSUMPTIONS, and only consumptions. An event that had
 * consumers and has none left is hidden: an empty pill under a "verified only"
 * filter would read as an event nobody consumes, which is a different fact and
 * a false one. An event that never had consumers is not hidden by a status
 * filter, because it never held a status to disagree with.
 *
 * A ghost is neither: it has no context to be filtered by and exists only
 * because an event named it, so it lives and dies with the events that do.
 */
export function filterEventGraph(
  graph: EventGraph,
  filter: GraphFilter,
): EventGraph {
  const byContext = filter.contexts.size > 0;
  const byStatus = filter.statuses.size > 0;
  if (!byContext && !byStatus) return graph;

  const ghosts = new Set(
    graph.services.filter((s) => s.ghost).map((s) => s.id),
  );
  const kept = new Set(
    graph.services
      .filter(
        (s) =>
          !s.ghost &&
          (!byContext ||
            (s.context !== null && filter.contexts.has(s.context))),
      )
      .map((s) => s.id),
  );

  const passes = (c: EventConsumer): boolean =>
    !byStatus || filter.statuses.has(c.status);

  const events: GraphEvent[] = [];
  const liveGhosts = new Set<string>();
  for (const event of graph.events) {
    const consumers = event.consumers.filter(passes);
    if (byStatus && event.consumers.length > 0 && consumers.length === 0) {
      continue;
    }
    // Only a real service can justify an event: a ghost is the far end of a
    // dependency, never a reason to draw one.
    const anchored =
      kept.has(event.publisher) ||
      consumers.some((c) => kept.has(c.service));
    if (!anchored) continue;

    const surviving = consumers.filter(
      (c) => kept.has(c.service) || ghosts.has(c.service),
    );
    for (const consumer of surviving) {
      if (ghosts.has(consumer.service)) liveGhosts.add(consumer.service);
    }
    events.push({ ...event, consumers: surviving });
  }

  return {
    services: graph.services.filter(
      (s) => kept.has(s.id) || liveGhosts.has(s.id),
    ),
    events,
  };
}

// ---------------------------------------------------------------------------
// Compact mode: services only, one bundled edge per ordered pair.
// ---------------------------------------------------------------------------

export interface BundleEvent {
  id: string;
  name: string;
  status: Status;
}

export interface Bundle {
  /** "bundle:<from>><to>" - a selection id, so the rail can resolve it */
  id: string;
  from: string;
  to: string;
  events: BundleEvent[];
  /** worst status among the events it carries */
  status: Status;
  /** the reverse pair also exists, so the canvas has to offset both */
  back: boolean;
}

export function bundleId(from: string, to: string): string {
  return `bundle:${from}>${to}`;
}

export function parseBundleId(id: string): { from: string; to: string } | null {
  if (!id.startsWith("bundle:")) return null;
  const body = id.slice(7);
  const at = body.indexOf(">");
  if (at <= 0 || at === body.length - 1) return null;
  return { from: body.slice(0, at), to: body.slice(at + 1) };
}

/**
 * One entry per ordered pair, in the order the pairs first appear.
 *
 * Self-consumption never becomes a bundle: an arrow from a box back to itself
 * is a loop, and a loop is the one shape a layered router cannot place without
 * drawing a circle around the node it belongs to.
 */
export function bundles(graph: EventGraph): Bundle[] {
  const byPair = new Map<string, Bundle>();
  const present = new Set(graph.services.map((s) => s.id));

  for (const event of graph.events) {
    if (!present.has(event.publisher)) continue;
    for (const consumer of event.consumers) {
      if (consumer.self || !present.has(consumer.service)) continue;
      const id = bundleId(event.publisher, consumer.service);
      const found = byPair.get(id);
      const carried: BundleEvent = {
        id: event.id,
        name: event.name,
        status: consumer.status,
      };
      if (found) {
        found.events.push(carried);
        found.status = worstStatus(found.events.map((e) => e.status));
      } else {
        byPair.set(id, {
          id,
          from: event.publisher,
          to: consumer.service,
          events: [carried],
          status: consumer.status,
          back: false,
        });
      }
    }
  }

  for (const bundle of byPair.values()) {
    bundle.back = byPair.has(bundleId(bundle.to, bundle.from));
  }
  return [...byPair.values()];
}

/** The bundle a selection id names, or null. Used by the detail rail. */
export function bundleById(graph: EventGraph, id: string): Bundle | null {
  const parsed = parseBundleId(id);
  if (!parsed) return null;
  return bundles(graph).find((b) => b.id === id) ?? null;
}
