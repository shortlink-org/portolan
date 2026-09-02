// The registry side of the catalog: schema modules, and who touches them.
//
// A module carries identity and inventory, not schema. Its interfaces are found
// through `RpcService.module` and their shapes live in `RpcService.messages` and
// `catalog.defs` — in ONE place, rather than two that can disagree. So almost
// everything here is a lookup through the index rather than a field read, and
// the module page is assembled from the catalog it already has.
//
// Every function answers empty for a catalog with no modules. That is the whole
// requirement the registry UI has to meet before it has any data: an estate that
// has never published a proto must render exactly as it did before.

import type {
  Catalog,
  CatalogIndex,
  InterfaceOwner,
  ProtoModule,
  RpcCall,
  Service,
} from "../catalog";
import { allModules } from "../catalog";

export function modules(catalog: Catalog): ProtoModule[] {
  return allModules(catalog);
}

export function moduleBySlug(
  index: CatalogIndex,
  slug: string,
): ProtoModule | undefined {
  return index.moduleBySlug.get(slug);
}

/**
 * The interfaces declared in a module, with the service that answers on each.
 *
 * This is the join the whole registry page hangs on, and it is one string
 * comparison: an interface says which module it came from, and its id is the
 * same `shop.v1.Orders` the estate already uses everywhere else.
 */
export function interfacesOf(
  index: CatalogIndex,
  module: ProtoModule,
): InterfaceOwner[] {
  return index.interfacesByModule.get(module.id) ?? [];
}

/** Every service that publishes the module, vendors it, or calls into it. */
export function servicesUsing(
  index: CatalogIndex,
  module: ProtoModule,
): Service[] {
  return index.servicesUsingModule.get(module.id) ?? [];
}

/**
 * The services that read the module without publishing it.
 *
 * The interesting fact about a module is usually who ELSE reads it, so the
 * owner is taken out rather than listed among its own consumers.
 */
export function consumersOf(
  index: CatalogIndex,
  module: ProtoModule,
): Service[] {
  return servicesUsing(index, module).filter(
    (service) => service.id !== module.owner,
  );
}

/** The calls made through a module's vendored copies, across the estate. */
export function callsThrough(
  catalog: Catalog,
  module: ProtoModule,
): { service: Service; call: RpcCall }[] {
  const out: { service: Service; call: RpcCall }[] = [];

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const call of service.consumes) {
        if (call.module === module.id) out.push({ service, call });
      }
    }
  }

  return out;
}

/** A dependency, resolved when the catalog holds it and named when it does not. */
export interface Dependency {
  id: string;
  module: ProtoModule | undefined;
}

/**
 * What a module depends on.
 *
 * A dangling dep is normal rather than broken: a module may depend on one the
 * estate never vendored, and the honest answer is to name it and say the
 * catalog does not hold it.
 */
export function dependenciesOf(
  index: CatalogIndex,
  module: ProtoModule,
): Dependency[] {
  return (module.deps ?? []).map((id) => ({
    id,
    module: index.moduleById.get(id),
  }));
}

/** The modules that depend on this one, in catalog order. */
export function dependentsOf(
  catalog: Catalog,
  module: ProtoModule,
): ProtoModule[] {
  return allModules(catalog).filter((other) =>
    (other.deps ?? []).includes(module.id),
  );
}

/** What the module page counts, so the header and the tabs agree. */
export interface ModuleCounts {
  packages: number;
  interfaces: number;
  methods: number;
  messages: number;
  deps: number;
  consumers: number;
}

export function countsOf(
  index: CatalogIndex,
  module: ProtoModule,
): ModuleCounts {
  const declared = interfacesOf(index, module);

  // Messages are counted by NAME across the module's interfaces: two
  // interfaces both moving a `Money` are moving one type, and counting it
  // twice would say the module holds more than it does.
  const messages = new Set<string>();
  for (const { provided } of declared) {
    for (const message of provided.messages ?? []) messages.add(message.name);
  }

  return {
    packages: module.packages.length,
    interfaces: declared.length,
    methods: declared.reduce(
      (n, { provided }) => n + provided.methods.length,
      0,
    ),
    messages: messages.size,
    deps: (module.deps ?? []).length,
    consumers: consumersOf(index, module).length,
  };
}

/**
 * The interfaces of a module grouped by the proto package they sit in.
 *
 * Packages come from the module's own inventory, so a package holding only
 * messages still appears — a module is not only the interfaces in it.
 */
export interface ModulePackage {
  name: string;
  interfaces: InterfaceOwner[];
}

export function packagesOf(
  index: CatalogIndex,
  module: ProtoModule,
): ModulePackage[] {
  const declared = interfacesOf(index, module);
  const names = [...module.packages];

  // An interface whose package the inventory does not list is still real: the
  // module was described by one source and the interface by another, and the
  // page should show what it has rather than hide the disagreement.
  for (const { provided } of declared) {
    const name = packageOf(provided.id);
    if (name && !names.includes(name)) names.push(name);
  }

  return names.map((name) => ({
    name,
    interfaces: declared.filter(
      ({ provided }) => packageOf(provided.id) === name,
    ),
  }));
}

/** The proto package of `shop.v1.Orders`: everything before the last segment. */
export function packageOf(interfaceId: string): string {
  const at = interfaceId.lastIndexOf(".");

  return at < 0 ? "" : interfaceId.slice(0, at);
}

/** Where a module can be read on the web, when it was published somewhere. */
export function registryUrl(module: ProtoModule): string | null {
  if (!module.registry) return null;

  const at = module.commit ? `/tree/${module.commit}` : "";

  return `https://${module.registry}/${module.name}${at}`;
}

/**
 * Modules matching a sidebar query, keeping the packages that matched.
 *
 * The `matchStores` contract: a hit on the module keeps everything inside it,
 * and otherwise only what matched survives.
 */
export interface ModuleMatch {
  module: ProtoModule;
  packages: string[];
}

export function matchModules(
  all: ProtoModule[],
  hit: (...fields: string[]) => boolean,
): ModuleMatch[] {
  const out: ModuleMatch[] = [];

  for (const module of all) {
    const matched = hit(
      module.id,
      module.name,
      module.slug,
      module.registry ?? "",
    );
    const packages = matched
      ? module.packages
      : module.packages.filter((name) => hit(name));
    if (matched || packages.length > 0) out.push({ module, packages });
  }

  return out;
}
