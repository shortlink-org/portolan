import type { Catalog } from "./catalog";
import { workItemTargetExists } from "./lib/work-items.ts";
import { annotationTargetExists } from "./lib/annotations.mjs";
import { globToRegExp, matchesSourceGlobs } from "./lib/source-glob.ts";

export interface CatalogProfile {
  id: string;
  title: string;
  /** Catalog fragments merged for this profile. */
  sources: string[];
  /** Dedicated workspace directory containing authored resource properties. */
  annotations?: string;
  /** Top-level groups retained after the profile sources are merged. */
  contexts: string[];
  /** Projects shown as belonging to this profile in setup UI. */
  projects: string[];
}

export interface CatalogProfileManifest {
  annotations?: string;
  defaultCatalog?: string;
  catalogs?: CatalogProfile[];
}

/** The historical single-estate manifest is one implicit catalog. */
export function catalogProfiles(
  manifest: CatalogProfileManifest & { sources?: string[] },
): CatalogProfile[] {
  if (manifest.catalogs?.length) return manifest.catalogs;
  return [
    {
      id: "default",
      title: "Catalog",
      sources: manifest.sources ?? [],
      ...(manifest.annotations ? { annotations: manifest.annotations } : {}),
      contexts: [],
      projects: [],
    },
  ];
}

export function defaultCatalogProfile(
  manifest: CatalogProfileManifest & { sources?: string[] },
): CatalogProfile {
  const profiles = catalogProfiles(manifest);
  return (
    profiles.find((profile) => profile.id === manifest.defaultCatalog) ??
    profiles[0]!
  );
}

export function catalogProfileNamed(
  manifest: CatalogProfileManifest & { sources?: string[] },
  id: string | null | undefined,
): CatalogProfile {
  const profiles = catalogProfiles(manifest);
  return profiles.find((profile) => profile.id === id) ?? defaultCatalogProfile(manifest);
}

export { globToRegExp };

export function profileIncludesSource(profile: CatalogProfile, path: string): boolean {
  return matchesSourceGlobs(profile.sources, path);
}

/**
 * A source such as a shared CODEOWNERS overlay can describe more than one
 * estate. Source selection removes almost all foreign facts; this final cut
 * keeps such overlays from reintroducing another profile's top-level group.
 */
export function filterCatalogForProfile(catalog: Catalog, profile: CatalogProfile): Catalog {
  const annotations = catalog.annotations?.filter((entry) => entry.catalog === profile.id);
  if (profile.contexts.length === 0) return annotations ? { ...catalog, annotations } : catalog;
  const contexts = new Set(profile.contexts);
  const selectedContexts = catalog.contexts.filter((context) => contexts.has(context.id));
  const services = new Set(selectedContexts.flatMap((context) => context.services.map((service) => service.id)));

  const scoped: Catalog = {
    ...catalog,
    contexts: selectedContexts,
    flows: catalog.flows.filter((flow) => contexts.has(flow.owner)),
    adrs: catalog.adrs.filter((adr) => {
      if (adr.scope.kind === "org") return true;
      if (adr.scope.kind === "context") return contexts.has(adr.scope.context);
      return services.has(adr.scope.service);
    }),
    rfcs: (catalog.rfcs ?? []).filter((rfc) => {
      if (rfc.scope.kind === "org") return true;
      if (rfc.scope.kind === "context") return contexts.has(rfc.scope.context);
      return services.has(rfc.scope.service);
    }),
    stores: (catalog.stores ?? []).filter((store) => services.has(store.owner)),
    terms: (catalog.terms ?? []).filter((term) => contexts.has(term.context)),
    modules: (catalog.modules ?? []).filter((module) => !module.owner || services.has(module.owner)),
  };
  if (catalog.workItemLinks) {
    scoped.workItemLinks = catalog.workItemLinks.filter((link) => workItemTargetExists(scoped, link.target));
    const used = new Set(scoped.workItemLinks.map((link) => link.workItem));
    scoped.workItems = (catalog.workItems ?? []).filter((item) => used.has(item.id));
  }
  if (annotations) scoped.annotations = annotations.filter((entry) => entry.unresolved || annotationTargetExists(scoped, entry.target));
  return scoped;
}
