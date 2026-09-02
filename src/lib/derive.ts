// Pure derivations over the catalog. Nothing here reads the DOM or the router,
// so every number a Phase 2 page shows can be asserted in a test.

import type {
  Block,
  Catalog,
  BoundedContext,
  Event,
  Field,
  Flow,
} from "../catalog";
import { aggregateBlocks, flowContexts, walkSteps } from "../catalog";

export interface ContextStats {
  services: number;
  aggregates: number;
  events: number;
  /** unresolved rpc calls plus unresolved event consumers owned by this context */
  unresolved: number;
}

export function contextStats(context: BoundedContext): ContextStats {
  let aggregates = 0;
  let events = 0;
  let unresolved = 0;
  for (const service of context.services) {
    aggregates += service.aggregates.length;
    for (const call of service.consumes) {
      if (call.status === "unresolved") unresolved += 1;
    }
    for (const aggregate of service.aggregates) {
      events += aggregate.events.length;
      for (const event of aggregate.events) {
        for (const consumer of event.consumers) {
          if (consumer.status === "unresolved") unresolved += 1;
        }
      }
    }
  }
  return { services: context.services.length, aggregates, events, unresolved };
}

/** Flows ordered by how many contexts they cross, widest first. */
export function flowsByReach(
  catalog: Catalog,
): { flow: Flow; contexts: string[] }[] {
  return catalog.flows
    .map((flow) => ({ flow, contexts: flowContexts(flow) }))
    .sort(
      (a, b) =>
        b.contexts.length - a.contexts.length ||
        a.flow.name.localeCompare(b.flow.name),
    );
}

/** Flows in which a service appears as a participant. */
export function flowsForService(catalog: Catalog, serviceId: string): Flow[] {
  return catalog.flows.filter((f) =>
    f.participants.some((p) => p.id === serviceId),
  );
}

export interface StepRef {
  flow: Flow;
  stepId: string;
  number: number;
}

/** Every step across every flow that references an event, with its 1-based number. */
export function stepsReferencing(catalog: Catalog, eventId: string): StepRef[] {
  const out: StepRef[] = [];
  for (const flow of catalog.flows) {
    walkSteps(flow.steps).forEach((step, i) => {
      if (step.ref === eventId)
        out.push({ flow, stepId: step.id, number: i + 1 });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared types. A value object earns its page by being the same type wherever
// it turns up, so "used in" is computed from defs refs rather than from names:
// two blocks called Money are the same Money only if they name the same def.
// ---------------------------------------------------------------------------

export type UsageKind = "event" | "entity" | "vo" | "def" | "rpc";

export interface DefUsage {
  kind: UsageKind;
  /** event id, block id, defs key, or "<rpc service id>.<message>" */
  id: string;
  name: string;
  /** aggregate id, service id, or "defs" - what the usage sits inside */
  owner: string;
  /** the fields that carry the ref; empty when the usage IS the def */
  fields: string[];
  /** event versions in which the ref appears, oldest first */
  versions?: string[];
}

function refFields(fields: Field[], defKey: string): string[] {
  return fields.filter((f) => f.ref === defKey).map((f) => f.name);
}

/** The fields of a block that name a def, whether the block refs it or holds it inline. */
function blockRefFields(block: Block, defKey: string): string[] {
  if (block.ref === defKey) return [];
  return refFields(block.fields ?? [], defKey);
}

function usesDef(block: Block, defKey: string): boolean {
  return block.ref === defKey || blockRefFields(block, defKey).length > 0;
}

/**
 * Everything in the catalog that names a shared type. `exclude` drops one
 * block id, so a value object's own page does not list itself.
 */
export function usagesOfDef(
  catalog: Catalog,
  defKey: string,
  exclude?: string,
): DefUsage[] {
  const events: DefUsage[] = [];
  const entities: DefUsage[] = [];
  const valueObjects: DefUsage[] = [];
  const defs: DefUsage[] = [];
  const rpc: DefUsage[] = [];

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const provided of service.provides) {
        for (const message of provided.messages ?? []) {
          const fields = refFields(message.fields, defKey);
          if (fields.length === 0) continue;
          rpc.push({
            kind: "rpc",
            id: `${provided.id}.${message.name}`,
            name: message.name,
            owner: service.id,
            fields,
          });
        }
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const names = new Set<string>();
          const versions: string[] = [];
          for (const version of event.versions) {
            const fields = refFields(version.fields, defKey);
            if (fields.length === 0) continue;
            for (const name of fields) names.add(name);
            versions.push(version.version);
          }
          if (names.size === 0) continue;
          events.push({
            kind: "event",
            id: event.id,
            name: event.name,
            owner: aggregate.id,
            fields: [...names],
            versions,
          });
        }
        for (const { kind, block } of aggregateBlocks(aggregate)) {
          if (block.id === exclude || !usesDef(block, defKey)) continue;
          const usage: DefUsage = {
            kind,
            id: block.id,
            name: block.name,
            owner: aggregate.id,
            fields: blockRefFields(block, defKey),
          };
          (kind === "entity" ? entities : valueObjects).push(usage);
        }
      }
    }
  }

  for (const [id, def] of Object.entries(catalog.defs)) {
    if (id === defKey) continue;
    const fields = refFields(def.fields, defKey);
    if (fields.length > 0) {
      defs.push({ kind: "def", id, name: id, owner: "defs", fields });
    }
  }

  return [...events, ...entities, ...valueObjects, ...defs, ...rpc];
}

// ---------------------------------------------------------------------------
// Markdown outline, for the sticky heading rail on aggregate pages.
// ---------------------------------------------------------------------------

export interface Heading {
  depth: number;
  text: string;
  slug: string;
}

export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Headings outside fenced code blocks, in document order. */
export function markdownOutline(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const hashes = match[1];
    const text = match[2];
    if (!hashes || !text) continue;
    out.push({ depth: hashes.length, text, slug: headingSlug(text) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

/** Fields added by a version relative to the one before it. */
export function addedFields(event: Event, version: string): Set<string> {
  const i = event.versions.findIndex((v) => v.version === version);
  if (i <= 0) return new Set();
  const prev = event.versions[i - 1];
  const current = event.versions[i];
  if (!prev || !current) return new Set();
  const before = new Set(prev.fields.map((f) => f.name));
  return new Set(
    current.fields.filter((f) => !before.has(f.name)).map((f) => f.name),
  );
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface DefUse {
  /** Events with a field pointing at the def, with the versions that do. */
  events: { eventId: string; versions: string[] }[];
  /** Other defs that embed it. */
  defs: string[];
}

/**
 * Where a shared type is actually used. A value object has no page of its own,
 * so this is the only answer to "what breaks if I change it?".
 */
export function usesOfDef(catalog: Catalog, defId: string): DefUse {
  const events: DefUse["events"] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const versions = event.versions
            .filter((v) => v.fields.some((f) => f.ref === defId))
            .map((v) => v.version);
          if (versions.length > 0) events.push({ eventId: event.id, versions });
        }
      }
    }
  }
  const defs = Object.entries(catalog.defs)
    .filter(
      ([id, def]) => id !== defId && def.fields.some((f) => f.ref === defId),
    )
    .map(([id]) => id);
  return { events, defs };
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

/**
 * One edge in the estate that does not land. Two things can be wrong, and they
 * are wrong in the same way: a service calls an rpc whose provider is not in
 * the catalog, or an event names a consumer that is not either. Both mean the
 * chart draws an arrow into open water.
 */
export type ProblemKind =
  | "rpc"
  | "consumer"
  | "cross-service-fk"
  | "cross-service-lineage"
  | "shared-store"
  | "persistence-drift"
  | "column-type"
  | "outbox-payload"
  | "proto-missing";

/**
 * How wrong a problem is. Two values, not five: an edge either lands somewhere
 * the catalog knows about or it does not (an error), or the catalog holds two
 * claims that do not quite agree and one of them is probably stale (a warning).
 * Nothing in between is a distinction a reader could act on differently.
 */
export type Severity = "error" | "warning";

export interface Problem {
  kind: ProblemKind;
  severity: Severity;
  /** The context that owns the end we can see. */
  context: string;
  /** The service that owns the end we can see. */
  service: string;
  /** The call id or the event id - what is on the near end of the edge. */
  id: string;
  /** The name that resolves to nothing. */
  peer: string;
  note: string | undefined;
  source: string | undefined;
}

/**
 * Every unresolved edge, contexts in catalog order. Nothing is scored and
 * nothing is ranked: an unresolved consumer is exactly as broken as an
 * unresolved call, and sorting them by badness would invent a fact.
 */
/**
 * How many edges there were to resolve at all - every rpc call a service makes
 * and every consumer an event names, whatever their status.
 *
 * The Problems page needs this to tell two silences apart. Zero problems out
 * of two hundred edges is a clean estate; zero out of zero is a catalog whose
 * services have not been wired together yet, and calling that "every edge
 * resolved" hands the reader a green tick for work nobody has done.
 */
export function edgeCount(catalog: Catalog): number {
  let n = 0;
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      n += service.consumes.length;
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) n += event.consumers.length;
      }
    }
  }
  return n;
}

export function problems(catalog: Catalog): Problem[] {
  const out: Problem[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const call of service.consumes) {
        if (call.status !== "unresolved") continue;
        out.push({
          kind: "rpc",
          severity: "error",
          context: context.id,
          service: service.id,
          id: call.id,
          peer: call.peer,
          note: call.note,
          source: call.source,
        });
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            if (consumer.status !== "unresolved") continue;
            out.push({
              kind: "consumer",
              severity: "error",
              context: context.id,
              service: service.id,
              id: event.id,
              peer: consumer.service,
              note: consumer.note,
              source: undefined,
            });
          }
        }
      }
    }
  }
  return out;
}
