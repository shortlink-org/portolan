// One visit in the reader's journal.
//
// The breadcrumb answers "where does this thing sit" — it walks the ancestors
// of whatever is selected. This answers a different question, "where have I
// been", and the two are not the same shape: an ADR and a flow have no
// ancestors in the model at all, and they are exactly the pages a reader loses
// the thread of after five moves.
//
// So a visit is a route plus whatever was selected on it, and nothing is
// stored that the catalog could contradict later: the icon and the label are
// derived at render time, so a renamed event is renamed in the trail too, and
// an entity the catalog no longer has drops out of it rather than pointing at
// a page that is gone.

import { catalog, index } from "../data";
import { adrNumber } from "../lib/adr";
import type { Kind } from "../lib/kinds";
import { selectionHash } from "../selection/hash";
import type { Selection } from "../selection/model";
import { resolveSelection } from "../selection/model";

export interface Visit {
  /** The route, with no hash and no query. */
  path: string;
  /** What was selected on it, or null when the page is the whole answer. */
  selection: Selection | null;
}

/** What a chip draws: one icon, one name. */
export interface VisitSubject {
  kind: Kind;
  label: string;
  /** Only ever set for `context`, which is painted in its own colour. */
  contextId?: string;
}

/**
 * A visit worth recording, or null for a page that is not an entity — the
 * overview, the two index lists, the map, the graph. Those are places the
 * reader gets back to from the chrome that is already on screen; the trail is
 * for the leaves, which are not reachable in one move from anywhere.
 */
export function visitFor(
  pathname: string,
  selection: Selection | null,
): Visit | null {
  if (!subjectOfPath(pathname)) return null;
  return { path: pathname, selection };
}

/**
 * Identity is the path, not the pair.
 *
 * That one line is what collapses a flow: thirteen steps of `checkout` are
 * thirteen selections on one page, and a journal of seven that spends all of
 * itself on one flow has forgotten the six other things the reader came from.
 * The newest selection wins, so the chip still points at the step they left.
 */
export function sameVisit(a: Visit, b: Visit): boolean {
  return a.path === b.path;
}

/** Where a chip goes back to: the page, and the selection it was left on. */
export function visitTo(visit: Visit): string {
  return `${visit.path}${selectionHash(visit.selection)}`;
}

/**
 * The chip's icon and name, or null when nothing in the catalog answers to it
 * any more. A trail restored from a previous session can name an event that
 * has since been deleted, and a chip that navigates to a 404 is worse than no
 * chip at all.
 *
 * The selection is asked first, and it is allowed to disagree with the page:
 * an event picked on a service diagram was what the reader was looking at,
 * even though the route still says the service. Going back to that route with
 * that selection puts them back in front of it.
 */
export function visitSubject(visit: Visit): VisitSubject | null {
  const selected = visit.selection ? subjectOfSelection(visit.selection) : null;
  return selected ?? subjectOfPath(visit.path);
}

function subjectOfSelection(selection: Selection): VisitSubject | null {
  const resolved = resolveSelection(selection.id);
  if (!resolved) return null;
  switch (resolved.kind) {
    case "context":
      return {
        kind: "context",
        label: resolved.context.id,
        contextId: resolved.context.id,
      };
    case "service":
      return { kind: "service", label: resolved.service.slug };
    case "aggregate":
      return { kind: "aggregate", label: resolved.aggregate.slug };
    case "event":
      return { kind: "event", label: resolved.event.name };
    case "value-object":
      return { kind: "def", label: resolved.id };
    case "store":
      return { kind: "store", label: resolved.store.slug };
    // A table and a column both take the reader back to the same canvas, so
    // the chip names the table either way; a column rides along in the label.
    case "table":
      return { kind: "table", label: resolved.table.name };
    case "view":
      return { kind: "view", label: resolved.view.name };
    case "column":
      return {
        kind: resolved.view ? "view" : "table",
        label: `${resolved.view?.name ?? resolved.table?.name ?? ""}.${resolved.column.name}`,
      };
    // The step number rides along in the label rather than in a chip of its
    // own: one flow, one slot, and the number says how far in they had got.
    case "flow-step":
      return {
        kind: "flow",
        label: `${resolved.flow.slug} · ${resolved.number}`,
      };
  }
}

/**
 * The entity a route is about, read off the segments. Every lookup goes to the
 * catalog, so an unrecognised slug is null rather than a chip labelled with a
 * URL fragment.
 */
function subjectOfPath(pathname: string): VisitSubject | null {
  const parts = pathname.split("/").filter(Boolean);
  const head = parts[0];

  if (head === "flows") {
    const slug = parts[1];
    const flow = slug ? index.flowBySlug.get(slug) : undefined;
    return flow ? { kind: "flow", label: flow.slug } : null;
  }

  if (head === "adrs") {
    const slug = parts[1];
    const adr = slug ? index.adrBySlug.get(slug) : undefined;
    return adr ? { kind: "adr", label: adrNumber(adr) } : null;
  }

  if (head !== "c") return null;

  const [, contextId, serviceSlug, aggregateSlug, fourth, fifth] = parts;
  const context = contextId
    ? catalog.contexts.find((c) => c.id === contextId)
    : undefined;
  if (!context) return null;
  if (!serviceSlug) {
    return { kind: "context", label: context.id, contextId: context.id };
  }

  const service = context.services.find((s) => s.slug === serviceSlug);
  if (!service) return null;
  if (!aggregateSlug) return { kind: "service", label: service.slug };

  const aggregate = service.aggregates.find((a) => a.slug === aggregateSlug);
  if (!aggregate) return null;
  if (!fourth) return { kind: "aggregate", label: aggregate.slug };

  // "vo" and "entity" are literals with a slug behind them, which is what
  // keeps an event whose slug is "vo" from being read as a block page.
  if (fourth === "vo" || fourth === "entity") {
    const list = fourth === "vo" ? aggregate.valueObjects : aggregate.entities;
    const block = fifth ? list.find((b) => b.slug === fifth) : undefined;
    return block ? { kind: fourth, label: block.name } : null;
  }

  const event = aggregate.events.find((e) => e.slug === fourth);
  return event ? { kind: "event", label: event.name } : null;
}
