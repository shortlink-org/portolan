import type { Adr, Catalog } from "../catalog-model.ts";
import { safeWorkItemUrl } from "../lib/work-items.ts";
import { allRfcs, allServices, allTerms } from "../catalog-model.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";

/**
 * A term belongs to a context that exists, and its id says which one.
 *
 * The composition check is the one that earns its place. A glossary sits
 * beside a SERVICE and the words in it belong to a context, so the extractor
 * has to be told which - and told nothing, it falls back to the directory's
 * name. Left that way, `examples/shop/oms/GLOSSARY.md` produces `oms.order`
 * in a context called `oms` that nothing else in the estate has heard of, and
 * every one of its terms is a word the reader can never find from the page
 * that uses it. Failing here names the step; the alternative is a vocabulary
 * that loads and answers nothing.
 */
export function validateTerms(catalog: Catalog): void {
  const contextIds = new Set(catalog.contexts.map((c) => c.id));
  const ids = new Set<string>();

  for (const term of allTerms(catalog)) {
    const where = `term ${term.id}`;
    if (term.id !== `${term.context}.${term.slug}`) {
      fail(
        `term "${term.id}" must have id "${term.context}.${term.slug}"`,
        where,
      );
    }
    if (ids.has(term.id)) fail(`term id "${term.id}" is not unique`, where);
    ids.add(term.id);
    if (!term.name) fail(`term "${term.id}" has no name`, where);
    if (!term.definition) {
      fail(`term "${term.id}" says nothing about what it is`, where);
    }
    if (!contextIds.has(term.context)) {
      fail(
        `term "${term.id}" belongs to context "${term.context}", which the catalog does not declare`,
        where,
      );
    }
  }
}

/**
 * A decision record may only point at things that exist. A dangling relates
 * entry or a half-written supersession would let the UI draw a link to
 * nowhere, so both fail the build instead.
 */
export function validateAdrs(catalog: Catalog, eventIds: Set<string>): void {
  if (!Array.isArray(catalog.adrs)) fail("catalog.adrs is missing", "catalog");

  const serviceIds = new Set(allServices(catalog).map((s) => s.id));
  const contextIds = new Set(catalog.contexts.map((c) => c.id));
  const flowSlugs = new Set(catalog.flows.map((f) => f.slug));

  assertUniqueSlugs(
    catalog.adrs.map((a) => a.slug),
    "catalog",
    "adr",
  );

  const byId = new Map<string, Adr>();
  for (const adr of catalog.adrs) {
    if (byId.has(adr.id))
      fail(`adr id "${adr.id}" is not unique`, `decision ${adr.id}`);
    byId.set(adr.id, adr);
  }

  for (const adr of catalog.adrs) {
    const padded = String(adr.number).padStart(4, "0");
    if (!adr.id.endsWith(`.${padded}`)) {
      fail(
        `adr "${adr.id}" must end with its number, "${padded}"`,
        `decision ${adr.id}`,
      );
    }
    if (Number.isNaN(new Date(adr.date).getTime())) {
      fail(
        `adr "${adr.id}" has an unparseable date "${adr.date}"`,
        `decision ${adr.id}`,
      );
    }

    switch (adr.scope.kind) {
      case "context":
        if (!contextIds.has(adr.scope.context)) {
          fail(
            `adr "${adr.id}" is scoped to unknown context "${adr.scope.context}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "service":
        if (!serviceIds.has(adr.scope.service)) {
          fail(
            `adr "${adr.id}" is scoped to unknown service "${adr.scope.service}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "org":
        break;
    }

    for (const serviceId of adr.relates.services ?? []) {
      if (!serviceIds.has(serviceId)) {
        fail(
          `adr "${adr.id}" relates to unknown service "${serviceId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const eventId of adr.relates.events ?? []) {
      if (!eventIds.has(eventId)) {
        fail(
          `adr "${adr.id}" relates to unknown event "${eventId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const flowSlug of adr.relates.flows ?? []) {
      if (!flowSlugs.has(flowSlug)) {
        fail(
          `adr "${adr.id}" relates to unknown flow "${flowSlug}"`,
          `decision ${adr.id}`,
        );
      }
    }

    // Supersession is a two-way fact. Recording one half of it is a bug in
    // whatever wrote the catalog, not a display problem to paper over.
    if (adr.status === "superseded" && !adr.supersededBy) {
      fail(
        `adr "${adr.id}" is superseded but names no supersededBy`,
        `decision ${adr.id}`,
      );
    }
    if (adr.supersededBy !== undefined) {
      if (adr.status !== "superseded") {
        fail(
          `adr "${adr.id}" names supersededBy "${adr.supersededBy}" but its status is "${adr.status}", not "superseded"`,
          `decision ${adr.id}`,
        );
      }
      const successor = byId.get(adr.supersededBy);
      if (!successor) {
        fail(
          `adr "${adr.id}" is superseded by unknown adr "${adr.supersededBy}"`,
          `decision ${adr.id}`,
        );
      } else if (!(successor.supersedes ?? []).includes(adr.id)) {
        fail(
          `adr "${adr.id}" is superseded by "${successor.id}", but "${successor.id}" does not list it in supersedes`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const supersededId of adr.supersedes ?? []) {
      const predecessor = byId.get(supersededId);
      if (!predecessor) {
        fail(
          `adr "${adr.id}" supersedes unknown adr "${supersededId}"`,
          `decision ${adr.id}`,
        );
      } else if (predecessor.supersededBy !== adr.id) {
        fail(
          `adr "${adr.id}" supersedes "${supersededId}", but "${supersededId}" is not marked superseded by it`,
          `decision ${adr.id}`,
        );
      }
    }
  }
}

export function validateRfcs(catalog: Catalog, eventIds: Set<string>): void {
  const rfcs = allRfcs(catalog);
  const serviceIds = new Set(allServices(catalog).map((service) => service.id));
  const contextIds = new Set(catalog.contexts.map((context) => context.id));
  const flowSlugs = new Set(catalog.flows.map((flow) => flow.slug));
  const adrIds = new Set(catalog.adrs.map((adr) => adr.id));
  const rfcIds = new Set<string>();
  const lifecycles = new Set([
    "draft", "discussion", "accepted", "implemented", "rejected",
    "postponed", "withdrawn", "abandoned", "superseded", "unknown",
  ]);
  const sourceKinds = new Set(["file", "github-issue", "github-pr"]);
  const relations = new Set(["formalized-by", "informed-by", "supersedes", "related"]);

  assertUniqueSlugs(rfcs.map((rfc) => rfc.slug), "catalog", "rfc");
  for (const rfc of rfcs) {
    const where = `rfc ${rfc.id || "?"}`;
    if (!rfc.id) fail("an rfc has no id", where);
    if (rfcIds.has(rfc.id)) fail(`rfc id "${rfc.id}" is not unique`, where);
    rfcIds.add(rfc.id);
    if (!rfc.displayId) fail(`rfc "${rfc.id}" has no displayId`, where);
    if (!rfc.title) fail(`rfc "${rfc.id}" has no title`, where);
    if (!rfc.status) fail(`rfc "${rfc.id}" has no source status`, where);
    if (!lifecycles.has(rfc.lifecycle)) fail(`rfc "${rfc.id}" has unknown lifecycle "${rfc.lifecycle}"`, where);
    if (!sourceKinds.has(rfc.sourceKind)) fail(`rfc "${rfc.id}" has unknown sourceKind "${rfc.sourceKind}"`, where);
    if (!rfc.source) fail(`rfc "${rfc.id}" has no source`, where);
    if (rfc.repository && !/^[a-z0-9.-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(rfc.repository)) {
      fail(`rfc "${rfc.id}" has invalid repository "${rfc.repository}"; use host/owner/name`, where);
    }
    for (const [field, value] of [["createdAt", rfc.createdAt], ["updatedAt", rfc.updatedAt], ["resolvedAt", rfc.resolvedAt]] as const) {
      if (value && Number.isNaN(new Date(value).getTime())) fail(`rfc "${rfc.id}" has an unparseable ${field} "${value}"`, where);
    }
    if (rfc.discussionUrl && !safeWorkItemUrl(rfc.discussionUrl)) fail(`rfc "${rfc.id}" has an unsafe discussionUrl`, where);

    switch (rfc.scope.kind) {
      case "context":
        if (!contextIds.has(rfc.scope.context)) fail(`rfc "${rfc.id}" is scoped to unknown context "${rfc.scope.context}"`, where);
        break;
      case "service":
        if (!serviceIds.has(rfc.scope.service)) fail(`rfc "${rfc.id}" is scoped to unknown service "${rfc.scope.service}"`, where);
        break;
      case "org":
        break;
    }
    for (const id of rfc.relates.services ?? []) if (!serviceIds.has(id)) fail(`rfc "${rfc.id}" relates to unknown service "${id}"`, where);
    for (const id of rfc.relates.events ?? []) if (!eventIds.has(id)) fail(`rfc "${rfc.id}" relates to unknown event "${id}"`, where);
    for (const slug of rfc.relates.flows ?? []) if (!flowSlugs.has(slug)) fail(`rfc "${rfc.id}" relates to unknown flow "${slug}"`, where);
  }
  for (const rfc of rfcs) {
    for (const link of rfc.links ?? []) {
      const where = `rfc ${rfc.id}`;
      if (!relations.has(link.relation)) fail(`rfc "${rfc.id}" has unknown record relation "${link.relation}"`, where);
      if (link.kind === "adr" && !adrIds.has(link.id)) fail(`rfc "${rfc.id}" links to unknown adr "${link.id}"`, where);
      if (link.kind === "rfc" && !rfcIds.has(link.id)) fail(`rfc "${rfc.id}" links to unknown rfc "${link.id}"`, where);
      if (link.kind !== "adr" && link.kind !== "rfc") fail(`rfc "${rfc.id}" links to unknown record kind`, where);
      if (link.kind === "rfc" && link.id === rfc.id) fail(`rfc "${rfc.id}" links to itself`, where);
    }
  }
}
