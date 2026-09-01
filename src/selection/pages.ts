// Which page shows which entity.
//
// Two questions are asked of this module. "Where does this selection live?"
// decides whether the command palette needs to navigate at all. "Does this page
// contain it?" decides whether a navigation keeps the selection or drops it —
// a selection nothing on screen can point at is a selection nobody can see.

import { walkSteps } from "../catalog";
import { catalog, index } from "../data";
import { paths } from "../routes";
import type { Selection } from "./model";
import { parseFlowStepId, resolveSelection } from "./model";

/** The page that owns a selection, or null when it has no page of its own. */
export function selectionPath(selection: Selection): string | null {
  const resolved = resolveSelection(selection.id);
  if (!resolved) return null;
  switch (resolved.kind) {
    case "context":
      return paths.context(resolved.context.id);
    case "service":
      return paths.service(resolved.context.id, resolved.service.slug);
    case "aggregate":
      return paths.aggregate(
        resolved.context.id,
        resolved.service.slug,
        resolved.aggregate.slug,
      );
    case "event":
      return paths.event(
        resolved.context.id,
        resolved.service.slug,
        resolved.aggregate.slug,
        resolved.event.slug,
      );
    case "flow-step":
      return paths.flow(resolved.flow.slug);
    // A table, a view and a column are read on the canvas of the store holding
    // them: a column's page is the picture of what it points at and where its
    // value came from.
    case "store":
    case "table":
    case "view":
    case "column":
      return paths.store(
        resolved.context.id,
        resolved.service.slug,
        resolved.store.slug,
      );
    // A shared type has no page. It is only ever read inside the event that
    // carries it, so selecting one opens the panel and moves nobody.
    case "value-object":
      return null;
  }
}

interface Route {
  kind: "overview" | "flows" | "flow" | "adrs" | "adr" | "graph" | "c" | "none";
  segments: string[];
}

function parseRoute(pathname: string): Route {
  const segments =
    (pathname.split("#")[0] ?? "").split("?")[0]?.split("/").filter(Boolean) ??
    [];
  const head = segments[0];
  if (segments.length === 0) return { kind: "overview", segments };
  if (head === "flows") {
    return { kind: segments.length > 1 ? "flow" : "flows", segments };
  }
  if (head === "adrs") {
    return { kind: segments.length > 1 ? "adr" : "adrs", segments };
  }
  if (head === "graph") return { kind: "graph", segments };
  if (head === "c") return { kind: "c", segments };
  return { kind: "none", segments };
}

/** Value objects a version of this event reaches, one level deep. */
function defsOfEvent(eventId: string): Set<string> {
  const event = index.eventById.get(eventId);
  const out = new Set<string>();
  if (!event) return out;
  for (const version of event.versions) {
    for (const field of version.fields) {
      if (!field.ref) continue;
      out.add(field.ref);
      for (const sub of catalog.defs[field.ref]?.fields ?? []) {
        if (sub.ref) out.add(sub.ref);
      }
    }
  }
  return out;
}

/**
 * True when the page at `pathname` can show the selected entity. Deliberately
 * conservative: a page "contains" what it draws or lists, not everything it
 * happens to link to.
 */
export function pageContains(pathname: string, selection: Selection): boolean {
  const route = parseRoute(pathname);
  const resolved = resolveSelection(selection.id);
  if (!resolved) return false;

  switch (route.kind) {
    case "graph": {
      // Services are nodes; events are the edge labels between them.
      return resolved.kind === "service" || resolved.kind === "event";
    }

    case "flow": {
      const flow = index.flowBySlug.get(route.segments[1] ?? "");
      if (!flow) return false;
      const steps = walkSteps(flow.steps);
      switch (resolved.kind) {
        case "flow-step":
          return parseFlowStepId(resolved.id)?.flowSlug === flow.slug;
        case "service":
          return flow.participants.some((p) => p.id === resolved.id);
        case "event":
          return steps.some((s) => s.ref === resolved.id);
        case "context":
          return flow.participants.some((p) => p.context === resolved.id);
        default:
          return false;
      }
    }

    case "c": {
      const [, contextId, serviceSlug, aggregateSlug, eventSlug] =
        route.segments;

      // Value object and entity pages sit one segment deeper, behind a literal.
      // A block is not a selectable entity and the page draws nothing else, so
      // it contains nothing — without this the literal reads as an event slug
      // and the page claims to hold every event of its aggregate.
      if (
        route.segments.length === 6 &&
        (eventSlug === "vo" || eventSlug === "entity")
      ) {
        return false;
      }

      // A store page is "/c/<ctx>/<svc>/data/<store>": the literal sits where
      // an aggregate slug would, so it is read before anything else tries to.
      if (route.segments.length === 5 && aggregateSlug === "data") {
        const store = (catalog.stores ?? []).find(
          (s) => s.slug === eventSlug && s.owner === `${contextId}.${serviceSlug}`,
        );
        if (!store) return false;
        switch (resolved.kind) {
          case "store":
            return resolved.store.id === store.id;
          case "table":
          case "view":
          case "column":
            return resolved.store.id === store.id;
          case "aggregate":
            // The canvas says which aggregate each table holds, so selecting
            // one from the sidebar lights the tables that persist it.
            return (
              store.tables.some((t) => t.persists?.aggregate === resolved.id) ||
              (store.views ?? []).some(
                (v) => v.persists?.aggregate === resolved.id,
              )
            );
          default:
            return false;
        }
      }
      const context = catalog.contexts.find((c) => c.id === contextId);
      if (!context) return false;
      const service = serviceSlug
        ? context.services.find((s) => s.slug === serviceSlug)
        : undefined;
      const aggregate =
        service && aggregateSlug
          ? service.aggregates.find((a) => a.slug === aggregateSlug)
          : undefined;
      const event =
        aggregate && eventSlug
          ? aggregate.events.find((e) => e.slug === eventSlug)
          : undefined;

      if (event) {
        if (resolved.kind === "event") return resolved.id === event.id;
        if (resolved.kind === "value-object")
          return defsOfEvent(event.id).has(resolved.id);
        return false;
      }
      if (aggregate) {
        if (resolved.kind === "aggregate") return resolved.id === aggregate.id;
        if (resolved.kind === "event")
          return aggregate.events.some((e) => e.id === resolved.id);
        return false;
      }
      if (service) {
        if (resolved.kind === "service") return resolved.id === service.id;
        if (resolved.kind === "aggregate")
          return service.aggregates.some((a) => a.id === resolved.id);
        if (resolved.kind === "event")
          return service.aggregates.some((a) =>
            a.events.some((e) => e.id === resolved.id),
          );
        return false;
      }
      if (resolved.kind === "context") return resolved.id === context.id;
      if (resolved.kind === "service")
        return context.services.some((s) => s.id === resolved.id);
      return false;
    }

    case "overview":
    case "flows":
    case "adrs":
    case "adr":
    case "none":
      return false;
  }
}

/**
 * True when a click in the tree should select without navigating.
 *
 * A tree is a navigator, so this is deliberately narrow: only on a flow page,
 * and only for something that flow actually draws. That is the one place where
 * leaving is the wrong answer — picking an event there is a question about
 * *this* sequence ("where does it appear?"), and the flow page answers it by
 * lighting the matching steps.
 */
export function selectsInPlace(
  pathname: string,
  selection: Selection,
): boolean {
  const route = parseRoute(pathname);
  return route.kind === "flow" && pageContains(pathname, selection);
}
