// LikeC4 identifiers derived from catalog ids. Pure and deterministic: the
// generator and the app must agree on every name without sharing state.

import type {
  Aggregate,
  Catalog,
  BoundedContext,
  Event,
  Flow,
  Participant,
  Service,
} from "../catalog";
import reserved from "./reserved.json";

/**
 * Words the LikeC4 grammar has taken. An aggregate called `order` is an
 * ordinary thing to find in a shop, and a model that declares one does not
 * parse: the parser reads the keyword and expects the block to end. Whether a
 * given word breaks depends on where it lands, so every word the grammar knows
 * is escaped rather than the subset that happens to break today.
 *
 * `src/likec4/reserved.json` is read out of the installed grammar:
 *
 *   [...bundle.matchAll(/"Keyword","value":"([A-Za-z_][A-Za-z0-9_]*)"/g)]
 *
 * over `node_modules/likec4/dist/chunks/node.mjs`. It is a copy, so it can go
 * stale when likec4 is upgraded; `npm run likec4:validate` is what says so.
 */
const RESERVED = new Set<string>(reserved);

/**
 * LikeC4 identifiers allow letters, digits and underscore, cannot lead with a
 * digit, and cannot be a word of the grammar. One escape for all three: a
 * leading underscore, which LikeC4 takes and no catalog id starts with.
 */
export function safeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || RESERVED.has(cleaned) ? `_${cleaned}` : cleaned;
}

/** A catalog id like "shop.oms.basket" becomes the LikeC4 path "shop.oms.basket". */
export function fqn(catalogId: string): string {
  return catalogId.split(".").map(safeId).join(".");
}

export const contextFqn = (context: BoundedContext | string): string =>
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

/**
 * C4 level 1, and the only view with a name of its own: the estate has one
 * landscape, so nothing is derived from an id.
 */
export const LANDSCAPE_VIEW = "landscape";

/** C4 level 2, one context: its services and the stores they keep state in. */
export const contextViewId = (context: BoundedContext | string): string =>
  `ctx_${safeId(typeof context === "string" ? context : context.id)}`;

/** C4 level 2, one service: the service as a box among the ones it touches. */
export const serviceViewId = (service: Service | string): string =>
  `svc_${safeId(typeof service === "string" ? service : service.id)}`;

/** C4 level 3, the same service opened: its aggregates and its stores. */
export const serviceInsideViewId = (service: Service | string): string =>
  `${serviceViewId(service)}_inside`;

/** Every flow has two declared views: the whole sequence, and the crossings only. */
export const flowViewId = (flow: Flow | string): string =>
  `flow_${safeId(typeof flow === "string" ? flow : flow.slug)}`;

export const flowCrossViewId = (flow: Flow | string): string =>
  `${flowViewId(flow)}_cross`;

/** Every view id the generator is expected to emit, in a stable order. */
export function allViewIds(catalog: Catalog): string[] {
  const out: string[] = [LANDSCAPE_VIEW];
  for (const context of catalog.contexts) {
    out.push(contextViewId(context));
    for (const service of context.services) {
      out.push(serviceViewId(service));
      out.push(serviceInsideViewId(service));
    }
  }
  for (const flow of catalog.flows) {
    out.push(flowViewId(flow));
    out.push(flowCrossViewId(flow));
  }
  return out;
}
