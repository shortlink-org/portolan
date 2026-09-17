// A branch draft: what one feature branch did to one project, as the catalog
// sees it (portolan.0019).
//
// Generation compares two catalogs of the same project - the branch's tip and
// the commit it branched off - and keeps, for every entity the branch touched,
// the version it had at the base and the version it has on the branch. The
// site lays that over whatever main is now, which is how a change main made
// after the branch was cut is told apart from a change the branch made, and
// how a conflict is found.
//
// Everything here is a pure function over catalogs, shared by the generator
// and the site.

import type { Aggregate, Catalog, Flow, Service, Step } from "../catalog.ts";
import { walkSteps } from "../catalog.ts";

export const DRAFT_SCHEMA = "portolan.draft/v1";

/** The entities a draft reports on: the ones a reader has a page for. */
export type DraftKind = "flow" | "service" | "aggregate" | "event";

export type DraftChange = "added" | "changed" | "removed";

/** Where an entity sits, so a page can be found for it without main's help. */
export interface DraftPlace {
  context: string;
  service?: string;
  aggregate?: string;
}

export interface DraftEntity {
  kind: DraftKind;
  id: string;
  change: DraftChange;
  place?: DraftPlace;
  /** The entity at the branch's base; absent for one the branch added. */
  base?: unknown;
  /** The entity on the branch; absent for one the branch removed. */
  branch?: unknown;
}

export interface BranchDraft {
  schema: typeof DRAFT_SCHEMA;
  /** The manifest project the draft is about. */
  project: string;
  branch: string;
  /** The commit the draft was generated from. */
  tip: string;
  /** `git merge-base main <branch>` at generation. */
  base: string;
  generatedAt: string;
  /**
   * What the branch changed in the project's files, whether or not the
   * catalog noticed. A draft with no entities is a statement - the branch
   * touched this much and none of it is modelled - and it can only be read
   * that way if the files are counted (portolan.0019).
   */
  touched?: { files: number; dirs: string[] };
  entities: DraftEntity[];
  /** Layouted LikeC4 views of the flows the branch touched, by view id. */
  views?: Record<string, unknown>;
  /** The LikeC4 model elements those views draw, by fqn. */
  elements?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// What counts as a change

/**
 * Keys that say where or when something was read, not what it is. A line
 * moving because code was added above it, a trace that saw a step, a stamp -
 * none of them is a change anybody made to the architecture.
 */
const PROVENANCE = new Set(["source", "sources", "evidence", "line", "column", "commit", "generatedAt", "examples", "seen"]);

/** An entity as it is compared: provenance dropped, keys in one order. */
export function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (PROVENANCE.has(key)) continue;
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      out[key] = comparable(item);
    }
    return out;
  }
  return value;
}

export function sameEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

// ---------------------------------------------------------------------------
// The entities of a catalog

interface Located {
  kind: DraftKind;
  id: string;
  place?: DraftPlace;
  /** The entity without the entities nested in it, which are reported on their own. */
  entity: unknown;
}

function withoutAggregates(service: Service): Omit<Service, "aggregates"> {
  const { aggregates: _aggregates, ...rest } = service;
  return rest;
}

function withoutEvents(aggregate: Aggregate): Omit<Aggregate, "events"> {
  const { events: _events, ...rest } = aggregate;
  return rest;
}

/**
 * Every flow, service, aggregate and event, keyed by kind and id. A service is
 * compared without its aggregates and an aggregate without its events: an
 * event the branch adds is one change, not three.
 */
export function entitiesOf(catalog: Catalog): Map<string, Located> {
  const out = new Map<string, Located>();
  const put = (located: Located) => out.set(`${located.kind}:${located.id}`, located);

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      put({ kind: "service", id: service.id, place: { context: context.id }, entity: withoutAggregates(service) });
      for (const aggregate of service.aggregates) {
        put({
          kind: "aggregate",
          id: aggregate.id,
          place: { context: context.id, service: service.slug },
          entity: withoutEvents(aggregate),
        });
        for (const event of aggregate.events) {
          put({
            kind: "event",
            id: event.id,
            place: { context: context.id, service: service.slug, aggregate: aggregate.slug },
            entity: event,
          });
        }
      }
    }
  }
  for (const flow of catalog.flows) put({ kind: "flow", id: flow.id, entity: flow });
  return out;
}

const KIND_ORDER: DraftKind[] = ["flow", "service", "aggregate", "event"];

/** What the branch did, entity by entity, from its base to its tip. */
export function diffBranch(base: Catalog, branch: Catalog): DraftEntity[] {
  const before = entitiesOf(base);
  const after = entitiesOf(branch);
  const out: DraftEntity[] = [];

  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      out.push({ kind: now.kind, id: now.id, change: "added", ...(now.place ? { place: now.place } : {}), branch: now.entity });
    } else if (!sameEntity(was.entity, now.entity)) {
      out.push({ kind: now.kind, id: now.id, change: "changed", ...(now.place ? { place: now.place } : {}), base: was.entity, branch: now.entity });
    }
  }
  for (const [key, was] of before) {
    if (after.has(key)) continue;
    out.push({ kind: was.kind, id: was.id, change: "removed", ...(was.place ? { place: was.place } : {}), base: was.entity });
  }

  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Against main as it is now

export type DraftState = DraftChange | "conflict";

/**
 * How a drafted entity reads against the main a site is built from. Main
 * moving the entity since the base, while the branch moved it too, is a
 * conflict; main moving it the same way the branch did is not.
 */
export function stateAgainstMain(entity: DraftEntity, main: unknown): DraftState {
  if (entity.change === "added") {
    return main !== undefined && !sameEntity(main, entity.branch) ? "conflict" : "added";
  }
  if (main === undefined) return entity.change === "removed" ? "removed" : "conflict";
  if (sameEntity(main, entity.base)) return entity.change;
  if (entity.change === "changed" && sameEntity(main, entity.branch)) return "changed";
  return "conflict";
}

/** Main's current version of every entity, keyed the way drafts key them. */
export function mainEntities(catalog: Catalog): Map<string, unknown> {
  return new Map([...entitiesOf(catalog)].map(([key, located]) => [key, located.entity]));
}

// ---------------------------------------------------------------------------
// Flow steps

export type StepChange = "added" | "changed";

export interface StepAlignment {
  /** Branch steps the branch added or changed, by the branch's step id. */
  branch: Map<string, { change: StepChange; was?: Step }>;
  /** Base steps with no counterpart on the branch, in base order. */
  removed: Step[];
  /**
   * The branch step each removed step stood after, by the removed step's id;
   * absent for one that stood before every branch step.
   */
  removedAfter: Map<string, string>;
}

function signature(step: Step): string {
  return [step.from, step.to, step.kind, step.ref ?? step.label ?? ""].join("|");
}

function shape(step: Step): string {
  return [step.from, step.to, step.kind].join("|");
}

/**
 * Pairs a flow's steps at the base with its steps on the branch by what they
 * do rather than where they stand. Step ids are positional in most extractors,
 * so a step inserted near the top would otherwise renumber every step after
 * it and read as a flow rewritten from there on.
 *
 * Steps that do the same thing are matched along the longest common sequence.
 * Between two matches, a base step and a branch step with the same ends and
 * kind are one step changed; whatever is left is added or removed.
 */
export function alignSteps(base: Flow, branch: Flow): StepAlignment {
  const was = walkSteps(base.steps);
  const now = walkSteps(branch.steps);
  const a = was.map(signature);
  const b = now.map(signature);

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const alignment: StepAlignment = { branch: new Map(), removed: [], removedAfter: new Map() };
  let gapWas: Step[] = [];
  let gapNow: Step[] = [];
  const closeGap = () => {
    const unmatched = [...gapWas];
    for (const step of gapNow) {
      const at = unmatched.findIndex((candidate) => shape(candidate) === shape(step));
      if (at >= 0) {
        alignment.branch.set(step.id, { change: "changed", was: unmatched[at]! });
        unmatched.splice(at, 1);
      } else {
        alignment.branch.set(step.id, { change: "added" });
      }
    }
    alignment.removed.push(...unmatched);
    const after = j > 0 ? now[j - 1]?.id : undefined;
    if (after) for (const step of unmatched) alignment.removedAfter.set(step.id, after);
    gapWas = [];
    gapNow = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      closeGap();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      gapNow.push(now[j]!);
      j++;
    } else {
      gapWas.push(was[i]!);
      i++;
    }
  }
  closeGap();
  return alignment;
}

/** The draft's entities narrowed to one kind, typed as that kind. */
export function draftedFlows(draft: BranchDraft): { entity: DraftEntity; base?: Flow; branch?: Flow }[] {
  return draft.entities
    .filter((entity) => entity.kind === "flow")
    .map((entity) => ({ entity, ...(entity.base ? { base: entity.base as Flow } : {}), ...(entity.branch ? { branch: entity.branch as Flow } : {}) }));
}

