// The command palette's index and its ranking. Pure: given a catalog and a
// query string it returns the rows to draw, so the ordering can be asserted in
// a test rather than eyeballed.

import type { Catalog } from "../catalog";
import { parseQuery } from "./kinds";
import type { Kind, ParsedQuery } from "./kinds";
import { paths } from "../routes";

export interface PaletteItem {
  kind: Kind;
  /** Row identity, unique across kinds; used as the React key. */
  id: string;
  /**
   * The catalog id to SELECT when picking this row, for the kinds the
   * selection model knows. Rows without one only navigate: a value object,
   * a command and a decision have pages but are not selectable entities.
   */
  selectId?: string;
  /** What is matched and shown first. */
  name: string;
  /** Where it lives - owner id, or the summary for flows and decisions. */
  detail: string;
  /** The page that owns the row, or null when it has none (shared types). */
  path: string | null;
  /** Context colour to paint with, or null for org-wide rows. */
  context: string | null;
  /** Right-aligned extra, e.g. an event's latest version. */
  badge?: string;
}

/** Every navigable thing in the catalog, built once at module load. */
export function paletteItems(catalog: Catalog): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const context of catalog.contexts) {
    items.push({
      kind: "context",
      id: context.id,
      selectId: context.id,
      name: context.id,
      detail: context.name,
      path: paths.context(context.id),
      context: context.id,
    });

    for (const service of context.services) {
      items.push({
        kind: "service",
        id: service.id,
        selectId: service.id,
        name: service.slug,
        detail: service.id,
        path: paths.service(context.id, service.slug),
        context: context.id,
      });

      for (const aggregate of service.aggregates) {
        items.push({
          kind: "aggregate",
          id: aggregate.id,
          selectId: aggregate.id,
          name: aggregate.name,
          detail: service.id,
          path: paths.aggregate(context.id, service.slug, aggregate.slug),
          context: context.id,
          badge: `root: ${aggregate.root}`,
        });

        for (const event of aggregate.events) {
          const latest = event.versions[event.versions.length - 1];
          items.push({
            kind: "event",
            id: event.id,
            selectId: event.id,
            name: event.name,
            detail: aggregate.id,
            path: paths.event(
              context.id,
              service.slug,
              aggregate.slug,
              event.slug,
            ),
            context: context.id,
            ...(latest ? { badge: latest.version } : {}),
          });
        }

        for (const vo of aggregate.valueObjects) {
          items.push({
            kind: "vo",
            id: vo.id,
            name: vo.name,
            detail: aggregate.id,
            path: paths.valueObject(
              context.id,
              service.slug,
              aggregate.slug,
              vo.slug,
            ),
            context: context.id,
          });
        }

        for (const entity of aggregate.entities) {
          items.push({
            kind: "entity",
            id: entity.id,
            name: entity.name,
            detail: aggregate.id,
            path: paths.entity(
              context.id,
              service.slug,
              aggregate.slug,
              entity.slug,
            ),
            context: context.id,
            ...(entity.name === aggregate.root ? { badge: "root" } : {}),
          });
        }

        // Commands and queries have no page of their own; they land on the
        // aggregate that handles them, at the right section.
        for (const op of aggregate.operations) {
          items.push({
            kind: op.kind,
            id: `${aggregate.id}#${op.id}`,
            name: op.id,
            detail: aggregate.id,
            path: `${paths.aggregate(context.id, service.slug, aggregate.slug)}#bb-${op.kind === "command" ? "commands" : "queries"}`,
            context: context.id,
          });
        }
      }
    }
  }

  // Shared types have no page: picking one opens the detail panel where it is.
  // They are listed all the same, because "which events carry a Money?" is a
  // question people arrive with.
  for (const [id, def] of Object.entries(catalog.defs)) {
    items.push({
      kind: "def",
      id: `def:${id}`,
      selectId: id,
      name: id,
      detail: "shared type",
      path: null,
      context: null,
      badge: `${def.fields.length}f`,
    });
  }

  for (const flow of catalog.flows) {
    items.push({
      kind: "flow",
      id: flow.id,
      name: flow.slug,
      detail: flow.name,
      path: paths.flow(flow.slug),
      context: null,
    });
  }

  for (const adr of catalog.adrs) {
    items.push({
      kind: "adr",
      id: adr.id,
      name: adr.id,
      detail: adr.title,
      path: paths.adr(adr.slug),
      context: adr.scope.kind === "context" ? adr.scope.context : null,
      badge: adr.status,
    });
  }

  return items;
}

/**
 * Lower is better. Exact beats prefix beats a match at a word boundary beats
 * anything else, and the id is only consulted once the name has failed, so
 * typing "money" puts the value objects called Money above the events that
 * merely carry one.
 */
export function score(item: PaletteItem, term: string): number | null {
  if (!term) return 0;
  const needle = term.toLowerCase();
  const name = item.name.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  // A word boundary is a case change or one of . / - _ ; "item" should hit
  // "AddItem" and "line-item" but not rank with a mid-word accident.
  if (new RegExp(`(^|[.\\-_/ ])${escapeRegex(needle)}`).test(name)) return 2;
  if (
    /[a-z]/.test(item.name) &&
    new RegExp(`[a-z]${escapeRegex(term)}`).test(item.name)
  )
    return 2;
  if (name.includes(needle)) return 3;
  if (item.id.toLowerCase().includes(needle)) return 4;
  if (item.detail.toLowerCase().includes(needle)) return 5;
  return null;
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Kinds first in this order when scores tie: the model before the paperwork. */
const KIND_RANK: Record<Kind, number> = {
  event: 0,
  aggregate: 1,
  vo: 2,
  entity: 3,
  service: 4,
  context: 5,
  command: 6,
  query: 7,
  def: 8,
  flow: 9,
  adr: 10,
};

export interface PaletteResult extends ParsedQuery {
  items: PaletteItem[];
  /** Matches dropped by the limit, so the palette can say so. */
  truncated: number;
}

export function search(
  items: PaletteItem[],
  raw: string,
  limit = 40,
): PaletteResult {
  const parsed = parseQuery(raw);
  const scored: { item: PaletteItem; score: number }[] = [];

  for (const item of items) {
    if (parsed.kind && item.kind !== parsed.kind) continue;
    const s = score(item, parsed.term);
    if (s === null) continue;
    scored.push({ item, score: s });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] ||
      a.item.name.length - b.item.name.length ||
      a.item.name.localeCompare(b.item.name) ||
      a.item.id.localeCompare(b.item.id),
  );

  return {
    ...parsed,
    items: scored.slice(0, limit).map((s) => s.item),
    truncated: Math.max(0, scored.length - limit),
  };
}
