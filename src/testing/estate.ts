// The estate the UI tests are written against: a frozen copy of the sources
// as they were on 2026-09-05, before the hand-written order service made way
// for the real one. It holds the shapes the real services do not - a flow with
// parallel branches, a store with foreign keys, indexes, views and lineage, an
// ADR that relates to a flow - and it does not move when a service is added or
// a fragment is regenerated, which is what a fixture is for. Tests about what
// the app actually ships import `../data` instead.
//
// Built the way `src/data.ts` builds the live catalog: merged, enriched,
// validated, indexed. A fixture that failed validation would be a test of
// nothing, so that failure throws here.

import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog, CatalogIndex } from "../catalog";
import { enrichCatalog } from "../enrich";
import type { DerivedEdge } from "../enrich";
import { mergeCatalogs } from "../merge";
import type { CatalogSource, MergeConflict, SourceStamp } from "../merge";

// A file is named for the path its source had, with `__` for `/`, so the
// stamps the merge records read the way they did when the estate was live.
const modules: Record<string, unknown> = import.meta.glob("./estate/*.json", { eager: true, import: "default" });

const sources: CatalogSource[] = Object.entries(modules)
  .map(([file, catalog]) => ({
    path: file.replace(/^\.\/estate\//, "").replace(/__/g, "/"),
    catalog: catalog as Catalog,
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const merged = mergeCatalogs(sources);
const enriched = enrichCatalog(merged.catalog);

export const catalog: Catalog = validateCatalog(enriched.catalog);
export const index: CatalogIndex = buildIndex(catalog);
export const catalogSources: SourceStamp[] = merged.sources;
export const catalogConflicts: MergeConflict[] = merged.conflicts;
export const derivedEdges: DerivedEdge[] = enriched.derived;
/** The sources as merged, before anything was derived or checked. */
export const rawCatalog: Catalog = merged.catalog;
