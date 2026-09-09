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
import { filterCatalogForProfile } from "../src/catalog-profile.ts";
import { enrichCatalog } from "../src/enrich.ts";
import { mergeCatalogs } from "../src/merge.ts";

/**
 * `exclude` names source files to leave out, as the manifest would spell
 * them. It exists for the verify phase: a step that writes a fragment from
 * what it observed must be shown the catalog WITHOUT its own last output, or
 * what it wrote last time would count as what it saw this time.
 */
export async function loadCatalog(manifestPath = "portolan.json", { exclude = [], profile } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const excluded = new Set(exclude.map((path) => normalize(path)));
  const selected = profile
    ? (manifest.catalogs ?? []).find((candidate) => candidate.id === profile)
    : null;
  if (profile && !selected) {
    throw new Error(`${manifestPath}: unknown catalog profile ${JSON.stringify(profile)}`);
  }
  const patterns = selected?.sources ?? manifest.sources ?? [];

  const paths = [];
  for await (const path of glob(patterns)) {
    if (!excluded.has(normalize(path))) paths.push(path);
  }

  const emptyWorkspace = Array.isArray(manifest.projects)
    && manifest.projects.length === 0
    && (manifest.extract ?? []).length === 0
    && (manifest.verify ?? []).length === 0;
  if (paths.length === 0 && !emptyWorkspace) {
    throw new Error(
      `${manifestPath}: no catalog matched ${JSON.stringify(patterns)}`,
    );
  }

  const merged = mergeCatalogs(
    paths.map((path) => ({
      path,
      catalog: JSON.parse(readFileSync(path, "utf8")),
    })),
  );
  if (paths.length === 0) {
    // An intentionally empty workspace still needs a valid, deterministic
    // catalog value for generators and the local preview. These are state
    // markers, not provenance claims: there is no source file to stamp.
    merged.catalog.generatedAt = "1970-01-01T00:00:00Z";
    merged.catalog.commit = "empty";
  }

  // The edges the flows imply are added before validation, the same way the
  // app does it, so a generator draws the same estate the reader sees.
  const scoped = selected
    ? filterCatalogForProfile(merged.catalog, selected)
    : merged.catalog;
  const enriched = enrichCatalog(scoped);

  try {
    validateCatalog(enriched.catalog);
  } catch (cause) {
    throw new Error(`the merged catalog is not valid: ${cause.message}`);
  }

  return { manifest, ...merged, catalog: enriched.catalog, derived: enriched.derived };
}
