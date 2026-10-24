import type { BoundedContext, Catalog, Service } from "../catalog";
import { ownersOf } from "../catalog";

export interface OwnedService {
  context: BoundedContext;
  service: Service;
}

export interface OwnerGroup {
  handle: string;
  services: OwnedService[];
}

export interface OwnershipIndex {
  services: OwnedService[];
  owners: OwnerGroup[];
  assigned: number;
  unassigned: OwnedService[];
}

/**
 * Estate-level ownership, without inventing a single owner for a service.
 *
 * CODEOWNERS may name several handles for one path. That service therefore
 * appears in every matching owner group, while `assigned` counts it once.
 * Catalog order is retained inside groups; groups themselves put the broadest
 * owner first and use the handle as a stable tie-breaker.
 */
export function ownershipIndex(catalog: Catalog): OwnershipIndex {
  const services = catalog.contexts.flatMap((context) =>
    context.services.map((service) => ({ context, service })),
  );
  const grouped = new Map<string, OwnedService[]>();
  const unassigned: OwnedService[] = [];

  for (const entry of services) {
    const handles = ownersOf(entry.service);
    if (handles.length === 0) unassigned.push(entry);
    for (const handle of handles) {
      const current = grouped.get(handle);
      if (current) current.push(entry);
      else grouped.set(handle, [entry]);
    }
  }

  const owners = [...grouped]
    .map(([handle, owned]) => ({ handle, services: owned }))
    .sort(
      (a, b) =>
        b.services.length - a.services.length ||
        a.handle.localeCompare(b.handle),
    );

  return {
    services,
    owners,
    assigned: services.length - unassigned.length,
    unassigned,
  };
}
