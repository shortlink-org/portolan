import type { Catalog, Rfc } from "../catalog";
import { allRfcs } from "../catalog";

export const RFC_LIFECYCLE_ORDER = [
  "discussion",
  "draft",
  "accepted",
  "implemented",
  "postponed",
  "rejected",
  "withdrawn",
  "abandoned",
  "superseded",
  "unknown",
] as const;

export function sortRfcs(rfcs: Rfc[]): Rfc[] {
  return [...rfcs].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? "").localeCompare(
        a.updatedAt ?? a.createdAt ?? "",
      ) || a.displayId.localeCompare(b.displayId, undefined, { numeric: true }),
  );
}

export function rfcCoversService(
  rfc: Rfc,
  serviceId: string,
  contextId: string,
): boolean {
  if (rfc.scope.kind === "org") return true;
  if (rfc.scope.kind === "service" && rfc.scope.service === serviceId)
    return true;
  if (rfc.scope.kind === "context" && rfc.scope.context === contextId)
    return true;
  return (rfc.relates.services ?? []).includes(serviceId);
}

export function rfcsForService(
  catalog: Catalog,
  serviceId: string,
  contextId: string,
): Rfc[] {
  return sortRfcs(
    allRfcs(catalog).filter((rfc) =>
      rfcCoversService(rfc, serviceId, contextId),
    ),
  );
}

/** RFCs whose proposal or review still calls for attention. */
export function activeRfcs(catalog: Catalog, n: number): Rfc[] {
  return sortRfcs(
    allRfcs(catalog).filter((rfc) =>
      ["draft", "discussion"].includes(rfc.lifecycle),
    ),
  ).slice(0, n);
}
