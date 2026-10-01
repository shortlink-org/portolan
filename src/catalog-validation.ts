import type { Catalog } from "./catalog-model.ts";
import { validateCatalogAnnotations } from "./lib/annotations.mjs";
import { allExternals, allStores } from "./catalog-model.ts";
import { fail } from "./catalog-validation/errors.ts";
import { validateFlows } from "./catalog-validation/flows.ts";
import {
  validateDeployments,
  validateExternals,
  validateModules,
  validateRepos,
  validateWorkItems,
} from "./catalog-validation/inventory.ts";
import {
  validateAdrs,
  validateRfcs,
  validateTerms,
} from "./catalog-validation/records.ts";
import {
  validateContexts,
  validateServiceDependencies,
} from "./catalog-validation/services.ts";
import { validateStores } from "./catalog-validation/stores.ts";

// The checks live under ./catalog-validation/ by subject - errors, services,
// aggregates, flows, stores, inventory, records. This file is the entry: it
// runs them in order and re-exports what the rest of the app imports.

export { CatalogError } from "./catalog-validation/errors.ts";

export function validateCatalog(catalog: Catalog): Catalog {
  if (catalog.annotations !== undefined) {
    try { validateCatalogAnnotations(catalog.annotations); }
    catch (cause) { fail(cause instanceof Error ? cause.message : String(cause), "annotations"); }
  }
  if (!catalog.generatedAt) fail("catalog.generatedAt is missing", "catalog");
  if (!catalog.commit) fail("catalog.commit is missing", "catalog");

  const eventIds = new Set<string>();
  const rpcIds = new Set<string>();
  const providedRpcRefs = new Set(
    allExternals(catalog).flatMap((external) =>
      external.provides.flatMap((provided) =>
        provided.methods.map(
          (method) => `${external.id}|${provided.id}/${method.name}`,
        ),
      ),
    ),
  );
  const storeIds = new Set(allStores(catalog).map((store) => store.id));
  // `<service>|<aggregate id>/<operation id>`: what a `call` step into a
  // service may name - the use case it runs, when the flow crosses a
  // boundary the transport does not draw (an in-process command bus).
  const operationRefs = new Set(
    catalog.contexts.flatMap((context) =>
      context.services.flatMap((service) =>
        service.aggregates.flatMap((aggregate) =>
          aggregate.operations.map(
            (operation) => `${service.id}|${aggregate.id}/${operation.id}`,
          ),
        ),
      ),
    ),
  );

  // The contexts walk fills the first three sets; the flows read all five.
  const refs = { eventIds, rpcIds, providedRpcRefs, storeIds, operationRefs };
  validateContexts(catalog, refs);

  for (const [defId, def] of Object.entries(catalog.defs)) {
    for (const field of def.fields) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of def "${defId}" references unknown def "${field.ref}"`,
          `def ${defId} / field ${field.name}`,
        );
      }
    }
  }

  validateFlows(catalog, refs);

  validateServiceDependencies(catalog);
  validateExternals(catalog);
  validateStores(catalog);
  validateModules(catalog);
  validateAdrs(catalog, eventIds);
  validateRfcs(catalog, eventIds);
  validateTerms(catalog);
  validateRepos(catalog);
  validateWorkItems(catalog);
  validateDeployments(catalog);

  return catalog;
}
