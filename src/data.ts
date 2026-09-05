// Single entry point for catalog data.
//
// There is no master catalog. The app reads every source it can find, merges
// them, and validates the union - in that order, because referential integrity
// is a property of the whole estate and not of any one file. A service that
// publishes facts about itself next to its own code is a source; so is a
// hand-written file carrying the prose nobody can generate.
//
// Validation happens here, at startup, so a bad generator run is caught before
// anything is drawn. It is caught, not thrown: a validator that throws out of a
// module's top level takes the whole bundle down and the reader gets a blank
// page and a line in a console they are not looking at. So the failure is
// turned into a value, the app falls back to an empty catalog so every module
// below still imports, and the shell renders the error instead of the routes.

import { buildIndex, CatalogError, validateCatalog } from "./catalog";
import type { Catalog, CatalogIndex } from "./catalog";
import { enrichCatalog } from "./enrich";
import type { DerivedEdge } from "./enrich";
import { mergeCatalogs } from "./merge";
import type {
  CatalogSource,
  MergeConflict,
  SourceCatalog,
  SourceStamp,
} from "./merge";

/**
 * Where sources are looked for. The patterns are written out because
 * import.meta.glob resolves at build time and needs literals - and because
 * they are worth reading: the first is the estate's own files, the second is
 * what each service publishes beside its code - one level down for a context
 * of one service, two for a context that holds several.
 */
const SOURCE_GLOBS = [
  "data/*.json",
  "examples/*/portolan/*.json",
  "examples/*/*/portolan/*.json",
  "examples/*/*/*/portolan/*.json",
  "vendor/repos/*/*/git.repo.json",
  "vendor/repos/**/portolan/*.json",
] as const;

const modules: Record<string, unknown> = {
  ...import.meta.glob("../data/*.json", { eager: true, import: "default" }),
  ...import.meta.glob("../examples/*/portolan/*.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob("../examples/*/*/portolan/*.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob("../examples/*/*/*/portolan/*.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob("../vendor/repos/*/*/git.repo.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob("../vendor/repos/**/portolan/*.json", {
    eager: true,
    import: "default",
  }),
};

/** What the app draws when the catalog cannot be trusted: nothing. */
const EMPTY: Catalog = {
  generatedAt: "",
  commit: "",
  contexts: [],
  defs: {},
  flows: [],
  adrs: [],
};

interface Loaded {
  catalog: Catalog;
  sources: SourceStamp[];
  conflicts: MergeConflict[];
  derived: DerivedEdge[];
  error: CatalogError | null;
  /** The sources as merged, before anything was derived or checked. */
  raw: Catalog;
}

function load(): Loaded {
  const sources: CatalogSource[] = Object.entries(modules).map(
    ([path, catalog]) => ({
      // Vite keys a glob by its pattern-relative path; the leading ../ is an
      // artefact of this file's location, not part of where anything lives.
      path: path.replace(/^\.\.\//, ""),
      // A SOURCE, not a catalog: the two stamps are optional in a file, and
      // the estate's authored facts carry neither.
      catalog: catalog as SourceCatalog,
    }),
  );

  const merged = mergeCatalogs(sources);
  // Enriched before it is validated: the edges the flows imply are part of
  // the union the way a peer named by another source is, and the validator
  // resolves a step's call against them.
  const enriched = enrichCatalog(merged.catalog);

  try {
    return {
      catalog: validateCatalog(enriched.catalog),
      sources: merged.sources,
      conflicts: merged.conflicts,
      derived: enriched.derived,
      error: null,
      raw: merged.catalog,
    };
  } catch (cause) {
    const error =
      cause instanceof CatalogError
        ? cause
        : // Anything else is a shape the validator never got far enough to
          // name - a truncated file, a null where a list was expected. Same
          // treatment.
          new CatalogError(
            cause instanceof Error ? cause.message : String(cause),
          );

    return {
      catalog: EMPTY,
      sources: merged.sources,
      conflicts: merged.conflicts,
      derived: [],
      error,
      raw: merged.catalog,
    };
  }
}

const loaded = load();

export const catalog: Catalog = loaded.catalog;
export const index: CatalogIndex = buildIndex(catalog);

/**
 * The sources the catalog was built from, newest first by nothing at all -
 * they are in path order, which is the order the merge used.
 *
 * This is what the merged stamp is a summary of, and the summary is lossy in
 * both halves: one date stands for the oldest of many, and "6 sources" stands
 * for six shas the header has no room to print. The Overview stamp opens onto
 * this list, so a reader who wants to know WHICH part is a week old can find
 * out instead of being told a number and left with it. A source with an empty
 * stamp is one nobody generated.
 */
export const catalogSources: SourceStamp[] = loaded.sources;

/**
 * Sources disagreeing with each other. Not an error: two files both naming a
 * context is normal, and both naming it differently is a fact about the estate
 * that belongs on the Problems page rather than on a crash screen.
 */
export const catalogConflicts: MergeConflict[] = loaded.conflicts;

/**
 * Consumers and calls no source declared: what the flows said, written onto
 * the events and services after the merge. Each one names the step it was
 * read from, and the catalog above already contains it.
 */
export const derivedEdges: DerivedEdge[] = loaded.derived;

/**
 * Where the catalog is read from, as a reader would type it. Empty states name
 * it, so it is written once here rather than spelled out on five pages.
 */
export const CATALOG_PATH = SOURCE_GLOBS.join(" · ");

/** Non-null when the catalog failed validation; the shell renders it instead. */
export const catalogError: CatalogError | null = loaded.error;

/**
 * The merge before enrichment and validation: what the sources said, with
 * nothing derived onto it yet. Tests that check the validator, or that want
 * to see the estate the way a source wrote it, start from here.
 */
export const rawCatalog: Catalog = loaded.raw;
