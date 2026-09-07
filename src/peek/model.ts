// What a peek says, for any id the selection model can resolve.
//
// A peek is the detail panel with everything but the first glance taken out:
// what kind of thing this is, where it sits, two lines of what it is for, and
// the three or four numbers a reader is weighing before deciding to click.
// It is derived from the catalog on every hover rather than stored, for the
// same reason the trail and the pins are: nothing here can go stale.
//
// Facts are `{label, value}` pairs and never sentences. The card lays them out
// in one row, and a row of "3 consumers · v2 · 2 flows" is read in the time
// a sentence takes to start.

import { viewReads } from "../catalog";
import { catalog, index } from "../data";
import { methodCount } from "../lib/api";
import { flowsForService, usesOfDef } from "../lib/derive";
import type { Kind } from "../lib/kinds";
import { flattenProse } from "../lib/palette";
import { resolveSelection } from "../selection/model";

export interface PeekFact {
  /** True for "3 consumers": the number is read before its noun. */
  countable?: true;
  label: string;
  value: string;
}

export interface Peek {
  kind: Kind;
  id: string;
  /** What the card is headed with: a name, not an id. */
  name: string;
  /** For painting the icon; null for anything outside every context. */
  contextId: string | null;
  /** One line under the name saying what holds it. */
  where: string;
  /** Two lines at most, already flattened and trimmed; null when nothing was written. */
  blurb: string | null;
  facts: PeekFact[];
}

/** How much prose a card carries. About two lines of the card's width. */
export const BLURB_CHARS = 160;

/**
 * The first `BLURB_CHARS` of a text, cut at a word and marked as cut. A blurb
 * is a glance, and a glance that runs to a third line is a paragraph.
 */
export function blurbOf(markdown: string | undefined | null): string | null {
  if (!markdown) return null;
  // Headings go: a readme opens with the thing's own name, and the card has
  // already said it once, in bold, on the line above.
  const prose = flattenProse(markdown.replace(/^#{1,6}\s[^\n]*$/gm, " "));
  if (!prose) return null;
  if (prose.length <= BLURB_CHARS) return prose;
  const cut = prose.slice(0, BLURB_CHARS);
  const at = cut.lastIndexOf(" ");
  return `${(at > BLURB_CHARS / 2 ? cut.slice(0, at) : cut).replace(/[,;:.]$/, "")}…`;
}

/** "3 consumers", "1 flow": a count and its noun agreeing. */
export function count(n: number, noun: string, plural = `${noun}s`): PeekFact {
  return { countable: true, label: n === 1 ? noun : plural, value: String(n) };
}

/**
 * The peek for a catalog id, or null when the id resolves to nothing or to
 * something a card has nothing to add to: a flow step is one line of a rail
 * the reader is already looking at, and a bundle is a line on one canvas.
 */
export function peekOf(id: string): Peek | null {
  const resolved = resolveSelection(id);
  if (!resolved) return null;

  switch (resolved.kind) {
    case "context": {
      const { context } = resolved;
      return {
        kind: "context",
        id,
        name: context.name,
        contextId: context.id,
        where: context.classification
          ? `${context.classification} context`
          : "bounded context",
        blurb: blurbOf(context.summary),
        facts: [
          count(context.services.length, "service"),
          count(
            context.services.reduce((n, s) => n + s.aggregates.length, 0),
            "aggregate",
          ),
        ],
      };
    }
    case "service": {
      const { service, context } = resolved;
      const events = service.aggregates.reduce((n, a) => n + a.events.length, 0);
      return {
        kind: "service",
        id,
        name: service.name,
        contextId: context.id,
        where: `${context.name} · ${service.repo}/${service.path}`,
        blurb: blurbOf(service.readme),
        facts: [
          count(service.aggregates.length, "aggregate"),
          count(events, "event"),
          count(methodCount(service), "method"),
          count(flowsForService(catalog, service.id).length, "flow"),
        ],
      };
    }
    case "aggregate": {
      const { aggregate, service, context } = resolved;
      return {
        kind: "aggregate",
        id,
        name: aggregate.name,
        contextId: context.id,
        where: `${service.name} · root ${aggregate.root}`,
        blurb: blurbOf(aggregate.readme),
        facts: [
          count(aggregate.events.length, "event"),
          count(aggregate.operations.length, "operation"),
          count(aggregate.entities.length, "entity", "entities"),
          count(aggregate.valueObjects.length, "value object"),
        ],
      };
    }
    case "event": {
      const { event, aggregate, service, context } = resolved;
      const latest = event.versions[event.versions.length - 1];
      const flows = index.flowsByEvent.get(event.id) ?? [];
      return {
        kind: "event",
        id,
        name: event.name,
        contextId: context.id,
        where: `${service.name} · ${aggregate.name}`,
        blurb: blurbOf(latest?.doc),
        facts: [
          { label: "version", value: latest?.version ?? "—" },
          count(latest?.fields.length ?? 0, "field"),
          count(event.consumers.length, "consumer"),
          count(flows.length, "flow"),
        ],
      };
    }
    case "store": {
      const { store, service, context } = resolved;
      return {
        kind: "store",
        id,
        name: store.name,
        contextId: context.id,
        where: `${store.kind} · owned by ${service.name}`,
        blurb: null,
        facts: [
          count(store.tables.length, "table"),
          count(store.views?.length ?? 0, "view"),
          count(store.keyspaces?.length ?? 0, "keyspace"),
        ].filter((f) => f.value !== "0" || f.label === "tables"),
      };
    }
    case "table": {
      const { table, store, context } = resolved;
      const persists = table.persists?.aggregate
        ? index.aggregateById.get(table.persists.aggregate)?.name
        : null;
      return {
        kind: "table",
        id,
        name: table.name,
        contextId: context.id,
        where: `${store.name}${table.role ? ` · ${table.role}` : ""}`,
        blurb: blurbOf(table.doc),
        facts: [
          count(table.columns.length, "column"),
          count(table.indexes?.length ?? 0, "index", "indexes"),
          ...(persists ? [{ label: "persists", value: persists }] : []),
        ],
      };
    }
    case "view": {
      const { view, store, context } = resolved;
      return {
        kind: "view",
        id,
        name: view.name,
        contextId: context.id,
        where: `${store.name}${view.materialized ? " · materialized" : ""}`,
        blurb: blurbOf(view.doc),
        facts: [
          count(view.columns.length, "column"),
          count(viewReads(view).length, "source", "sources"),
        ],
      };
    }
    case "column": {
      const { column, table, view, context } = resolved;
      const facts: PeekFact[] = [{ label: "type", value: column.type }];
      if (column.pk) facts.push({ label: "key", value: "primary" });
      if (column.fk) facts.push({ label: "→", value: column.fk.table });
      if (column.nullable) facts.push({ label: "nullable", value: "yes" });
      return {
        kind: view ? "view" : "table",
        id,
        name: column.name,
        contextId: context.id,
        where: `column of ${view?.name ?? table?.name ?? ""}`,
        blurb: null,
        facts,
      };
    }
    case "value-object": {
      const { def } = resolved;
      const uses = usesOfDef(catalog, id);
      return {
        kind: "def",
        id,
        name: id,
        contextId: null,
        where: "shared type",
        blurb: null,
        facts: [
          count(def.fields.length, "field"),
          count(uses.events.length, "event"),
        ],
      };
    }
    case "module": {
      const { module } = resolved;
      return {
        kind: "module",
        id,
        name: module.name,
        contextId: null,
        where: module.registry ? `buf module · ${module.registry}` : "buf module",
        blurb: null,
        facts: [
          ...(module.owner ? [{ label: "owner", value: module.owner }] : []),
          ...(module.commit
            ? [{ label: "commit", value: module.commit.slice(0, 7) }]
            : []),
        ],
      };
    }
    case "flow-step":
    case "bundle":
      return null;
  }
}
