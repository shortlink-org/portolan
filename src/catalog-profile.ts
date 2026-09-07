import type { Catalog } from "./catalog";

export interface CatalogProfile {
  id: string;
  title: string;
  /** Catalog fragments merged for this profile. */
  sources: string[];
  /** Top-level groups retained after the profile sources are merged. */
  contexts: string[];
  /** Projects shown as belonging to this profile in setup UI. */
  projects: string[];
}

export interface CatalogProfileManifest {
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

/** Match the source globs used by the manifest without bringing a Node globber into the browser. */
export function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char !== "*") {
      source += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
      continue;
    }
    if (glob[i + 1] === "*") {
      i++;
      source += glob[i + 1] === "/" ? "(?:.*/)?" : ".*";
      if (glob[i + 1] === "/") i++;
    } else {
      source += "[^/]*";
    }
  }
  return new RegExp(`${source}$`);
}

export function profileIncludesSource(profile: CatalogProfile, path: string): boolean {
  return profile.sources.some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * A source such as a shared CODEOWNERS overlay can describe more than one
 * estate. Source selection removes almost all foreign facts; this final cut
 * keeps such overlays from reintroducing another profile's top-level group.
 */
export function filterCatalogForProfile(catalog: Catalog, profile: CatalogProfile): Catalog {
  if (profile.contexts.length === 0) return catalog;
  const contexts = new Set(profile.contexts);
  const selectedContexts = catalog.contexts.filter((context) => contexts.has(context.id));
  const services = new Set(selectedContexts.flatMap((context) => context.services.map((service) => service.id)));

  return {
    ...catalog,
    contexts: selectedContexts,
    flows: catalog.flows.filter((flow) => contexts.has(flow.owner)),
    adrs: catalog.adrs.filter((adr) => {
      if (adr.scope.kind === "org") return true;
      if (adr.scope.kind === "context") return contexts.has(adr.scope.context);
      return services.has(adr.scope.service);
    }),
    stores: (catalog.stores ?? []).filter((store) => services.has(store.owner)),
    terms: (catalog.terms ?? []).filter((term) => contexts.has(term.context)),
    modules: (catalog.modules ?? []).filter((module) => !module.owner || services.has(module.owner)),
  };
}
