// Single entry point for catalog data. Validation happens here, at startup, so
// a bad generator run is caught before anything is drawn.
//
// It is caught, not thrown: a validator that throws out of a module's top level
// takes the whole bundle down and the reader gets a blank page and a line in a
// console they are not looking at. So the failure is turned into a value, the
// app falls back to an empty catalog so every module below still imports, and
// the shell renders the error instead of the routes.

import raw from "../data/catalog.json";
import { buildIndex, CatalogError, validateCatalog } from "./catalog";
import type { Catalog, CatalogIndex } from "./catalog";

/** What the app draws when the catalog cannot be trusted: nothing. */
const EMPTY: Catalog = {
  generatedAt: "",
  commit: "",
  contexts: [],
  defs: {},
  flows: [],
  adrs: [],
};

function load(): { catalog: Catalog; error: CatalogError | null } {
  try {
    return {
      catalog: validateCatalog(raw as unknown as Catalog),
      error: null,
    };
  } catch (cause) {
    if (cause instanceof CatalogError) return { catalog: EMPTY, error: cause };
    // Anything else is a shape the validator never got far enough to name -
    // a truncated file, a null where a list was expected. Same treatment.
    return {
      catalog: EMPTY,
      error: new CatalogError(
        cause instanceof Error ? cause.message : String(cause),
      ),
    };
  }
}

const loaded = load();

export const catalog: Catalog = loaded.catalog;
export const index: CatalogIndex = buildIndex(catalog);

/**
 * Where the catalog is read from, as a reader would type it. Empty states name
 * it, so it is written once here rather than spelled out on five pages.
 */
export const CATALOG_PATH = "data/catalog.json";

/** Non-null when the catalog failed validation; the shell renders it instead. */
export const catalogError: CatalogError | null = loaded.error;
