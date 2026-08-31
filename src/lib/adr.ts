// Pure derivations over the decision records. Same rule as derive.ts: nothing
// here reads the DOM or the router, so every list an ADR page shows is testable.

import type { Adr, AdrScope, AdrStatus, Catalog } from "../catalog";
import { byDateDesc } from "../catalog";

/** "ADR-0007". The padded number is the name people use in prose and commits. */
export function adrNumber(adr: Adr): string {
  return `ADR-${String(adr.number).padStart(4, "0")}`;
}

/** Superseded and deprecated records are history: true, but no longer in force. */
export function isCurrent(adr: Adr): boolean {
  return adr.status !== "superseded" && adr.status !== "deprecated";
}

export function sortAdrs(adrs: Adr[]): Adr[] {
  return [...adrs].sort(byDateDesc);
}

export function scopeLabel(scope: AdrScope): string {
  switch (scope.kind) {
    case "org":
      return "org";
    case "context":
      return scope.context;
    case "service":
      return scope.service;
  }
}

/**
 * Does this record govern that service? An org-wide decision governs every
 * service, a context-wide one governs the services inside it, and `relates`
 * names services individually.
 */
export function adrCoversService(
  adr: Adr,
  serviceId: string,
  contextId: string,
): boolean {
  if (adr.scope.kind === "org") return true;
  if (adr.scope.kind === "service" && adr.scope.service === serviceId)
    return true;
  if (adr.scope.kind === "context" && adr.scope.context === contextId)
    return true;
  return (adr.relates.services ?? []).includes(serviceId);
}

/** Decisions governing a service, newest first. */
export function adrsForService(
  catalog: Catalog,
  serviceId: string,
  contextId: string,
): Adr[] {
  return sortAdrs(
    catalog.adrs.filter((a) => adrCoversService(a, serviceId, contextId)),
  );
}

/** The n newest accepted decisions, for the sidebar. */
export function newestAccepted(catalog: Catalog, n: number): Adr[] {
  return sortAdrs(catalog.adrs.filter((a) => a.status === "accepted")).slice(
    0,
    n,
  );
}

export interface AdrFilter {
  statuses: Set<AdrStatus>;
  /** scope labels, as produced by scopeLabel */
  scopes: Set<string>;
}

/** Index filtering. An empty facet means "no filter", not "nothing". */
export function filterAdrs(adrs: Adr[], filter: AdrFilter): Adr[] {
  return adrs.filter((a) => {
    if (filter.statuses.size > 0 && !filter.statuses.has(a.status))
      return false;
    if (filter.scopes.size > 0 && !filter.scopes.has(scopeLabel(a.scope)))
      return false;
    return true;
  });
}

/** Every scope label present in the catalog, org first, then alphabetical. */
export function scopeOptions(catalog: Catalog): string[] {
  const labels = new Set(catalog.adrs.map((a) => scopeLabel(a.scope)));
  const rest = [...labels].filter((l) => l !== "org").sort();
  return labels.has("org") ? ["org", ...rest] : rest;
}
