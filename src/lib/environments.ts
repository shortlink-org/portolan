// The estate narrowed to what runs somewhere.
//
// A map answers "who leans on whom"; with an environment chosen it answers
// "who leans on whom IN STAGING" - and the honest way to answer that is to
// take the services the snapshot does not place there out of the catalog
// and let the same graph, map and counts run over what is left. A call to
// a service that is not deployed there is then an edge that leaves the
// chart, which is what it is. Nothing here is a second graph; it is the
// first graph over a smaller estate.

import type { Catalog } from "../catalog";
import { allDeployments, deploys, environmentOf } from "../catalog";

/** The ids of the services the snapshot places in any of the environments named. */
export function servicesDeployedIn(
  catalog: Catalog,
  environments: ReadonlySet<string>,
): Set<string> {
  const placed = allDeployments(catalog).filter((deployment) =>
    environments.has(environmentOf(deployment)),
  );
  const out = new Set<string>();
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      if (placed.some((deployment) => deploys(deployment, service))) {
        out.add(service.id);
      }
    }
  }
  return out;
}

/**
 * The catalog with only the services deployed in the environments named,
 * and only the contexts that still hold one. No environment named is the
 * whole estate: an empty filter is no filter, as everywhere else in the app.
 *
 * Flows, ADRs, stores and terms are left as they are: a flow through a
 * service that is not in staging is still the flow, and the reader asked
 * about the map, not the archive.
 */
export function narrowToEnvironments(
  catalog: Catalog,
  environments: ReadonlySet<string>,
): Catalog {
  if (environments.size === 0) return catalog;
  const kept = servicesDeployedIn(catalog, environments);
  return {
    ...catalog,
    contexts: catalog.contexts
      .map((context) => ({
        ...context,
        services: context.services.filter((service) => kept.has(service.id)),
      }))
      .filter((context) => context.services.length > 0),
  };
}
