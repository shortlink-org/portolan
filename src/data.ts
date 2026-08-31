// Single entry point for catalog data. Validation happens here, at startup, so
// a bad generator run fails before anything is drawn.

import raw from "../data/catalog.json";
import { buildIndex, validateCatalog } from "./catalog";
import type { Catalog, CatalogIndex } from "./catalog";

export const catalog: Catalog = validateCatalog(raw as unknown as Catalog);
export const index: CatalogIndex = buildIndex(catalog);
