// What links here.
//
// Every entity page answers what it depends on: an event lists its schema, a
// service its calls, a flow its steps. None of that answers the question a
// reader actually arrives with — "who depends on THIS?" — because the answer
// is not held by the thing itself. It is spread across everything else.
//
// So it is derived, once, here. A consumer, a flow step, a decision record and
// a field naming a shared type are four different edges in the catalog, and a
// reader scanning the bottom of a page asks one question of all four, so they
// are one row type here and one component downstream.
//
// Pure, like derive.ts: catalog and index in, plain values out. Nothing builds
// a URL — a Backlink says WHAT points at the target and routes.ts says where
// that thing lives, which keeps this file testable without a router.

import type { Adr, Catalog, CatalogIndex, Flow, Status, Term } from "../catalog";
import { allServices, walkSteps } from "../catalog";
import { sortAdrs, adrNumber } from "./adr";
import { flowsForService, usagesOfDef } from "./derive";
import { bindTerms } from "./terms";
import type { DefUsage } from "./derive";
import type { Kind } from "./kinds";

/** Flows are named by slug, because that is what a route and a step id use. */
export interface BacklinkTarget {
  kind: Kind;
  id: string;
}

export interface Backlink {
  /** What is doing the pointing. */
  kind: Kind;
  /** Its catalog id — what a link is built from, and what "copy" copies. */
  id: string;
  /** What to print: an identifier, not a sentence. */
  name: string;
  /** What holds it — a context name, an aggregate id, a decision's title. */
  owner: string | null;
  /** For the colour dot; null for anything outside every context. */
  context: string | null;
  /**
   * Why it points here, said in the catalog's own words: "consumes",
   * "step 12", "relates.events", the names of the fields that carry a type.
   * Without it a backlink is a name with no reason attached, which is exactly
   * the thing a reader would have to open the page to find out.
   */
  via: string;
  /** The exact place inside the linking thing — a flow's step id. */
  at?: string;
  /** Carried through from the edge, so an unresolved one still says so. */
  status?: Status;
  /** Event versions in which a shared type appears, oldest first. */
  versions?: string[];
}

export interface BacklinkGroup {
  kind: Kind;
  links: Backlink[];
}

/**
 * Group order, loudest dependency first. Services are what breaks when this
 * changes; flows are where that break is seen; decisions are what was said
 * about it; the rest is structure.
 */
const GROUP_ORDER: readonly Kind[] = [
  "service",
  "flow",
  "adr",
  "event",
  "aggregate",
  "entity",
  "vo",
  "def",
  "context",
  // Last. A term does not depend on this page in the sense every row above
  // does - nothing breaks when the aggregate changes - it is what the thing
  // is CALLED, which a reader wants after they know who breaks.
  "term",
] as const;

function grouped(links: Backlink[]): BacklinkGroup[] {
  const by = new Map<Kind, Backlink[]>();
  for (const link of links) {
    const list = by.get(link.kind) ?? [];
    list.push(link);
    by.set(link.kind, list);
  }
  return GROUP_ORDER.filter((kind) => by.has(kind)).map((kind) => ({
    kind,
    links: by.get(kind) ?? [],
  }));
}

export function backlinkCount(groups: readonly BacklinkGroup[]): number {
  return groups.reduce((n, g) => n + g.links.length, 0);
}

// ---------------------------------------------------------------------------
// Row builders. One per kind of thing that can do the pointing.
// ---------------------------------------------------------------------------

function serviceLink(
  index: CatalogIndex,
  id: string,
  via: string,
  status?: Status,
): Backlink {
  const context = index.serviceContext.get(id);
  return {
    kind: "service",
    id,
    name: id,
    // A consumer named by an event but absent from the catalog is still a real
    // dependency. The graph draws it as a ghost; this row says so in words.
    owner: context ? context.name : "not in the catalog",
    context: context?.id ?? null,
    via,
    ...(status ? { status } : {}),
  };
}

/** The word the context's glossary uses for this thing. */
function termLink(term: Term): Backlink {
  return {
    kind: "term",
    id: term.id,
    name: term.name,
    owner: `glossary of ${term.context}`,
    context: term.context,
    via: "names it",
  };
}

function flowLink(flow: Flow, via: string, at?: string): Backlink {
  return {
    kind: "flow",
    id: flow.slug,
    name: flow.slug,
    owner: flow.name,
    // A flow belongs to no single context; the wash on its own page takes the
    // first one it crosses, and so does its dot here.
    context: flow.participants.find((p) => p.context)?.context ?? null,
    via,
    ...(at ? { at } : {}),
  };
}

function adrLink(index: CatalogIndex, adr: Adr, via: string): Backlink {
  const context =
    adr.scope.kind === "context"
      ? adr.scope.context
      : adr.scope.kind === "service"
        ? (index.serviceContext.get(adr.scope.service)?.id ?? null)
        : null;
  return {
    kind: "adr",
    id: adr.id,
    name: adrNumber(adr),
    owner: adr.title,
    context,
    via,
  };
}

/**
 * A usage of a shared type, as a row. An RPC message has no page of its own,
 * so it is filed under the service that answers it and says "rpc" in its
 * reason rather than pretending to be one.
 */
function usageLink(index: CatalogIndex, usage: DefUsage): Backlink {
  const via =
    usage.fields.length > 0 ? usage.fields.join(", ") : "the same shape";
  switch (usage.kind) {
    case "event": {
      const owner = index.eventOwner.get(usage.id);
      return {
        kind: "event",
        id: usage.id,
        name: usage.name,
        owner: usage.owner,
        context: owner
          ? (index.serviceContext.get(owner.service.id)?.id ?? null)
          : null,
        via,
        ...(usage.versions && usage.versions.length > 0
          ? { versions: usage.versions }
          : {}),
      };
    }
    case "entity":
    case "vo":
      return {
        kind: usage.kind,
        id: usage.id,
        name: usage.name,
        owner: usage.owner,
        context: index.blockById.get(usage.id)?.context.id ?? null,
        via,
      };
    case "rpc":
      return {
        kind: "service",
        id: usage.owner,
        name: usage.name,
        owner: usage.owner,
        context: index.serviceContext.get(usage.owner)?.id ?? null,
        via: `rpc · ${via}`,
      };
    case "def":
      return {
        kind: "def",
        id: usage.id,
        name: usage.name,
        owner: "shared types",
        context: null,
        via,
      };
  }
}

// ---------------------------------------------------------------------------
// Traversals
// ---------------------------------------------------------------------------

export interface StepInto {
  flow: Flow;
  stepId: string;
  /** The step's place in the whole flow, frames included. */
  number: number;
  eventId: string;
}

/**
 * Every step across every flow that carries one of these events. The generic
 * form of derive's `stepsReferencing`: an aggregate is reached through all of
 * its events at once, and the rows must still come out in flow order.
 */
export function stepsInto(catalog: Catalog, eventIds: Set<string>): StepInto[] {
  const out: StepInto[] = [];
  for (const flow of catalog.flows) {
    walkSteps(flow.steps).forEach((step, i) => {
      if (step.ref && eventIds.has(step.ref)) {
        out.push({ flow, stepId: step.id, number: i + 1, eventId: step.ref });
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-target derivations
// ---------------------------------------------------------------------------

function eventBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  eventId: string,
): Backlink[] {
  const event = index.eventById.get(eventId);
  if (!event) return [];
  const out: Backlink[] = [];
  for (const consumer of event.consumers) {
    out.push(serviceLink(index, consumer.service, "consumes", consumer.status));
  }
  for (const step of stepsInto(catalog, new Set([eventId]))) {
    out.push(flowLink(step.flow, `step ${step.number}`, step.stepId));
  }
  for (const adr of index.adrsByEvent.get(eventId) ?? []) {
    out.push(adrLink(index, adr, "relates.events"));
  }
  return out;
}

function aggregateBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  aggregateId: string,
): Backlink[] {
  const aggregate = index.aggregateById.get(aggregateId);
  if (!aggregate) return [];
  const out: Backlink[] = [];
  const names = new Map(aggregate.events.map((e) => [e.id, e.name]));

  for (const event of aggregate.events) {
    for (const consumer of event.consumers) {
      out.push(
        serviceLink(
          index,
          consumer.service,
          `consumes ${event.name}`,
          consumer.status,
        ),
      );
    }
  }
  for (const step of stepsInto(catalog, new Set(names.keys()))) {
    out.push(
      flowLink(
        step.flow,
        `step ${step.number} · ${names.get(step.eventId) ?? step.eventId}`,
        step.stepId,
      ),
    );
  }
  // A decision naming two of this aggregate's events is one decision, not two
  // rows, so the events it names are joined into its reason instead.
  const byAdr = new Map<string, { adr: Adr; events: string[] }>();
  for (const event of aggregate.events) {
    for (const adr of index.adrsByEvent.get(event.id) ?? []) {
      const seen = byAdr.get(adr.id) ?? { adr, events: [] };
      seen.events.push(event.name);
      byAdr.set(adr.id, seen);
    }
  }
  for (const { adr, events } of byAdr.values()) {
    out.push(adrLink(index, adr, `relates ${events.join(", ")}`));
  }
  return out;
}

function serviceBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  serviceId: string,
): Backlink[] {
  const service = index.serviceById.get(serviceId);
  if (!service) return [];
  const out: Backlink[] = [];

  // Who calls it. The service page lists `provides` and `consumes`, both of
  // which point outwards; this is the only place the callers are named.
  for (const other of allServices(catalog)) {
    if (other.id === serviceId) continue;
    for (const call of other.consumes) {
      if (call.peer === serviceId) {
        out.push(serviceLink(index, other.id, `calls ${call.id}`, call.status));
      }
    }
  }
  for (const aggregate of service.aggregates) {
    for (const event of aggregate.events) {
      for (const consumer of event.consumers) {
        if (consumer.service === serviceId) continue;
        out.push(
          serviceLink(
            index,
            consumer.service,
            `consumes ${event.name}`,
            consumer.status,
          ),
        );
      }
    }
  }
  for (const flow of flowsForService(catalog, serviceId)) {
    out.push(flowLink(flow, "participant"));
  }
  // Only decisions that NAME this service. An org-wide record governs it too,
  // but "everything" is not a backlink, and the decisions tab already has it.
  for (const adr of sortAdrs(catalog.adrs)) {
    if (adr.scope.kind === "service" && adr.scope.service === serviceId) {
      out.push(adrLink(index, adr, "scope"));
    } else if ((adr.relates.services ?? []).includes(serviceId)) {
      out.push(adrLink(index, adr, "relates.services"));
    }
  }
  return out;
}

function contextBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  contextId: string,
): Backlink[] {
  const context = catalog.contexts.find((c) => c.id === contextId);
  if (!context) return [];
  const out: Backlink[] = [];
  const inside = new Set(context.services.map((s) => s.id));
  const events = context.services.flatMap((s) =>
    s.aggregates.flatMap((a) => a.events),
  );
  const eventIds = new Set(events.map((e) => e.id));

  // Traffic that starts outside. A call between two of its own services is
  // internal wiring, not something the context is depended on for.
  for (const other of allServices(catalog)) {
    if (inside.has(other.id)) continue;
    for (const call of other.consumes) {
      if (inside.has(call.peer)) {
        out.push(serviceLink(index, other.id, `calls ${call.id}`, call.status));
      }
    }
  }
  for (const event of events) {
    for (const consumer of event.consumers) {
      if (inside.has(consumer.service)) continue;
      out.push(
        serviceLink(
          index,
          consumer.service,
          `consumes ${event.name}`,
          consumer.status,
        ),
      );
    }
  }
  for (const flow of catalog.flows) {
    const here = flow.participants
      .filter((p) => p.context === contextId)
      .map((p) => p.id);
    if (here.length > 0) out.push(flowLink(flow, here.join(", ")));
  }
  for (const adr of sortAdrs(catalog.adrs)) {
    const scope = adr.scope;
    const services = (adr.relates.services ?? []).filter((s) => inside.has(s));
    if (scope.kind === "context" && scope.context === contextId) {
      out.push(adrLink(index, adr, "scope"));
    } else if (scope.kind === "service" && inside.has(scope.service)) {
      out.push(adrLink(index, adr, `scope ${scope.service}`));
    } else if (services.length > 0) {
      out.push(adrLink(index, adr, `relates ${services.join(", ")}`));
    } else {
      const named = (adr.relates.events ?? []).filter((e) => eventIds.has(e));
      if (named.length > 0) {
        out.push(
          adrLink(
            index,
            adr,
            `relates ${named.map((e) => index.eventById.get(e)?.name ?? e).join(", ")}`,
          ),
        );
      }
    }
  }
  return out;
}

function blockBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  blockId: string,
): Backlink[] {
  const owner = index.blockById.get(blockId);
  const ref = owner?.block.ref;
  // An inline shape is used only where it is written. There is nothing to
  // find, which is a fact about the block rather than an empty answer.
  if (!ref) return [];
  return usagesOfDef(catalog, ref, blockId).map((usage) =>
    usageLink(index, usage),
  );
}

function flowBacklinks(
  catalog: Catalog,
  index: CatalogIndex,
  slug: string,
): Backlink[] {
  if (!index.flowBySlug.has(slug)) return [];
  return sortAdrs(catalog.adrs)
    .filter((adr) => (adr.relates.flows ?? []).includes(slug))
    .map((adr) => adrLink(index, adr, "relates.flows"));
}

/**
 * Everything in the catalog that points at one thing, grouped by what does the
 * pointing.
 *
 * Decision records are not a target: the only thing that names an ADR is
 * another ADR, through supersedes / supersededBy, and that is already drawn at
 * the top of its page as a banner — a warning that the record is no longer in
 * force says more than a row in a list can.
 */
/** The rows, plus the word the glossary uses for the thing they point at. */
function named(catalog: Catalog, id: string, links: Backlink[]): Backlink[] {
  const term = bindTerms(catalog).byTarget.get(id);

  return term ? [...links, termLink(term)] : links;
}

export function backlinksFor(
  catalog: Catalog,
  index: CatalogIndex,
  target: BacklinkTarget,
): BacklinkGroup[] {
  switch (target.kind) {
    case "context":
      return grouped(contextBacklinks(catalog, index, target.id));
    case "service":
      return grouped(serviceBacklinks(catalog, index, target.id));
    // The three kinds a glossary can name. A context, a service and a flow are
    // not words in a vocabulary - they are places the words are spoken.
    case "aggregate":
      return grouped(named(catalog, target.id, aggregateBacklinks(catalog, index, target.id)));
    case "event":
      return grouped(named(catalog, target.id, eventBacklinks(catalog, index, target.id)));
    case "vo":
    case "entity":
      return grouped(named(catalog, target.id, blockBacklinks(catalog, index, target.id)));
    case "flow":
      return grouped(flowBacklinks(catalog, index, target.id));
    default:
      return [];
  }
}
