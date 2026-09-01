// What "selected" means. One value, one shape, no per-panel variants.
//
// A selection is a kind and an id. The id is always a catalog id, spelled the
// way the catalog spells it — never a slug, never a LikeC4 identifier. The kind
// is derived from the id rather than supplied by the caller, so a click in the
// sidebar and a click on a diagram node cannot disagree about what was clicked.

import type {
  Aggregate,
  BoundedContext,
  Column,
  Event,
  Flow,
  Service,
  Step,
  Store,
  Table,
  TypeDef,
  View,
} from "../catalog";
import { walkSteps } from "../catalog";
import { catalog, index } from "../data";
import { bundleById, eventGraph, parseBundleId } from "../lib/event-graph";
import type { Bundle } from "../lib/event-graph";

export type SelectionKind =
  | "context"
  | "service"
  | "aggregate"
  | "store"
  | "table"
  | "view"
  | "column"
  | "event"
  | "value-object"
  | "flow-step"
  | "bundle"
  | "unknown";

export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** Where a selection came from. Subscribers use it to avoid echoing themselves. */
export type SelectionSource =
  | "sidebar"
  | "breadcrumb"
  | "diagram"
  | "palette"
  | "panel"
  | "page"
  | "rail"
  | "url";

// ---------------------------------------------------------------------------
// Flow steps. A step id is only unique inside its flow, so the selection id
// carries the flow with it. The flow slug never contains a slash, so one split
// is enough to take it apart again.
// ---------------------------------------------------------------------------

export function flowStepId(flowSlug: string, stepId: string): string {
  return `${flowSlug}/${stepId}`;
}

export function parseFlowStepId(
  id: string,
): { flowSlug: string; stepId: string } | null {
  const at = id.indexOf("/");
  if (at <= 0 || at === id.length - 1) return null;
  return { flowSlug: id.slice(0, at), stepId: id.slice(at + 1) };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedContext {
  kind: "context";
  id: string;
  context: BoundedContext;
}
export interface ResolvedService {
  kind: "service";
  id: string;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedAggregate {
  kind: "aggregate";
  id: string;
  aggregate: Aggregate;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedEvent {
  kind: "event";
  id: string;
  event: Event;
  aggregate: Aggregate;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedStore {
  kind: "store";
  id: string;
  store: Store;
  /** The service that OWNS it. A reader of the store resolves to the owner too. */
  service: Service;
  context: BoundedContext;
}
export interface ResolvedTable {
  kind: "table";
  id: string;
  table: Table;
  store: Store;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedView {
  kind: "view";
  id: string;
  view: View;
  store: Store;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedColumn {
  kind: "column";
  id: string;
  column: Column;
  /** The table holding it, or null when the column belongs to a view. */
  table: Table | null;
  /** The view declaring it, or null when the column belongs to a table. */
  view: View | null;
  store: Store;
  service: Service;
  context: BoundedContext;
}
export interface ResolvedValueObject {
  kind: "value-object";
  id: string;
  def: TypeDef;
}
/**
 * Every event one service publishes to another, as one thing.
 *
 * Compact mode draws that as a single line with a count on it, and a line
 * standing for three events has to be selectable or the count is a number the
 * reader cannot open. Like a flow step, it has no entity of its own in the
 * catalog: its id is synthetic and it is resolved by re-deriving the graph.
 */
export interface ResolvedBundle {
  kind: "bundle";
  id: string;
  bundle: Bundle;
  /** null when the far end is a consumer the catalog has never heard of */
  from: Service | null;
  to: Service | null;
}
export interface ResolvedFlowStep {
  kind: "flow-step";
  id: string;
  flow: Flow;
  step: Step;
  /** 1-based position in the flow's step order, the number the rail shows. */
  number: number;
}

export type Resolved =
  | ResolvedContext
  | ResolvedService
  | ResolvedAggregate
  | ResolvedStore
  | ResolvedTable
  | ResolvedView
  | ResolvedColumn
  | ResolvedEvent
  | ResolvedValueObject
  | ResolvedFlowStep
  | ResolvedBundle;

/**
 * The whole mapping layer: a catalog id in, a catalog entity out. Anything the
 * catalog does not know about resolves to null, and the caller is expected to
 * carry on with a selection of kind "unknown" rather than to drop the click.
 */
export function resolveSelection(id: string): Resolved | null {
  // First, because it is the only id with a literal prefix: nothing in the
  // catalog is spelled "bundle:...", so there is nothing for it to shadow.
  if (parseBundleId(id)) {
    const bundle = bundleById(eventGraph(catalog), id);
    if (!bundle) return null;
    return {
      kind: "bundle",
      id,
      bundle,
      from: index.serviceById.get(bundle.from) ?? null,
      to: index.serviceById.get(bundle.to) ?? null,
    };
  }

  const event = index.eventById.get(id);
  if (event) {
    const owner = index.eventOwner.get(id);
    const context = owner ? index.serviceContext.get(owner.service.id) : null;
    if (owner && context) {
      return {
        kind: "event",
        id,
        event,
        aggregate: owner.aggregate,
        service: owner.service,
        context,
      };
    }
  }

  const aggregate = index.aggregateById.get(id);
  if (aggregate) {
    const service = index.aggregateOwner.get(id);
    const context = service ? index.serviceContext.get(service.id) : null;
    if (service && context) {
      return { kind: "aggregate", id, aggregate, service, context };
    }
  }

  const service = index.serviceById.get(id);
  if (service) {
    const context = index.serviceContext.get(id);
    if (context) return { kind: "service", id, service, context };
  }

  // Column before table before store: the three ids are nested prefixes of one
  // another, and the longest one is the thing that was actually clicked. A
  // view column is looked up in the same breath as a table column — a reader
  // clicking a row does not know or care which of the two they are on.
  const column = index.columnById.get(id);
  if (column) {
    const owner = ownerOfStore(column.store);
    if (owner) {
      return {
        kind: "column",
        id,
        column: column.column,
        table: column.table,
        view: null,
        store: column.store,
        ...owner,
      };
    }
  }

  const viewColumn = index.viewColumnById.get(id);
  if (viewColumn) {
    const owner = ownerOfStore(viewColumn.store);
    if (owner) {
      return {
        kind: "column",
        id,
        column: viewColumn.column,
        table: null,
        view: viewColumn.view,
        store: viewColumn.store,
        ...owner,
      };
    }
  }

  const table = index.tableById.get(id);
  if (table) {
    const owner = ownerOfStore(table.store);
    if (owner) {
      return {
        kind: "table",
        id,
        table: table.table,
        store: table.store,
        ...owner,
      };
    }
  }

  const view = index.viewById.get(id);
  if (view) {
    const owner = ownerOfStore(view.store);
    if (owner) {
      return {
        kind: "view",
        id,
        view: view.view,
        store: view.store,
        ...owner,
      };
    }
  }

  const store = index.storeById.get(id);
  if (store) {
    const owner = ownerOfStore(store);
    if (owner) return { kind: "store", id, store, ...owner };
  }

  const context = catalog.contexts.find((c) => c.id === id);
  if (context) return { kind: "context", id, context };

  const def = catalog.defs[id];
  if (def) return { kind: "value-object", id, def };

  const parsed = parseFlowStepId(id);
  if (parsed) {
    const flow = index.flowBySlug.get(parsed.flowSlug);
    if (flow) {
      const steps = walkSteps(flow.steps);
      const at = steps.findIndex((s) => s.id === parsed.stepId);
      const step = at < 0 ? undefined : steps[at];
      if (step) return { kind: "flow-step", id, flow, step, number: at + 1 };
    }
  }

  return null;
}

/** The service that owns a store, and the context that owns the service. */
function ownerOfStore(
  store: Store,
): { service: Service; context: BoundedContext } | null {
  const service = index.serviceById.get(store.owner);
  const context = index.serviceContext.get(store.owner);
  return service && context ? { service, context } : null;
}

/** The kind an id resolves to, or "unknown" when nothing in the catalog owns it. */
export function classify(id: string): SelectionKind {
  return resolveSelection(id)?.kind ?? "unknown";
}

/**
 * A selection for any id at all. An id with no catalog counterpart still
 * selects — as "unknown" — because a diagram node the catalog has never heard
 * of is a fact worth showing, not a click to swallow.
 */
export function selectionFor(id: string): Selection {
  return { kind: classify(id), id };
}

export function sameSelection(
  a: Selection | null,
  b: Selection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

/** Ancestors first, then the entity itself: the trail a breadcrumb walks. */
export function selectionTrail(selection: Selection): Selection[] {
  const resolved = resolveSelection(selection.id);
  if (!resolved) return [selection];
  switch (resolved.kind) {
    case "context":
      return [{ kind: "context", id: resolved.context.id }];
    case "service":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
      ];
    case "aggregate":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "aggregate", id: resolved.aggregate.id },
      ];
    case "event":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "aggregate", id: resolved.aggregate.id },
        { kind: "event", id: resolved.event.id },
      ];
    case "store":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "store", id: resolved.store.id },
      ];
    case "table":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "store", id: resolved.store.id },
        { kind: "table", id: resolved.table.id },
      ];
    case "view":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "store", id: resolved.store.id },
        { kind: "view", id: resolved.view.id },
      ];
    // The relation the column belongs to sits in the trail whichever kind it
    // is; a column of a view has a view where a table would be, and nothing
    // else about the walk changes.
    case "column":
      return [
        { kind: "context", id: resolved.context.id },
        { kind: "service", id: resolved.service.id },
        { kind: "store", id: resolved.store.id },
        ...(resolved.view
          ? [{ kind: "view" as const, id: resolved.view.id }]
          : resolved.table
            ? [{ kind: "table" as const, id: resolved.table.id }]
            : []),
        { kind: "column", id: resolved.id },
      ];
    case "flow-step":
    case "value-object":
    case "bundle":
      return [selection];
  }
}

/** Short label for a selection, for chips and breadcrumbs. */
export function selectionLabel(selection: Selection): string {
  const resolved = resolveSelection(selection.id);
  if (!resolved) return selection.id;
  switch (resolved.kind) {
    case "context":
      return resolved.context.id;
    case "service":
      return resolved.service.slug;
    case "aggregate":
      return resolved.aggregate.slug;
    case "event":
      return resolved.event.name;
    case "store":
      return resolved.store.slug;
    case "table":
      return resolved.table.name;
    case "view":
      return resolved.view.name;
    case "column":
      return `${resolved.view?.name ?? resolved.table?.name ?? resolved.store.slug}.${resolved.column.name}`;
    case "value-object":
      return resolved.id;
    case "flow-step":
      return `${resolved.flow.slug} · step ${resolved.number}`;
    case "bundle":
      return `${resolved.bundle.from} → ${resolved.bundle.to}`;
  }
}
