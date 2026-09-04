// Every in-app URL is built here. Routes use slugs, never dotted ids.

import type { Catalog } from "./catalog";
import type { Backlink } from "./lib/backlinks";
import { index } from "./data";
import { selectionHash } from "./selection/hash";
import { flowStepId } from "./selection/model";

export const paths = {
  overview: () => "/",
  flows: () => "/flows",
  flow: (slug: string) => `/flows/${slug}`,
  /** A flow page with one of its steps already selected. */
  flowStep: (slug: string, stepId: string) =>
    `/flows/${slug}${selectionHash({
      kind: "flow-step",
      id: flowStepId(slug, stepId),
    })}`,
  adrs: () => "/adrs",
  problems: () => "/problems",
  registry: () => "/registry",
  /**
   * A schema module sits at the estate level, not under a service.
   *
   * A store hangs off its service because `Store.owner` is one service the
   * validator enforces. A module has no such owner: it is published by one
   * service, vendored by four, and depended on by other modules. Hanging it off
   * a service would put one entity at four URLs - and `allCatalogPaths` would
   * emit all four, so the route test would bless the duplication rather than
   * catch it.
   *
   * One slug segment rather than `/registry/:owner/:name` because a module that
   * was never published has no owner, and because every other entity here is
   * addressed by a slug.
   */
  module: (slug: string) => `/registry/${slug}`,
  adr: (slug: string) => `/adrs/${slug}`,
  graph: () => "/graph",
  map: () => "/map",
  /** The map, with one relationship already open. */
  relation: (relationId: string) => `/map#rel-${relationId}`,
  context: (contextId: string) => `/c/${contextId}`,
  service: (contextId: string, serviceSlug: string) =>
    `/c/${contextId}/${serviceSlug}`,
  aggregate: (contextId: string, serviceSlug: string, aggregateSlug: string) =>
    `/c/${contextId}/${serviceSlug}/${aggregateSlug}`,
  event: (
    contextId: string,
    serviceSlug: string,
    aggregateSlug: string,
    eventSlug: string,
  ) => `/c/${contextId}/${serviceSlug}/${aggregateSlug}/${eventSlug}`,
  // Value objects and entities sit one segment deeper than events, behind a
  // literal, so an event slug can never be mistaken for a block slug.
  valueObject: (
    contextId: string,
    serviceSlug: string,
    aggregateSlug: string,
    voSlug: string,
  ) => `/c/${contextId}/${serviceSlug}/${aggregateSlug}/vo/${voSlug}`,
  entity: (
    contextId: string,
    serviceSlug: string,
    aggregateSlug: string,
    entitySlug: string,
  ) => `/c/${contextId}/${serviceSlug}/${aggregateSlug}/entity/${entitySlug}`,
  // A store hangs off its service, not off an aggregate: it is infrastructure
  // the service owns, and several aggregates may share one. "data" is a
  // literal for the same reason "vo" and "entity" are - a store slug can never
  // be mistaken for an aggregate slug.
  store: (contextId: string, serviceSlug: string, storeSlug: string) =>
    `/c/${contextId}/${serviceSlug}/data/${storeSlug}`,
} as const;

/** The section anchors on an aggregate page, as used by the building-blocks strip. */
export const AGGREGATE_ANCHOR = {
  entities: "bb-entities",
  valueObjects: "bb-value-objects",
  lifecycle: "bb-lifecycle",
  events: "bb-events",
  commands: "bb-commands",
  queries: "bb-queries",
} as const;

/** The section anchors on an event page, in the order the TOC lists them. */
export const EVENT_ANCHOR = {
  schema: "ev-schema",
  versions: "ev-versions",
  consumers: "ev-consumers",
  then: "ev-then",
} as const;

/**
 * The section anchors on a module page.
 *
 * Packages, interfaces and messages are anchors rather than routes: they are
 * already addressable as part of the catalog - an interface has a service page,
 * a message a shared type - and giving them a second URL here would mean the
 * same thing had two addresses.
 */
export const MODULE_ANCHOR = {
  packages: "mod-packages",
  interfaces: "mod-interfaces",
  types: "mod-types",
  deps: "mod-deps",
  used: "mod-used",
} as const;

export function packageAnchor(name: string): string {
  return `pkg-${name}`;
}

/** The section anchors on a value object or entity page. */
export const BLOCK_ANCHOR = {
  shape: "bl-shape",
  siblings: "bl-siblings",
} as const;

/**
 * The incoming-links section, and the one anchor that is the same on every
 * entity page. A reader who has learned where "what links here" lives on one
 * page has learned it for all of them, and `#links-here` is the same promise
 * in a URL.
 */
export const LINKS_HERE = "links-here";

/** The section anchors on a context page. */
export const CONTEXT_ANCHOR = {
  services: "ctx-services",
  aggregates: "ctx-aggregates",
  events: "ctx-events",
} as const;

/** The section anchors on an aggregate page, beyond the building-blocks strip. */
export const AGGREGATE_SECTION = {
  persistence: "agg-persistence",
} as const;

/** The section anchor for the columns that carry a block's fields. */
export const BLOCK_STORED_AS = "bl-stored-as";

/** The section anchors on a service page's overview tab. */
export const SERVICE_ANCHOR = {
  aggregates: "svc-aggregates",
  events: "svc-events",
} as const;

/** The section anchors on the context map. */
export const MAP_ANCHOR = {
  model: "map-model",
  relations: "map-relations",
} as const;

/** The id of one relationship's row, which is also its deep link. */
export function relationAnchor(relationId: string): string {
  return `rel-${relationId}`;
}

/** The section anchors on the overview, so "g d" has somewhere to land. */
export const OVERVIEW_ANCHOR = {
  contexts: "contexts",
  flows: "flows-by-reach",
} as const;

/** Path to the page that owns an event, or null if the event is not in the catalog. */
export function eventPath(eventId: string): string | null {
  const owner = index.eventOwner.get(eventId);
  const event = index.eventById.get(eventId);
  if (!owner || !event) return null;
  const context = index.serviceContext.get(owner.service.id);
  if (!context) return null;
  return paths.event(
    context.id,
    owner.service.slug,
    owner.aggregate.slug,
    event.slug,
  );
}

/** Path to a value object or entity page, or null if the id is not in the catalog. */
export function blockPath(blockId: string): string | null {
  const owner = index.blockById.get(blockId);
  if (!owner) return null;
  const build = owner.kind === "vo" ? paths.valueObject : paths.entity;
  return build(
    owner.context.id,
    owner.service.slug,
    owner.aggregate.slug,
    owner.block.slug,
  );
}

/** Path to a decision record, or null if the id is not a catalog ADR. */
export function adrPath(adrId: string): string | null {
  const adr = index.adrById.get(adrId);
  return adr ? paths.adr(adr.slug) : null;
}

/** Path to an aggregate page, or null if the id is not a catalog aggregate. */
export function aggregatePath(aggregateId: string): string | null {
  const aggregate = index.aggregateById.get(aggregateId);
  const service = index.aggregateOwner.get(aggregateId);
  const context = service ? index.serviceContext.get(service.id) : undefined;
  if (!aggregate || !service || !context) return null;
  return paths.aggregate(context.id, service.slug, aggregate.slug);
}

/** Path to a store's own ER page, or null if the id is not a catalog store. */
export function storePath(storeId: string): string | null {
  const store = index.storeById.get(storeId);
  const service = store ? index.serviceById.get(store.owner) : undefined;
  const context = store ? index.serviceContext.get(store.owner) : undefined;
  if (!store || !service || !context) return null;
  return paths.store(context.id, service.slug, store.slug);
}

/**
 * Path to a table: its store's page, with the table already selected. A table
 * has no page of its own - it is a node on a canvas, and the canvas is what
 * makes it readable - so the deep link opens the canvas around it.
 */
export function tablePath(tableId: string): string | null {
  const held = index.tableById.get(tableId);
  if (!held) return null;
  const to = storePath(held.store.id);
  return to ? `${to}${selectionHash({ kind: "table", id: tableId })}` : null;
}

/**
 * Path to a view: its store's page, with the view already selected. Same as a
 * table, and for the same reason — a view read away from the tables it reads is
 * a list of column names with no answer to "computed from what".
 */
export function viewPath(viewId: string): string | null {
  const held = index.viewById.get(viewId);
  if (!held) return null;
  const to = storePath(held.store.id);
  return to ? `${to}${selectionHash({ kind: "view", id: viewId })}` : null;
}

/** Path to a module page, or null if the id names no module in the catalog. */
export function modulePath(moduleId: string): string | null {
  const module = index.moduleById.get(moduleId);

  // Null rather than a guessed path: a module's `deps` may name one the estate
  // never vendored, and that renders as text rather than as a broken link.
  return module ? paths.module(module.slug) : null;
}

/** Path to a service page, or null if the id is not a catalog service. */
export function servicePath(serviceId: string): string | null {
  const service = index.serviceById.get(serviceId);
  const context = index.serviceContext.get(serviceId);
  if (!service || !context) return null;
  return paths.service(context.id, service.slug);
}

/**
 * Where a backlink leads. A flow that points here through one of its steps
 * leads to THAT step, not to the top of the flow: the reader clicked the
 * reason, so the reason is what has to be on screen when they land.
 */
export function backlinkPath(link: Backlink): string | null {
  switch (link.kind) {
    case "context":
      return index.catalog.contexts.some((c) => c.id === link.id)
        ? paths.context(link.id)
        : null;
    case "service":
      return servicePath(link.id);
    case "aggregate":
      return aggregatePath(link.id);
    case "event":
      return eventPath(link.id);
    case "vo":
    case "entity":
      return blockPath(link.id);
    case "store":
      return storePath(link.id);
    case "table":
      return tablePath(link.id);
    case "view":
      return viewPath(link.id);
    case "flow":
      return index.flowBySlug.has(link.id)
        ? link.at
          ? paths.flowStep(link.id, link.at)
          : paths.flow(link.id)
        : null;
    case "adr":
      return adrPath(link.id);
    // A shared type is only ever seen through the blocks that name it, and a
    // command or a query is a line on its aggregate's page.
    default:
      return null;
  }
}

/** Route patterns declared in App.tsx, in the same order. */
const ROUTES: RegExp[] = [
  /^\/$/,
  /^\/flows$/,
  /^\/flows\/[^/]+$/,
  /^\/adrs$/,
  /^\/problems$/,
  /^\/map$/,
  /^\/adrs\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/vo\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/entity\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/data\/[^/]+$/,
  /^\/graph$/,
  /^\/registry$/,
  /^\/registry\/[^/]+$/,
];

/** True when a path is matched by a declared route (query and hash ignored). */
export function isRoutable(path: string): boolean {
  const clean = (path.split("#")[0] ?? "").split("?")[0] ?? "";
  return ROUTES.some((r) => r.test(clean));
}

/** Every URL the Phase 1 UI can emit from catalog data. */
export function allCatalogPaths(catalog: Catalog): string[] {
  const out: string[] = [
    paths.overview(),
    paths.flows(),
    paths.graph(),
    paths.map(),
    paths.adrs(),
    paths.problems(),
    paths.registry(),
  ];
  for (const module of catalog.modules ?? []) {
    out.push(paths.module(module.slug));
  }
  for (const flow of catalog.flows) out.push(paths.flow(flow.slug));
  for (const adr of catalog.adrs) out.push(paths.adr(adr.slug));
  for (const context of catalog.contexts) {
    out.push(paths.context(context.id));
    for (const service of context.services) {
      out.push(paths.service(context.id, service.slug));
      for (const store of catalog.stores ?? []) {
        if (store.owner !== service.id) continue;
        out.push(paths.store(context.id, service.slug, store.slug));
      }
      for (const aggregate of service.aggregates) {
        out.push(paths.aggregate(context.id, service.slug, aggregate.slug));
        for (const event of aggregate.events) {
          out.push(
            paths.event(context.id, service.slug, aggregate.slug, event.slug),
          );
        }
        for (const vo of aggregate.valueObjects) {
          out.push(
            paths.valueObject(
              context.id,
              service.slug,
              aggregate.slug,
              vo.slug,
            ),
          );
        }
        for (const entity of aggregate.entities) {
          out.push(
            paths.entity(context.id, service.slug, aggregate.slug, entity.slug),
          );
        }
      }
    }
  }
  return out;
}
