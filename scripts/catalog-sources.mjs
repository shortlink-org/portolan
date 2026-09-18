// Reads every catalog source the manifest names, merges them, and validates
// the union.
//
// Shared by the generator runner and the LikeC4 generator so the two cannot
// disagree about what the estate is. Merging before validating is the point:
// referential integrity holds over the union, and a fragment naming a peer it
// does not own is normal rather than broken.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, normalize, resolve } from "node:path";
import { readAnnotations } from "./annotations.mjs";
import { applyAnnotations } from "../src/lib/annotations.mjs";

import { validateCatalog } from "../src/catalog.ts";
import { filterCatalogForProfile } from "../src/catalog-profile.ts";
import { enrichCatalog } from "../src/enrich.ts";
import { mergeCatalogs } from "../src/merge.ts";
import { stampsFor } from "./history.mjs";
import { readManifest } from "./manifest.mjs";

/**
 * `exclude` names source files to leave out, as the manifest would spell
 * them. It exists for the verify phase: a step that writes a fragment from
 * what it observed must be shown the catalog WITHOUT its own last output, or
 * what it wrote last time would count as what it saw this time.
 *
 * Source patterns are relative to `cwd`, the workspace; the generator runs in
 * it, and a reader elsewhere (the site's task links) says where it is.
 */
export async function loadCatalog(manifestPath = "portolan.json", { exclude = [], profile, cwd = process.cwd() } = {}) {
  const manifest = readManifest(manifestPath);
  const excluded = new Set(exclude.map((path) => normalize(path)));
  const selected = profile
    ? (manifest.catalogs ?? []).find((candidate) => candidate.id === profile)
    : null;
  if (profile && !selected) {
    throw new Error(`${manifestPath}: unknown catalog profile ${JSON.stringify(profile)}`);
  }
  const patterns = selected?.sources ?? manifest.sources ?? [];

  const paths = [];
  for await (const path of glob(patterns, { cwd })) {
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

  // A source is dated by the history, not by itself (portolan.0010): the
  // commit that last changed the file, and its date, read here and never
  // written into the file.
  const entries = readAnnotations(dirname(resolve(manifestPath)), manifest).filter((entry) => !profile || entry.catalog === profile);
  const annotationStamps = stampsFor(dirname(resolve(manifestPath)), entries.map((entry) => entry.source));
  const stamps = stampsFor(cwd, paths);
  const merged = mergeCatalogs(
    [...paths.map((path) => ({
      path,
      catalog: JSON.parse(readFileSync(resolve(cwd, path), "utf8")),
      stamp: stamps.get(path),
    })), ...entries.map((entry) => ({ path: entry.source, catalog: { contexts: [], defs: {}, flows: [], adrs: [] }, stamp: annotationStamps.get(entry.source) }))],
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
  const annotated = applyAnnotations(merged.catalog, entries, profile);
  const scoped = selected
    ? filterCatalogForProfile(annotated, selected)
    : annotated;
  const enriched = enrichCatalog(scoped);
  for (const entry of enriched.catalog.annotations ?? []) {
    if (entry.unresolved) merged.conflicts.push({ path: entry.source, where: entry.target.id, message: `Custom properties target missing ${entry.target.kind} ${entry.target.id}; preserve or retarget ${entry.source}.` });
  }

  try {
    validateCatalog(enriched.catalog);
  } catch (cause) {
    throw new Error(`the merged catalog is not valid: ${cause.message}`);
  }

  // `verifierCatalog` is what a verify step is handed (portolan.0031): the
  // estate enriched - every edge the flows imply, so a call or a consumer a
  // recording shows is known by the id the reader knows it by - and the flows
  // as their sources declared them. A verifier lays what it saw over a flow
  // and writes the flow back, and the merge lays that over the declaration
  // step for step; a flow handed over enriched came back carrying what the
  // enrichment derived - the method an endpoint answers (portolan.0025), the
  // responses synthesized for its exits, a callee composed into it - and the
  // merge refused the whole overlay as a different flow.
  return {
    manifest,
    ...merged,
    catalog: enriched.catalog,
    derived: enriched.derived,
    verifierCatalog: { ...enriched.catalog, flows: scoped.flows },
  };
}
