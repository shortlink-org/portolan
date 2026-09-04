// Reads every catalog source the manifest names, merges them, and validates
// the union.
//
// Shared by the generator runner and the LikeC4 generator so the two cannot
// disagree about what the estate is. Merging before validating is the point:
// referential integrity holds over the union, and a fragment naming a peer it
// does not own is normal rather than broken.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { normalize } from "node:path";

import { validateCatalog } from "../src/catalog.ts";
import { enrichCatalog } from "../src/enrich.ts";
import { mergeCatalogs } from "../src/merge.ts";

/**
 * `exclude` names source files to leave out, as the manifest would spell
 * them. It exists for the verify phase: a step that writes a fragment from
 * what it observed must be shown the catalog WITHOUT its own last output, or
 * what it wrote last time would count as what it saw this time.
 */
export async function loadCatalog(manifestPath = "portolan.json", { exclude = [] } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const excluded = new Set(exclude.map((path) => normalize(path)));

  const paths = [];
  for await (const path of glob(manifest.sources ?? [])) {
    if (!excluded.has(normalize(path))) paths.push(path);
  }

  if (paths.length === 0) {
    throw new Error(
      `${manifestPath}: no catalog matched ${JSON.stringify(manifest.sources)}`,
    );
  }

  const merged = mergeCatalogs(
    paths.map((path) => ({
      path,
      catalog: JSON.parse(readFileSync(path, "utf8")),
    })),
  );

  // The edges the flows imply are added before validation, the same way the
  // app does it, so a generator draws the same estate the reader sees.
  const enriched = enrichCatalog(merged.catalog);

  try {
    validateCatalog(enriched.catalog);
  } catch (cause) {
    throw new Error(`the merged catalog is not valid: ${cause.message}`);
  }

  return { manifest, ...merged, catalog: enriched.catalog, derived: enriched.derived };
}
