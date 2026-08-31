// What "selected" means. One value, one shape, no per-panel variants.
//
// A selection is a kind and an id. The id is always a catalog id, spelled the
// way the catalog spells it — never a slug, never a LikeC4 identifier. The kind
// is derived from the id rather than supplied by the caller, so a click in the
// sidebar and a click on a diagram node cannot disagree about what was clicked.

import type {
  Aggregate,
  BoundedContext,
  Event,
  Flow,
  Service,
  Step,
  TypeDef,
} from "../catalog";
import { walkSteps } from "../catalog";
import { catalog, index } from "../data";

export type SelectionKind =
  | "context"
  | "service"
  | "aggregate"
  | "event"
  | "value-object"
  | "flow-step"
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
export interface ResolvedValueObject {
  kind: "value-object";
  id: string;
  def: TypeDef;
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
  | ResolvedEvent
  | ResolvedValueObject
  | ResolvedFlowStep;

/**
 * The whole mapping layer: a catalog id in, a catalog entity out. Anything the
 * catalog does not know about resolves to null, and the caller is expected to
 * carry on with a selection of kind "unknown" rather than to drop the click.
 */
export function resolveSelection(id: string): Resolved | null {
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
    case "flow-step":
    case "value-object":
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
    case "value-object":
      return resolved.id;
    case "flow-step":
      return `${resolved.flow.slug} · step ${resolved.number}`;
  }
}
