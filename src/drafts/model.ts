// A saved branch draft as the pages read it (portolan.0019).
//
// The file holds what the branch did from its base: every entity it touched,
// at the base and on the branch. A page needs more than that - how the entity
// reads against the main the site is built from, a name, where main's page of
// it is, and a line or two saying what changed - so the file is presented
// once, here, and every surface reads the same answer.

import type { Aggregate, Event, Field, Flow, Service, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { alignSteps, comparable, sameEntity, stateAgainstMain } from "../lib/branch-draft";
import type { BranchDraft, DraftEntity as SavedEntity } from "../lib/branch-draft";

export type DraftState = "added" | "changed" | "conflict" | "removed";
export type DraftEntityKind = "flow" | "service" | "aggregate" | "event";

export interface DraftEntity {
  id: string;
  kind: DraftEntityKind;
  name: string;
  state: DraftState;
  /** The page of the entity on main; absent for one main does not have. */
  href?: string;
  /** The context that owns it: where the sidebar files a flow. */
  owner: string;
  /** For an event, the aggregate that announces it; for an aggregate, its service. */
  parent?: string;
  /** What the branch did to it, one line each. */
  branch: string[];
  /** What main did to it since the base, for a conflict. */
  main?: string[];
  summary?: string;
  /** The entity in the catalog's own shape: at the base, on the branch, on main now. */
  versions: { base?: unknown; branch?: unknown; main?: unknown };
  /** Systems the branch's flows call from a service that no flow on main draws. */
  newParticipants?: { id: string; label: string; from: string; via: string }[];
  /** Calls the branch adds between services of different contexts, for the context map. */
  newLinks?: { kind: "event" | "rpc"; id: string; label: string; from: string; to: string }[];
}

export type DraftHealth =
  | { kind: "fresh" }
  /** The branch has commits the draft was not generated from. */
  | { kind: "stale"; tip: string; ahead: number }
  /** The last regeneration failed; the saved draft is the previous one. */
  | { kind: "failed"; at: string; step: string; log: string[] }
  /** The branch is no longer in the repository. */
  | { kind: "gone" };

export interface Draft {
  project: string;
  projectName: string;
  branch: string;
  /** Short commits, as a reader compares them. */
  tip: string;
  base: string;
  savedAt: string;
  health: DraftHealth;
  entities: DraftEntity[];
  /** The laid-out views and the model elements they draw, as saved. */
  views: Record<string, unknown>;
  elements: Record<string, unknown>;
}

export interface BranchChoice {
  project: string;
  branch: string;
  tip: string;
  ahead: number;
}

export function draftKey(draft: { project: string; branch: string }): string {
  return `${draft.project}:${draft.branch}`;
}

export const short = (commit: string): string => commit.slice(0, 7);

// ---------------------------------------------------------------------------
// Lines

const stepLabel = (step: Step): string => step.label ?? step.ref ?? step.kind;
const stepLine = (step: Step): string => `${step.from} → ${step.to}: ${stepLabel(step)}`;

function list<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

/** Top-level keys that differ, for whatever the kind's own lines do not say. */
function otherKeys(base: object, branch: object, said: readonly string[]): string[] {
  const a = comparable(base) as Record<string, unknown>;
  const b = comparable(branch) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !said.includes(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort()
    .map((key) => `~ ${key}`);
}

export function flowLines(base: Flow | undefined, branch: Flow | undefined): string[] {
  if (!base && branch) {
    const steps = walkSteps(branch.steps);
    const lanes: string[] = [];
    for (const step of steps) for (const lane of [step.from, step.to]) if (lanes.at(-1) !== lane && !lanes.includes(lane)) lanes.push(lane);
    return [
      ...(branch.trigger ? [`+ trigger ${branch.trigger.kind} ${branch.trigger.label ?? ""}`.trimEnd()] : []),
      `+ ${steps.length} step${steps.length === 1 ? "" : "s"}: ${lanes.join(" → ")}`,
    ];
  }
  if (base && !branch) return [`- flow, ${walkSteps(base.steps).length} steps`];
  if (!base || !branch) return [];
  const aligned = alignSteps(base, branch);
  const lines: string[] = [];
  for (const step of walkSteps(branch.steps)) {
    const mark = aligned.branch.get(step.id);
    if (!mark) continue;
    if (mark.change === "added") lines.push(`+ step ${stepLine(step)}`);
    else if (mark.was && stepLabel(mark.was) !== stepLabel(step)) lines.push(`~ step ${step.id} ${stepLabel(mark.was)} → ${stepLabel(step)}`);
    else lines.push(`~ step ${stepLine(step)}`);
  }
  for (const step of aligned.removed) lines.push(`- step ${stepLine(step)}`);
  if (base.name !== branch.name) lines.push(`~ name: ${base.name} → ${branch.name}`);
  if (base.summary !== branch.summary) lines.push("~ summary");
  if (!sameEntity(base.trigger, branch.trigger)) lines.push(`~ trigger ${branch.trigger?.kind ?? "none"} ${branch.trigger?.label ?? ""}`.trimEnd());
  return lines.length > 0 ? lines : otherKeys(base, branch, ["steps", "name", "summary", "trigger"]);
}

const latest = (event: Event): Field[] => event.versions.at(-1)?.fields ?? [];

export function fieldLines(base: readonly Field[], branch: readonly Field[], noun = "field"): string[] {
  const before = list(base, (field) => field.name);
  const after = list(branch, (field) => field.name);
  const lines: string[] = [];
  for (const field of branch) {
    const was = before.get(field.name);
    if (!was) lines.push(`+ ${noun} ${field.name} ${field.type}`);
    else if (was.type !== field.type) lines.push(`~ ${noun} ${field.name} ${was.type} → ${field.type}`);
  }
  for (const field of base) if (!after.has(field.name)) lines.push(`- ${noun} ${field.name}`);
  return lines;
}

export function eventLines(base: Event | undefined, branch: Event | undefined): string[] {
  if (!base && branch) {
    return [
      `+ fields ${latest(branch).map((field) => `${field.name} ${field.type}`).join(", ") || "none"}`,
      ...(branch.wire ? [`+ wire ${branch.wire.name}`] : []),
    ];
  }
  if (base && !branch) return ["- event"];
  if (!base || !branch) return [];
  const lines = fieldLines(latest(base), latest(branch));
  if (base.versions.length !== branch.versions.length) lines.push(`~ versions ${base.versions.length} → ${branch.versions.length}`);
  if (base.versions.at(-1)?.doc !== branch.versions.at(-1)?.doc) lines.push("~ doc");
  if (!sameEntity(base.wire, branch.wire)) lines.push(`~ wire ${branch.wire?.name ?? "none"}`);
  return lines.length > 0 ? lines : otherKeys(base, branch, ["versions", "wire"]);
}

const rootOf = (aggregate: Aggregate) => {
  const blocks = aggregate.entities ?? [];
  return blocks.find((block) => block.name === aggregate.name) ?? blocks[0];
};

export function aggregateLines(base: Aggregate | undefined, branch: Aggregate | undefined): string[] {
  if (!base && branch) return [`+ aggregate, ${(branch.operations ?? []).length} operations`];
  if (base && !branch) return ["- aggregate"];
  if (!base || !branch) return [];
  const lines: string[] = [];
  const before = list(base.operations ?? [], (op) => op.id);
  const after = list(branch.operations ?? [], (op) => op.id);
  for (const op of branch.operations ?? []) if (!before.has(op.id)) lines.push(`+ ${op.kind} ${op.id}`);
  for (const op of base.operations ?? []) if (!after.has(op.id)) lines.push(`- ${op.kind} ${op.id}`);
  const [rootBefore, rootAfter] = [rootOf(base), rootOf(branch)];
  if (rootBefore && rootAfter) lines.push(...fieldLines(rootBefore.fields ?? [], rootAfter.fields ?? []));
  const blocks = (aggregate: Aggregate) => [...(aggregate.entities ?? []), ...(aggregate.valueObjects ?? [])].map((block) => block.name);
  for (const name of blocks(branch)) if (!blocks(base).includes(name)) lines.push(`+ type ${name}`);
  for (const name of blocks(base)) if (!blocks(branch).includes(name)) lines.push(`- type ${name}`);
  if (!sameEntity(base.lifecycle, branch.lifecycle)) lines.push("~ lifecycle");
  return lines.length > 0 ? lines : otherKeys(base, branch, ["operations", "entities", "valueObjects", "lifecycle"]);
}

export function serviceLines(base: Service | undefined, branch: Service | undefined): string[] {
  if (!base && branch) return [`+ service ${branch.name}`];
  if (base && !branch) return ["- service"];
  if (!base || !branch) return [];
  const lines: string[] = [];
  const methods = (service: Service) =>
    new Map((service.provides ?? []).flatMap((surface) => surface.methods.map((method) => [`${surface.id}/${method.name}`, method] as const)));
  const [methodsBefore, methodsAfter] = [methods(base), methods(branch)];
  const route = (method: { name: string; http?: { method: string; path: string } }) =>
    method.http ? `${method.http.method} ${method.http.path} (${method.name})` : method.name;
  for (const [key, method] of methodsAfter) if (!methodsBefore.has(key)) lines.push(`+ method ${route(method)}`);
  for (const [key, method] of methodsBefore) if (!methodsAfter.has(key)) lines.push(`- method ${route(method)}`);
  const messages = (service: Service) => new Set((service.provides ?? []).flatMap((surface) => (surface.messages ?? []).map((message) => message.name)));
  const [messagesBefore, messagesAfter] = [messages(base), messages(branch)];
  for (const name of messagesAfter) if (!messagesBefore.has(name)) lines.push(`+ message ${name}`);
  for (const name of messagesBefore) if (!messagesAfter.has(name)) lines.push(`- message ${name}`);
  const calls = (service: Service) => new Map((service.consumes ?? []).map((call) => [call.id, call]));
  const [callsBefore, callsAfter] = [calls(base), calls(branch)];
  for (const [id, call] of callsAfter) if (!callsBefore.has(id)) lines.push(`+ calls ${call.peer}: ${id}`);
  for (const [id, call] of callsBefore) if (!callsAfter.has(id)) lines.push(`- calls ${call.peer}: ${id}`);
  const published = (service: Service) => new Set((service.channels ?? []).flatMap((channel) => channel.messages.map((message) => message.name)));
  const [publishedBefore, publishedAfter] = [published(base), published(branch)];
  for (const name of publishedAfter) if (!publishedBefore.has(name)) lines.push(`+ publishes ${name}`);
  for (const name of publishedBefore) if (!publishedAfter.has(name)) lines.push(`- publishes ${name}`);
  return lines.length > 0 ? lines : otherKeys(base, branch, ["provides", "consumes", "channels"]);
}

function linesFor(kind: DraftEntityKind, base: unknown, branch: unknown): string[] {
  if (kind === "flow") return flowLines(base as Flow | undefined, branch as Flow | undefined);
  if (kind === "event") return eventLines(base as Event | undefined, branch as Event | undefined);
  if (kind === "aggregate") return aggregateLines(base as Aggregate | undefined, branch as Aggregate | undefined);
  return serviceLines(base as Service | undefined, branch as Service | undefined);
}

// ---------------------------------------------------------------------------
// Presenting a draft

export interface PresentContext {
  /** Main's version of every entity, keyed `<kind>:<id>` (mainEntities). */
  main: ReadonlyMap<string, unknown>;
  /** Main's page of an entity it has, by kind and id. */
  hrefOf: (kind: DraftEntityKind, id: string) => string | undefined;
  /** The context a service id belongs to, when main knows the service. */
  contextOf: (serviceId: string) => string | undefined;
  /** Every lane some flow on main draws, so a lane the branch adds reads as new. */
  knownParticipants: ReadonlySet<string>;
  projectName: string;
  health?: DraftHealth;
}

const parentOf = (id: string): string => id.split(".").slice(0, -1).join(".");

function nameOf(kind: DraftEntityKind, id: string, value: unknown): string {
  const named = value as { name?: string } | undefined;
  return named?.name ?? (kind === "flow" ? id.replace(/^flow\./, "") : id.split(".").at(-1) ?? id);
}

function summaryOf(kind: DraftEntityKind, value: unknown): string | undefined {
  if (!value) return undefined;
  if (kind === "flow") return (value as Flow).summary || undefined;
  if (kind === "event") return (value as Event).versions.at(-1)?.doc || undefined;
  return undefined;
}

/** The steps of a branch flow that main's version of the flow does not have, or all of them. */
function newSteps(saved: SavedEntity, main: Flow | undefined): Step[] {
  const branch = saved.branch as Flow | undefined;
  if (!branch) return [];
  if (!main) return walkSteps(branch.steps);
  const aligned = alignSteps(main, branch);
  return walkSteps(branch.steps).filter((step) => aligned.branch.get(step.id)?.change === "added");
}

export function presentDraft(file: BranchDraft, context: PresentContext): Draft {
  const entities: DraftEntity[] = file.entities.map((saved) => {
    const main = context.main.get(`${saved.kind}:${saved.id}`);
    const state = stateAgainstMain(saved, main);
    const value = saved.branch ?? saved.base;
    const entity: DraftEntity = {
      id: saved.id,
      kind: saved.kind,
      name: nameOf(saved.kind, saved.id, value ?? main),
      state,
      owner: (saved.kind === "flow" ? (value as Flow | undefined)?.owner : undefined) ?? saved.place?.context ?? saved.id.split(".")[0] ?? "",
      branch: linesFor(saved.kind, saved.base, saved.branch),
      versions: { ...(saved.base !== undefined ? { base: saved.base } : {}), ...(saved.branch !== undefined ? { branch: saved.branch } : {}), ...(main !== undefined ? { main } : {}) },
    };
    const href = main !== undefined ? context.hrefOf(saved.kind, saved.id) : undefined;
    if (href) entity.href = href;
    if (saved.kind === "event" || saved.kind === "aggregate") entity.parent = parentOf(saved.id);
    const summary = summaryOf(saved.kind, value);
    if (summary) entity.summary = summary;
    if (state === "conflict") entity.main = linesFor(saved.kind, saved.base, main);
    return entity;
  });

  // What the branch's flows add across the estate, filed on the entities the
  // estate-wide pictures read: the calls on the flow, the new lanes on the
  // service that calls them.
  const services = new Map(entities.filter((entity) => entity.kind === "service").map((entity) => [entity.id, entity]));
  for (const flow of file.entities.filter((saved) => saved.kind === "flow" && saved.branch)) {
    const branch = flow.branch as Flow;
    const entity = entities.find((candidate) => candidate.kind === "flow" && candidate.id === flow.id)!;
    const lanes = new Map(branch.participants.map((participant) => [participant.id, participant]));
    for (const step of newSteps(flow, context.main.get(`flow:${flow.id}`) as Flow | undefined)) {
      const [caller, callee] = [lanes.get(step.from), lanes.get(step.to)];
      if (step.kind === "rpc" && caller?.kind === "service" && callee?.kind === "service") {
        const [from, to] = [context.contextOf(callee.id) ?? callee.context, context.contextOf(caller.id) ?? caller.context];
        if (from && to && from !== to) {
          (entity.newLinks ??= []).push({ kind: "rpc", id: step.ref ?? `${callee.id}/${stepLabel(step)}`, label: stepLabel(step), from: callee.id, to: caller.id });
        }
      }
      if (callee && callee.kind !== "service" && callee.kind !== "actor" && callee.kind !== "broker" && callee.kind !== "store" && !context.knownParticipants.has(callee.id)) {
        const service = services.get(step.from);
        if (service && !(service.newParticipants ?? []).some((participant) => participant.id === callee.id)) {
          (service.newParticipants ??= []).push({ id: callee.id, label: callee.label ?? callee.id, from: step.from, via: stepLabel(step) });
        }
      }
    }
  }

  return {
    project: file.project,
    projectName: context.projectName,
    branch: file.branch,
    tip: short(file.tip),
    base: short(file.base),
    savedAt: file.generatedAt,
    health: context.health ?? { kind: "fresh" },
    entities,
    views: (file.views ?? {}) as Record<string, unknown>,
    elements: (file.elements ?? {}) as Record<string, unknown>,
  };
}
