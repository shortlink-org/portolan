// One URL per entity, whichever name the reader pasted.
//
// A page is routed by its slug, but the id is what the reader sees everywhere
// else: a warning, the CLI, `portolan diff`, a work item's target, a markdown
// doc. Pasting `/flows/flow.checkout` should land on the flow, and land on it
// at `/flows/checkout`, so a link copied from the address bar afterwards is
// the canonical one. A value that is neither stays the page's own not-found.

import type { ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import type { CatalogIndex } from "../catalog";
import { paths } from "../routes";
import { selectionHash } from "../selection/hash";

/** The slug a page's route value stands for, when the value is an id rather than a slug. */
export type SlugForId = (index: CatalogIndex, value: string) => string | undefined;

/**
 * A slug wins over an id: the route was written for slugs, and a slug that
 * happens to spell another entity's id must still open its own page.
 */
function bySlugOrId<T extends { slug: string }>(
  slugs: (index: CatalogIndex) => Map<string, T>,
  ids: (index: CatalogIndex) => Map<string, T>,
): SlugForId {
  return (index, value) => (slugs(index).has(value) ? undefined : ids(index).get(value)?.slug);
}

export const slugForId = {
  flow: bySlugOrId((i) => i.flowBySlug, (i) => i.flowById),
  adr: bySlugOrId((i) => i.adrBySlug, (i) => i.adrById),
  rfc: bySlugOrId((i) => i.rfcBySlug, (i) => i.rfcById),
  module: bySlugOrId((i) => i.moduleBySlug, (i) => i.moduleById),
  external: ((index, value) => {
    if ((index.catalog.externals ?? []).some((external) => external.slug === value)) return undefined;
    return index.externalById.get(value)?.slug;
  }) satisfies SlugForId,
};

/**
 * Replaces an id in the route with its slug before the page renders, keeping
 * the query and the hash - a selected step or an open section survives.
 */
export function CanonicalSlug({
  index,
  param,
  slugFor,
  path,
  children,
}: {
  index: CatalogIndex;
  /** The route parameter holding the slug, e.g. "flow" for `/flows/:flow`. */
  param: string;
  slugFor: SlugForId;
  path: (slug: string) => string;
  children: ReactNode;
}) {
  const value = useParams()[param];
  const { search, hash } = useLocation();
  const slug = value ? slugFor(index, value) : undefined;
  if (slug !== undefined) return <Navigate to={`${path(slug)}${search}${hash}`} replace />;
  return children;
}

/**
 * The page a catalog id opens, whatever kind of thing it names.
 *
 * Tried in a fixed order so an id two kinds could spell always lands on the
 * same page. A term goes last: its id has a service's shape,
 * `<context>.<name>`, and a pasted `shop.oms` means the service.
 */
export function pathForId(index: CatalogIndex, id: string): string | undefined {
  const inService = (serviceId: string) => {
    const service = index.serviceById.get(serviceId);
    const context = index.serviceContext.get(serviceId);
    return service && context ? { service, context } : undefined;
  };
  const storeAt = (storeId: string) => {
    const store = index.storeById.get(storeId);
    const owner = store ? inService(store.owner) : undefined;
    return store && owner ? paths.store(owner.context.id, owner.service.slug, store.slug) : undefined;
  };

  if (index.catalog.contexts.some((context) => context.id === id)) return paths.context(id);
  const service = inService(id);
  if (service) return paths.service(service.context.id, service.service.slug);

  const aggregate = index.aggregateById.get(id);
  const aggregateOwner = index.aggregateOwner.get(id);
  const aggregateAt = aggregateOwner ? inService(aggregateOwner.id) : undefined;
  if (aggregate && aggregateAt) {
    return paths.aggregate(aggregateAt.context.id, aggregateAt.service.slug, aggregate.slug);
  }

  const event = index.eventById.get(id);
  const eventOwner = index.eventOwner.get(id);
  const eventAt = eventOwner ? inService(eventOwner.service.id) : undefined;
  if (event && eventOwner && eventAt) {
    return paths.event(eventAt.context.id, eventOwner.service.slug, eventOwner.aggregate.slug, event.slug);
  }

  const block = index.blockById.get(id);
  if (block) {
    const build = block.kind === "vo" ? paths.valueObject : paths.entity;
    return build(block.context.id, block.service.slug, block.aggregate.slug, block.block.slug);
  }
  const item = index.enumById.get(id);
  if (item) return paths.enum(item.context.id, item.service.slug, item.aggregate.slug, item.enum.slug);

  const store = storeAt(id);
  if (store) return store;
  // A table or a view has no page: its store's canvas, with it selected.
  const table = index.tableById.get(id);
  const tableStore = table ? storeAt(table.store.id) : undefined;
  if (tableStore) return `${tableStore}${selectionHash({ kind: "table", id })}`;
  const view = index.viewById.get(id);
  const viewStore = view ? storeAt(view.store.id) : undefined;
  if (viewStore) return `${viewStore}${selectionHash({ kind: "view", id })}`;

  const flow = index.flowById.get(id);
  if (flow) return paths.flow(flow.slug);
  const adr = index.adrById.get(id);
  if (adr) return paths.adr(adr.slug);
  const rfc = index.rfcById.get(id);
  if (rfc) return paths.rfc(rfc.slug);
  const module = index.moduleById.get(id);
  if (module) return paths.module(module.slug);
  const external = index.externalById.get(id);
  if (external) return paths.external(external.slug);
  if (index.termById.has(id)) return paths.term(id);
  return undefined;
}

/**
 * A resolved page joined with the query and hash the reader arrived with. The
 * reader's hash wins over one the page brings (a table's selection): they
 * pasted it, so it is the more specific of the two.
 */
export function withArrival(to: string, search: string, hash: string): string {
  const at = to.indexOf("#");
  const base = at < 0 ? to : to.slice(0, at);
  const own = at < 0 ? "" : to.slice(at);
  const query = search.replace(/^\?/, "");
  const joined = query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base;
  return `${joined}${hash || own}`;
}

/**
 * `/id/<catalog id>`: one entry for every id a reader meets away from its page
 * - a warning, the CLI, `portolan diff`, a work item's target, a markdown doc.
 * The id is the rest of the path, slashes and all, because a module's id is a
 * BSR path. It replaces itself with the page's own URL; an id nothing answers
 * to renders `notFound` where it stands.
 */
export function IdEntry({ index, notFound }: { index: CatalogIndex; notFound: ReactNode }) {
  const id = useParams()["*"];
  const { search, hash } = useLocation();
  const to = id ? pathForId(index, id) : undefined;
  if (to === undefined) return notFound;
  return <Navigate to={withArrival(to, search, hash)} replace />;
}
