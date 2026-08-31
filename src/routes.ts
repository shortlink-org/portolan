// Every in-app URL is built here. Routes use slugs, never dotted ids.

import type { Catalog } from "./catalog";
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
  adr: (slug: string) => `/adrs/${slug}`,
  graph: () => "/graph",
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
} as const;

/** The section anchors on an aggregate page, as used by the building-blocks strip. */
export const AGGREGATE_ANCHOR = {
  entities: "bb-entities",
  valueObjects: "bb-value-objects",
  events: "bb-events",
  commands: "bb-commands",
  queries: "bb-queries",
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

/** Path to a service page, or null if the id is not a catalog service. */
export function servicePath(serviceId: string): string | null {
  const service = index.serviceById.get(serviceId);
  const context = index.serviceContext.get(serviceId);
  if (!service || !context) return null;
  return paths.service(context.id, service.slug);
}

/** Route patterns declared in App.tsx, in the same order. */
const ROUTES: RegExp[] = [
  /^\/$/,
  /^\/flows$/,
  /^\/flows\/[^/]+$/,
  /^\/adrs$/,
  /^\/adrs\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/vo\/[^/]+$/,
  /^\/c\/[^/]+\/[^/]+\/[^/]+\/entity\/[^/]+$/,
  /^\/graph$/,
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
    paths.adrs(),
  ];
  for (const flow of catalog.flows) out.push(paths.flow(flow.slug));
  for (const adr of catalog.adrs) out.push(paths.adr(adr.slug));
  for (const context of catalog.contexts) {
    out.push(paths.context(context.id));
    for (const service of context.services) {
      out.push(paths.service(context.id, service.slug));
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
