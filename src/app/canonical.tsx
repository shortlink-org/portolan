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
