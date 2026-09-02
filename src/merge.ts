// Merging sources into one catalog.
//
// The estate is not written down in one place. A service publishes facts about
// itself next to its own code, an authored file carries the prose nobody can
// generate, and what a reader sees is the union. There is no master file, and
// deliberately so: a single catalog.json would have to be written by whoever
// owns the repository it lives in, which is exactly the bottleneck this avoids.
//
// Two things follow from that, and both are the point rather than the cost:
//
//  - Merging happens BEFORE validation. Referential integrity is a property of
//    the union, not of any one source, so a source that names a peer it does
//    not own is normal rather than broken.
//  - A conflict is a value, not an exception. Two sources disagreeing about a
//    context's name is a fact about the estate that belongs on the Problems
//    page, next to the other things that are true and unfortunate.

import type { BoundedContext, Catalog, Service, TypeDef } from "./catalog";

/** One file, parsed. */
export interface CatalogSource {
  /** Where it was read from, as a reader would type it. */
  path: string;
  catalog: Catalog;
}

/**
 * When a source was generated and from what. This is per-source and never
 * merged into one number: a catalog whose domain facts are a day old and whose
 * schema facts are a month old is not "three weeks stale", it is two claims of
 * different ages, and averaging them hides the one that matters.
 */
export interface SourceStamp {
  path: string;
  generatedAt: string;
  commit: string;
}

export interface MergeConflict {
  /** The source that lost - the one whose value was not taken. */
  path: string;
  /** What the conflict is about, as a catalog id. */
  where: string;
  message: string;
}

export interface MergeResult {
  catalog: Catalog;
  sources: SourceStamp[];
  conflicts: MergeConflict[];
}

/**
 * Merges sources in path order, so the result never depends on the order a
 * glob happened to return.
 *
 * First writer wins for anything scalar, and the loser is recorded rather than
 * dropped silently. Lists are unioned by id.
 */
export function mergeCatalogs(sources: CatalogSource[]): MergeResult {
  const ordered = [...sources].sort((a, b) => a.path.localeCompare(b.path));
  const conflicts: MergeConflict[] = [];

  const contexts = new Map<string, BoundedContext>();
  const contextOrigin = new Map<string, string>();
  const services = new Map<string, Service>();
  const serviceOrigin = new Map<string, string>();
  const defs: Record<string, TypeDef> = {};
  const defOrigin = new Map<string, string>();
  const flows: Catalog["flows"] = [];
  const adrs: Catalog["adrs"] = [];
  const stores: NonNullable<Catalog["stores"]> = [];
  const modules: NonNullable<Catalog["modules"]> = [];
  const seen = new Map<string, string>(); // flow/adr/store/module id -> source path

  const stamps: SourceStamp[] = ordered.map((source) => ({
    path: source.path,
    generatedAt: source.catalog.generatedAt,
    commit: source.catalog.commit,
  }));

  for (const { path, catalog } of ordered) {
    for (const context of catalog.contexts) {
      const existing = contexts.get(context.id);
      if (!existing) {
        // The services list is filled from the merge below, not copied: a
        // service can be described by several sources at once, and the context
        // has to end up holding the merged one rather than the first arrival.
        contexts.set(context.id, { ...context, services: [] });
        contextOrigin.set(context.id, path);
      } else {
        // A second source may add services to a context somebody else named.
        // What it may not do is quietly rename it.
        const owner = contextOrigin.get(context.id) ?? "";
        // First NON-EMPTY wins, not first. A fragment describing one aspect of
        // a service leaves the fields it knows nothing about empty, and it can
        // easily sort before the one that fills them in - so an empty value
        // yields rather than winning and calling the real one a conflict.
        for (const field of ["name", "summary"] as const) {
          const theirs = context[field];
          if (!theirs) continue;
          if (!existing[field]) {
            existing[field] = theirs;

            continue;
          }
          if (theirs !== existing[field]) {
            conflicts.push({
              path,
              where: context.id,
              message: `context "${context.id}" has ${field} "${theirs}" here and "${existing[field]}" in ${owner}; the first one is used`,
            });
          }
        }

        // Classification is its own line only because it is not a plain string:
        // the same rule, spelled where the type can see it.
        if (context.classification) {
          if (!existing.classification) {
            existing.classification = context.classification;
          } else if (existing.classification !== context.classification) {
            conflicts.push({
              path,
              where: context.id,
              message: `context "${context.id}" is classified ${context.classification} here and ${existing.classification} in ${owner}; the first one is used`,
            });
          }
        }
      }

      for (const service of context.services) {
        mergeService(services, serviceOrigin, service, path, conflicts);
      }
    }

    for (const [key, def] of Object.entries(catalog.defs)) {
      const existing = defs[key];
      if (existing === undefined) {
        defs[key] = def;
        defOrigin.set(key, path);

        continue;
      }
      // Shared types live in one namespace on purpose: `ref` is a bare key, so
      // two sources meaning different things by "Money" is a real problem and
      // not one a prefix would solve - it would only make it invisible.
      if (JSON.stringify(existing) !== JSON.stringify(def)) {
        conflicts.push({
          path,
          where: `defs.${key}`,
          message: `shared type "${key}" is defined differently here than in ${defOrigin.get(key)}; the first one is used`,
        });
      }
    }

    for (const flow of catalog.flows) {
      if (claim(seen, flow.id, path, conflicts, "flow")) flows.push(flow);
    }
    for (const adr of catalog.adrs) {
      if (claim(seen, adr.id, path, conflicts, "ADR")) adrs.push(adr);
    }
    for (const store of catalog.stores ?? []) {
      if (claim(seen, store.id, path, conflicts, "store")) stores.push(store);
    }
    // Claimed by id like everything else at this level, and that is exactly why
    // a module's id is its registry-global name rather than one derived from an
    // owner: the producer and each consumer describe the same module from
    // different repositories, and only a shared id makes them one entry here.
    for (const module of catalog.modules ?? []) {
      if (claim(seen, module.id, path, conflicts, "module"))
        modules.push(module);
    }
  }

  // Services go back into their contexts once every source has been read, in
  // the order they were first declared.
  for (const service of services.values()) {
    const contextID = service.id.slice(0, service.id.indexOf("."));
    contexts.get(contextID)?.services.push(service);
  }

  const merged: Catalog = {
    // The oldest stamp, because a merged catalog is exactly as fresh as its
    // stalest part. Per-source stamps travel alongside for anything that wants
    // to be precise about which part that is.
    generatedAt: oldest(stamps.map((s) => s.generatedAt)),
    commit: describeCommits(stamps),
    contexts: [...contexts.values()],
    defs,
    flows,
    adrs,
  };
  if (stores.length > 0) merged.stores = stores;
  if (modules.length > 0) merged.modules = modules;

  return { catalog: merged, sources: stamps, conflicts };
}

/**
 * Merges one service into the set.
 *
 * This is what lets a service be described by more than one source at a time,
 * which is the whole point of extracting each aspect separately: one generator
 * reads the domain and knows the aggregates, another reads the OpenAPI spec and
 * knows what the service answers, and neither has to know about the other.
 *
 * Lists are unioned by id; scalars keep the first value and record the loser.
 */
function mergeService(
  services: Map<string, Service>,
  origin: Map<string, string>,
  incoming: Service,
  path: string,
  conflicts: MergeConflict[],
): void {
  const existing = services.get(incoming.id);
  if (!existing) {
    services.set(incoming.id, {
      ...incoming,
      provides: [...incoming.provides],
      consumes: [...incoming.consumes],
      aggregates: [...incoming.aggregates],
      ...(incoming.stores ? { stores: [...incoming.stores] } : {}),
      ...(incoming.modules ? { modules: [...incoming.modules] } : {}),
    });
    origin.set(incoming.id, path);

    return;
  }

  const owner = origin.get(incoming.id) ?? "";
  for (const field of ["name", "repo", "path", "readme"] as const) {
    const theirs = incoming[field];
    if (!theirs) continue;
    if (!existing[field]) {
      existing[field] = theirs;

      continue;
    }
    if (theirs !== existing[field]) {
      conflicts.push({
        path,
        where: incoming.id,
        message: `service "${incoming.id}" has a different ${field} here than in ${owner}; the first one is used`,
      });
    }
  }

  appendNew(existing.provides, incoming.provides, (p) => p.id);
  appendNew(existing.consumes, incoming.consumes, (c) => c.id);
  appendNew(existing.aggregates, incoming.aggregates, (a) => a.id);

  if (incoming.stores?.length) {
    const stores = existing.stores ?? [];
    for (const id of incoming.stores) if (!stores.includes(id)) stores.push(id);
    existing.stores = stores;
  }

  if (incoming.modules?.length) {
    const modules = existing.modules ?? [];
    for (const id of incoming.modules)
      if (!modules.includes(id)) modules.push(id);
    existing.modules = modules;
  }
}

/** Appends the entries whose id is not already present. */
function appendNew<T>(into: T[], from: T[], id: (item: T) => string): void {
  const seen = new Set(into.map(id));
  for (const item of from) {
    if (seen.has(id(item))) continue;
    seen.add(id(item));
    into.push(item);
  }
}

/**
 * Records who owns an id. Returns false when somebody already did, which is
 * how a duplicate is skipped rather than appended twice.
 */
function claim(
  owners: Map<string, string>,
  id: string,
  path: string,
  conflicts: MergeConflict[],
  kind: string,
): boolean {
  const owner = owners.get(id);
  if (owner === undefined) {
    owners.set(id, path);

    return true;
  }

  conflicts.push({
    path,
    where: id,
    message: `${kind} "${id}" is already declared in ${owner}; the one here is ignored`,
  });

  return false;
}

function oldest(stamps: string[]): string {
  const known = stamps.filter(Boolean).sort();

  return known[0] ?? "";
}

/**
 * What to show where a single commit used to be. One source keeps its sha; more
 * than one, all agreeing, keeps it too - and a genuine spread says so rather
 * than picking a winner and looking precise.
 */
function describeCommits(stamps: SourceStamp[]): string {
  const commits = [...new Set(stamps.map((s) => s.commit).filter(Boolean))];
  if (commits.length === 1) return commits[0] ?? "";
  if (commits.length === 0) return "";

  return `${commits.length} sources`;
}

/** Every service in the merged catalog, flattened. Callers want this constantly. */
export function services(catalog: Catalog): Service[] {
  return catalog.contexts.flatMap((context) => context.services);
}
