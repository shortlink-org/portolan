// LikeC4 identifiers derived from catalog ids. Pure and deterministic: the
// generator and the app must agree on every name without sharing state.

import type {
  Aggregate,
  Catalog,
  Context,
  Event,
  Flow,
  Participant,
  Service,
} from "../catalog";

/** LikeC4 identifiers allow letters, digits and underscore, and cannot lead with a digit. */
export function safeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** A catalog id like "shop.oms.order" becomes the LikeC4 path "shop.oms.order". */
export function fqn(catalogId: string): string {
  return catalogId.split(".").map(safeId).join(".");
}

export const contextFqn = (context: Context | string): string =>
  fqn(typeof context === "string" ? context : context.id);

export const serviceFqn = (service: Service | string): string =>
  fqn(typeof service === "string" ? service : service.id);

export const aggregateFqn = (aggregate: Aggregate | string): string =>
  fqn(typeof aggregate === "string" ? aggregate : aggregate.id);

export const eventFqn = (event: Event | string): string =>
  fqn(typeof event === "string" ? event : event.id);

/**
 * Flow participants are either catalog services (dotted, hierarchical) or bare
 * ids like "bus" and "fraud-scoring" that live at the model root.
 */
export function participantFqn(participant: Participant | string): string {
  const id = typeof participant === "string" ? participant : participant.id;
  return fqn(id);
}

// --- view ids -------------------------------------------------------------

export const contextViewId = (context: Context | string): string =>
  `ctx_${safeId(typeof context === "string" ? context : context.id)}`;

export const serviceViewId = (service: Service | string): string =>
  `svc_${safeId(typeof service === "string" ? service : service.id)}`;

/** Every flow has two declared views: the whole sequence, and the crossings only. */
export const flowViewId = (flow: Flow | string): string =>
  `flow_${safeId(typeof flow === "string" ? flow : flow.slug)}`;

export const flowCrossViewId = (flow: Flow | string): string =>
  `${flowViewId(flow)}_cross`;

/** Every view id the generator is expected to emit, in a stable order. */
export function allViewIds(catalog: Catalog): string[] {
  const out: string[] = [];
  for (const context of catalog.contexts) {
    out.push(contextViewId(context));
    for (const service of context.services) out.push(serviceViewId(service));
  }
  for (const flow of catalog.flows) {
    out.push(flowViewId(flow));
    out.push(flowCrossViewId(flow));
  }
  return out;
}
