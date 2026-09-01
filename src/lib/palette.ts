// The command palette's index and its ranking. Pure: given a catalog and a
// query string it returns the rows to draw, so the ordering can be asserted in
// a test rather than eyeballed.
//
// Every row also carries the PROSE that belongs to it - a context's summary, a
// readme and the invariants written in it, an event's version notes, a field's
// doc line, the body of a decision. Names and ids are how you find a thing you
// can already name; prose is how you find the thing you can only describe
// ("the rule about two currencies in one order"). It is the last tier the
// scorer tries, so a prose hit never displaces a name, and a hit brings its
// own line of context back with it - a row that matched on something the
// reader cannot see is a row they have to open to understand.

import type { Block, Catalog, Event, Field } from "../catalog";
import { parseQuery } from "./kinds";
import type { Kind, ParsedQuery } from "./kinds";
import { paths, storePath, tablePath, viewPath } from "../routes";

/**
 * Markdown, flattened to one line of searchable prose.
 *
 * Fenced code is dropped whole: a readme's Go snippet would match half the
 * catalog's identifiers and answer nothing. The remaining marks are stripped
 * rather than parsed - `**never**` must be found by typing "never", and an
 * excerpt is a sentence, not a rendering.
 */
export function flattenProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything a field says about itself, for the row that owns the field. */
function fieldProse(fields: readonly Field[] | undefined): string {
  return (fields ?? []).map((f) => `${f.name} ${f.doc}`).join(" ");
}

function eventProse(event: Event): string {
  return event.versions
    .map((v) => `${v.doc} ${fieldProse(v.fields)}`)
    .join(" ");
}

function blockProse(block: Block): string {
  return `${block.doc} ${fieldProse(block.fields)}`;
}

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
  /**
   * The row's own prose, flattened to one line. Searched last, and only for
   * terms long enough to mean something; a row with nothing written about it
   * simply leaves it out.
   */
  text?: string;
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
      text: flattenProse(`${context.name} ${context.summary}`),
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
        text: flattenProse(`${service.name} ${service.readme}`),
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
          // The readme is where the invariants live, and an invariant is the
          // one fact about an aggregate nobody can guess the name of.
          text: flattenProse(`${aggregate.name} ${aggregate.readme}`),
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
            text: flattenProse(eventProse(event)),
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
            text: flattenProse(blockProse(vo)),
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
            text: flattenProse(blockProse(entity)),
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
            ...(op.doc ? { text: flattenProse(op.doc) } : {}),
          });
        }
      }

      // Endpoints hang off the service rather than an aggregate: one of them
      // can run use cases from two of them. They have no page of their own
      // either, so they land on the tab that lists them.
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          items.push({
            kind: "endpoint",
            id: `${provided.id}/${method}`,
            name: method,
            detail: provided.id,
            path: `${paths.service(context.id, service.slug)}?tab=provides`,
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
      text: flattenProse(fieldProse(def.fields)),
    });
  }

  // Stores and tables. A table is the one row here whose name a reader is
  // likely to know exactly — they have just read it in a migration or a stack
  // trace — so it is worth finding by name alone, without the store.
  for (const store of catalog.stores ?? []) {
    const to = storePath(store.id);
    const context = store.owner.split(".")[0] ?? null;
    items.push({
      kind: "store",
      id: store.id,
      selectId: store.id,
      name: store.slug,
      detail: store.owner,
      path: to,
      context,
      badge: store.kind,
      text: flattenProse(`${store.name} ${store.source ?? ""}`),
    });

    for (const table of store.tables) {
      items.push({
        kind: "table",
        id: table.id,
        selectId: table.id,
        name: table.name,
        detail: store.id,
        path: tablePath(table.id),
        context,
        ...(table.role ? { badge: table.role } : {}),
        text: flattenProse(
          `${table.doc ?? ""} ${table.columns.map((c) => c.name).join(" ")}`,
        ),
      });
    }

    // A view is searched by its SQL as well as by its columns: half the time
    // the reader remembers the join, not the name the migration gave it.
    for (const view of store.views ?? []) {
      items.push({
        kind: "view",
        id: view.id,
        selectId: view.id,
        name: view.name,
        detail: store.id,
        path: viewPath(view.id),
        context,
        badge: view.materialized ? "matview" : "view",
        text: flattenProse(
          `${view.doc ?? ""} ${view.definition ?? ""} ${view.columns
            .map((c) => c.name)
            .join(" ")}`,
        ),
      });
    }
  }

  for (const flow of catalog.flows) {
    items.push({
      kind: "flow",
      id: flow.id,
      name: flow.slug,
      detail: flow.name,
      path: paths.flow(flow.slug),
      context: null,
      text: flattenProse(`${flow.name} ${flow.summary}`),
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
      text: flattenProse(`${adr.title} ${adr.body}`),
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
  // Last, and only for a term with something to say. Two characters match
  // prose everywhere and rank nothing; the floor is what stops "or" from
  // returning the whole estate under the rows that actually answered.
  if (
    term.length >= PROSE_MIN &&
    item.text &&
    item.text.toLowerCase().includes(needle)
  )
    return 6;
  return null;
}

/** Shortest term the prose tier will answer. Below it, names only. */
export const PROSE_MIN = 3;

/** How much of the sentence around a hit comes back with it. */
const LEAD = 32;
const TRAIL = 56;

/**
 * The words around a prose hit, cut to fit one row.
 *
 * Returned as three parts rather than one string so the caller can mark the
 * match without parsing its own output back apart - and so a term containing
 * regex punctuation is never a regex.
 */
export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

export function excerptOf(text: string, term: string): Excerpt | null {
  if (!term) return null;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return null;

  const end = at + term.length;
  // Cut at a space where there is one nearby, so an excerpt starts on a word
  // rather than in the middle of one.
  let from = Math.max(0, at - LEAD);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < at) from = space + 1;
  }
  let to = Math.min(text.length, end + TRAIL);
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > end) to = space;
  }

  return {
    before: (from > 0 ? "…" : "") + text.slice(from, at),
    match: text.slice(at, end),
    after: text.slice(end, to) + (to < text.length ? "…" : ""),
  };
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
  // After the operation it exposes: a reader searching for "register" wants
  // the command first and the door to it second.
  endpoint: 8,
  def: 9,
  // Where the model is kept comes after the model itself: a reader looking for
  // "orders" wants the aggregate first and the table that holds it second.
  store: 10,
  table: 11,
  // A view after the tables it is computed from, for the same reason.
  view: 12,
  flow: 13,
  adr: 14,
};

/**
 * One row of the result list. A hit is not the same thing as an index row: it
 * knows WHY it is here, which is the whole difference between a name match and
 * a match on something written three paragraphs into a readme.
 */
export interface PaletteHit {
  item: PaletteItem;
  /** Set only when the term was found in prose and nowhere shorter. */
  excerpt?: Excerpt;
}

export interface PaletteResult extends ParsedQuery {
  hits: PaletteHit[];
  /** Matches dropped by the limit, so the palette can say so. */
  truncated: number;
}

/** The score the prose tier returns; the one tier that owes an excerpt. */
const PROSE_SCORE = 6;

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

  const hits = scored.slice(0, limit).map(({ item, score: s }) => {
    if (s !== PROSE_SCORE || !item.text) return { item };
    const excerpt = excerptOf(item.text, parsed.term);
    return excerpt ? { item, excerpt } : { item };
  });

  return {
    ...parsed,
    hits,
    truncated: Math.max(0, scored.length - limit),
  };
}
