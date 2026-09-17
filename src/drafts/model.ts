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
import { forgeCompareHref } from "../lib/branch-compare";
import type { BranchDraft, DraftEntity as SavedEntity } from "../lib/branch-draft";
import type { SavedDraftStatus } from "../lib/local-api";

/**
 * How a drafted entity reads against main. `grown` is the branch and main
 * both changing one entity without touching the same thing - two calls added
 * to one service, say - which is not a conflict anybody has to resolve.
 */
export type DraftState = "added" | "changed" | "grown" | "conflict" | "removed";
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
  /** What main did to it since the base, for a conflict or a parallel change. */
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

/** What `portolan dev` says about a saved draft's branch, as the pages read it. */
export function healthFrom(status: SavedDraftStatus | undefined): DraftHealth {
  if (!status) return { kind: "fresh" };
  if (status.status === "failed" && status.failure) {
    return { kind: "failed", at: status.failure.at, step: status.failure.step ?? "", log: status.failure.message.split("\n") };
  }
  if (status.status === "gone") return { kind: "gone" };
  if (status.status === "moved" && status.currentTip) return { kind: "stale", tip: short(status.currentTip), ahead: status.ahead ?? 0 };
  return { kind: "fresh" };
}

export interface Draft {
  project: string;
  projectName: string;
  branch: string;
  /** Short commits, as a reader compares them. */
  tip: string;
  base: string;
  savedAt: string;
  health: DraftHealth;
  /** What the branch changed in the project's files, whether the catalog saw it or not. */
  touched?: { files: number; dirs: string[] };
  /** For a project drafted from a clone: where it is and when it last fetched. */
  clone?: { path: string; fetchedAt?: string };
  /** The base-to-tip comparison on the project's forge, when the manifest names one. */
  diffHref?: string;
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
  /** The main the branch is ahead of - a cloned project's own, not this repository's. */
  main?: string;
}

export function draftKey(draft: { project: string; branch: string }): string {
  return `${draft.project}:${draft.branch}`;
}

/**
 * The task a branch belongs to: the tracker key its name carries (ASUP-976),
 * or the branch name itself. One task crosses repositories - four services,
 * one ticket - and the key is the only thing those branches share; a branch
 * without one is a task of its own.
 *
 * The key is taken as written, uppercase, which is how a tracker spells it: a
 * lowercase word before a number is a branch name, not a ticket.
 */
export function taskOf(branch: string): string {
  const found = /(?:^|[/_-])([A-Z][A-Z0-9]{1,9}-\d+)(?:$|[/_-])/.exec(branch);
  return found?.[1] ?? branch;
}

/** Every draft of one task, newest save first. */
export interface DraftTask {
  key: string;
  drafts: Draft[];
  /** The branch names the task's drafts are on, in project order. */
  branches: string[];
}

/** The drafts grouped by the task their branches name, tasks in first-seen order. */
export function tasksOf(drafts: readonly Draft[]): DraftTask[] {
  const tasks = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const key = taskOf(draft.branch);
    tasks.set(key, [...(tasks.get(key) ?? []), draft]);
  }
  return [...tasks].map(([key, found]) => ({ key, drafts: found, branches: [...new Set(found.map((draft) => draft.branch))] }));
}

/** What a task changed altogether, for its one row. */
export function taskCounts(task: DraftTask): Record<DraftState, number> {
  const out: Record<DraftState, number> = { added: 0, changed: 0, grown: 0, conflict: 0, removed: 0 };
  for (const draft of task.drafts) for (const entity of draft.entities) out[entity.state] += 1;
  return out;
}

export const short = (commit: string): string => commit.slice(0, 7);

// ---------------------------------------------------------------------------
// Lines
//
// A line is what a reader sees; a mark is that line with the thing it is
// about. Two sides of one entity - what the branch did and what main did
// since the base - are compared by their subjects: sharing one is a conflict,
// sharing none is two changes that happen to be in the same entity
// (portolan.0030).

/** One thing a side did to an entity. */
export interface Mark {
  /** What the change is about, spelled the same from either side. */
  subject: string;
  line: string;
}

const mark = (subject: string, line: string): Mark => ({ subject, line });
const linesOf = (marks: Mark[]): string[] => marks.map((item) => item.line);

const stepLabel = (step: Step): string => step.label ?? step.ref ?? step.kind;
const stepLine = (step: Step): string => `${step.from} → ${step.to}: ${stepLabel(step)}`;

function list<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

/** Top-level keys that differ, for whatever the kind's own lines do not say. */
function otherKeys(base: object, branch: object, said: readonly string[]): Mark[] {
  const a = comparable(base) as Record<string, unknown>;
  const b = comparable(branch) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !said.includes(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort()
    .map((key) => mark(key, `~ ${key}`));
}

export function flowMarks(base: Flow | undefined, branch: Flow | undefined): Mark[] {
  if (!base && branch) {
    const steps = walkSteps(branch.steps);
    const lanes: string[] = [];
    for (const step of steps) for (const lane of [step.from, step.to]) if (lanes.at(-1) !== lane && !lanes.includes(lane)) lanes.push(lane);
    return [
      ...(branch.trigger ? [mark("trigger", `+ trigger ${branch.trigger.kind} ${branch.trigger.label ?? ""}`.trimEnd())] : []),
      mark("steps", `+ ${steps.length} step${steps.length === 1 ? "" : "s"}: ${lanes.join(" → ")}`),
    ];
  }
  if (base && !branch) return [mark("flow", `- flow, ${walkSteps(base.steps).length} steps`)];
  if (!base || !branch) return [];
  const aligned = alignSteps(base, branch);
  const marks: Mark[] = [];
  for (const step of walkSteps(branch.steps)) {
    const change = aligned.branch.get(step.id);
    if (!change) continue;
    // A step that was already there is named by the id it has at the base, so
    // the branch and main say the same subject about the same step.
    if (change.change === "added") marks.push(mark(`step+ ${stepLine(step)}`, `+ step ${stepLine(step)}`));
    else if (change.was && stepLabel(change.was) !== stepLabel(step)) marks.push(mark(`step ${change.was.id}`, `~ step ${step.id} ${stepLabel(change.was)} → ${stepLabel(step)}`));
    else marks.push(mark(`step ${change.was?.id ?? step.id}`, `~ step ${stepLine(step)}`));
  }
  for (const step of aligned.removed) marks.push(mark(`step ${step.id}`, `- step ${stepLine(step)}`));
  if (base.name !== branch.name) marks.push(mark("name", `~ name: ${base.name} → ${branch.name}`));
  if (base.summary !== branch.summary) marks.push(mark("summary", "~ summary"));
  if (!sameEntity(base.trigger, branch.trigger)) marks.push(mark("trigger", `~ trigger ${branch.trigger?.kind ?? "none"} ${branch.trigger?.label ?? ""}`.trimEnd()));
  return marks.length > 0 ? marks : otherKeys(base, branch, ["steps", "name", "summary", "trigger"]);
}

export function flowLines(base: Flow | undefined, branch: Flow | undefined): string[] {
  return linesOf(flowMarks(base, branch));
}

const latest = (event: Event): Field[] => event.versions.at(-1)?.fields ?? [];

export function fieldMarks(base: readonly Field[], branch: readonly Field[], noun = "field"): Mark[] {
  const before = list(base, (field) => field.name);
  const after = list(branch, (field) => field.name);
  const marks: Mark[] = [];
  for (const field of branch) {
    const was = before.get(field.name);
    if (!was) marks.push(mark(`${noun} ${field.name}`, `+ ${noun} ${field.name} ${field.type}`));
    else if (was.type !== field.type) marks.push(mark(`${noun} ${field.name}`, `~ ${noun} ${field.name} ${was.type} → ${field.type}`));
  }
  for (const field of base) if (!after.has(field.name)) marks.push(mark(`${noun} ${field.name}`, `- ${noun} ${field.name}`));
  return marks;
}

export function fieldLines(base: readonly Field[], branch: readonly Field[], noun = "field"): string[] {
  return linesOf(fieldMarks(base, branch, noun));
}

export function eventMarks(base: Event | undefined, branch: Event | undefined): Mark[] {
  if (!base && branch) {
    return [
      mark("fields", `+ fields ${latest(branch).map((field) => `${field.name} ${field.type}`).join(", ") || "none"}`),
      ...(branch.wire ? [mark("wire", `+ wire ${branch.wire.name}`)] : []),
    ];
  }
  if (base && !branch) return [mark("event", "- event")];
  if (!base || !branch) return [];
  const marks = fieldMarks(latest(base), latest(branch));
  if (base.versions.length !== branch.versions.length) marks.push(mark("versions", `~ versions ${base.versions.length} → ${branch.versions.length}`));
  if (base.versions.at(-1)?.doc !== branch.versions.at(-1)?.doc) marks.push(mark("doc", "~ doc"));
  if (!sameEntity(base.wire, branch.wire)) marks.push(mark("wire", `~ wire ${branch.wire?.name ?? "none"}`));
  return marks.length > 0 ? marks : otherKeys(base, branch, ["versions", "wire"]);
}

export function eventLines(base: Event | undefined, branch: Event | undefined): string[] {
  return linesOf(eventMarks(base, branch));
}

const rootOf = (aggregate: Aggregate) => {
  const blocks = aggregate.entities ?? [];
  return blocks.find((block) => block.name === aggregate.name) ?? blocks[0];
};

export function aggregateMarks(base: Aggregate | undefined, branch: Aggregate | undefined): Mark[] {
  if (!base && branch) return [mark("aggregate", `+ aggregate, ${(branch.operations ?? []).length} operations`)];
  if (base && !branch) return [mark("aggregate", "- aggregate")];
  if (!base || !branch) return [];
  const marks: Mark[] = [];
  const before = list(base.operations ?? [], (op) => op.id);
  const after = list(branch.operations ?? [], (op) => op.id);
  for (const op of branch.operations ?? []) if (!before.has(op.id)) marks.push(mark(`operation ${op.id}`, `+ ${op.kind} ${op.id}`));
  for (const op of base.operations ?? []) if (!after.has(op.id)) marks.push(mark(`operation ${op.id}`, `- ${op.kind} ${op.id}`));
  const [rootBefore, rootAfter] = [rootOf(base), rootOf(branch)];
  if (rootBefore && rootAfter) marks.push(...fieldMarks(rootBefore.fields ?? [], rootAfter.fields ?? []));
  const blocks = (aggregate: Aggregate) => [...(aggregate.entities ?? []), ...(aggregate.valueObjects ?? [])].map((block) => block.name);
  for (const name of blocks(branch)) if (!blocks(base).includes(name)) marks.push(mark(`type ${name}`, `+ type ${name}`));
  for (const name of blocks(base)) if (!blocks(branch).includes(name)) marks.push(mark(`type ${name}`, `- type ${name}`));
  if (!sameEntity(base.lifecycle, branch.lifecycle)) marks.push(mark("lifecycle", "~ lifecycle"));
  return marks.length > 0 ? marks : otherKeys(base, branch, ["operations", "entities", "valueObjects", "lifecycle"]);
}

export function aggregateLines(base: Aggregate | undefined, branch: Aggregate | undefined): string[] {
  return linesOf(aggregateMarks(base, branch));
}

export function serviceMarks(base: Service | undefined, branch: Service | undefined): Mark[] {
  if (!base && branch) return [mark("service", `+ service ${branch.name}`)];
  if (base && !branch) return [mark("service", "- service")];
  if (!base || !branch) return [];
  const marks: Mark[] = [];
  const methods = (service: Service) =>
    new Map((service.provides ?? []).flatMap((surface) => surface.methods.map((method) => [`${surface.id}/${method.name}`, method] as const)));
  const [methodsBefore, methodsAfter] = [methods(base), methods(branch)];
  const route = (method: { name: string; http?: { method: string; path: string } }) =>
    method.http ? `${method.http.method} ${method.http.path} (${method.name})` : method.name;
  for (const [key, method] of methodsAfter) if (!methodsBefore.has(key)) marks.push(mark(`method ${key}`, `+ method ${route(method)}`));
  for (const [key, method] of methodsBefore) if (!methodsAfter.has(key)) marks.push(mark(`method ${key}`, `- method ${route(method)}`));
  const messages = (service: Service) => new Set((service.provides ?? []).flatMap((surface) => (surface.messages ?? []).map((message) => message.name)));
  const [messagesBefore, messagesAfter] = [messages(base), messages(branch)];
  for (const name of messagesAfter) if (!messagesBefore.has(name)) marks.push(mark(`message ${name}`, `+ message ${name}`));
  for (const name of messagesBefore) if (!messagesAfter.has(name)) marks.push(mark(`message ${name}`, `- message ${name}`));
  const calls = (service: Service) => new Map((service.consumes ?? []).map((call) => [call.id, call]));
  const [callsBefore, callsAfter] = [calls(base), calls(branch)];
  for (const [id, call] of callsAfter) if (!callsBefore.has(id)) marks.push(mark(`calls ${id}`, `+ calls ${call.peer}: ${id}`));
  for (const [id, call] of callsBefore) if (!callsAfter.has(id)) marks.push(mark(`calls ${id}`, `- calls ${call.peer}: ${id}`));
  const published = (service: Service) => new Set((service.channels ?? []).flatMap((channel) => channel.messages.map((message) => message.name)));
  const [publishedBefore, publishedAfter] = [published(base), published(branch)];
  for (const name of publishedAfter) if (!publishedBefore.has(name)) marks.push(mark(`publishes ${name}`, `+ publishes ${name}`));
  for (const name of publishedBefore) if (!publishedAfter.has(name)) marks.push(mark(`publishes ${name}`, `- publishes ${name}`));
  return marks.length > 0 ? marks : otherKeys(base, branch, ["provides", "consumes", "channels"]);
}

export function serviceLines(base: Service | undefined, branch: Service | undefined): string[] {
  return linesOf(serviceMarks(base, branch));
}

function marksFor(kind: DraftEntityKind, base: unknown, other: unknown): Mark[] {
  if (kind === "flow") return flowMarks(base as Flow | undefined, other as Flow | undefined);
  if (kind === "event") return eventMarks(base as Event | undefined, other as Event | undefined);
  if (kind === "aggregate") return aggregateMarks(base as Aggregate | undefined, other as Aggregate | undefined);
  return serviceMarks(base as Service | undefined, other as Service | undefined);
}

function linesFor(kind: DraftEntityKind, base: unknown, other: unknown): string[] {
  return linesOf(marksFor(kind, base, other));
}

/**
 * What the branch did and what main did since the base, when both moved one
 * entity. A subject on both sides is a conflict - one step relabelled two
 * ways, one field retyped two ways. No shared subject is `grown`: the service
 * gained a call here and another call there, and there is nothing to resolve
 * (portolan.0030).
 */
export function gradeTogether(kind: DraftEntityKind, base: unknown, branch: unknown, main: unknown): { state: "conflict" | "grown"; main: string[] } {
  const ours = marksFor(kind, base, branch);
  const theirs = marksFor(kind, base, main);
  const said = new Set(ours.map((item) => item.subject));
  const shared = theirs.some((item) => said.has(item.subject));
  return { state: shared ? "conflict" : "grown", main: linesOf(theirs) };
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
  /** The project's repository on the forge, for a link to the branch's diff. */
  repoUrl?: string;
  /** The clone this project's branches are read from, when it has one. */
  clone?: { path: string; fetchedAt?: string };
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
    // Both sides moved one entity: whether that is a conflict depends on what
    // each of them touched, not on the fact that both did (portolan.0030).
    const together = stateAgainstMain(saved, main) === "conflict" && saved.change === "changed" && main !== undefined
      ? gradeTogether(saved.kind, saved.base, saved.branch, main)
      : null;
    const state: DraftState = together?.state ?? stateAgainstMain(saved, main);
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
    if (together) entity.main = together.main;
    else if (state === "conflict") entity.main = linesFor(saved.kind, saved.base, main);
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

  const diffHref = forgeCompareHref(context.repoUrl, file.base, file.tip);

  return {
    project: file.project,
    projectName: context.projectName,
    branch: file.branch,
    tip: short(file.tip),
    base: short(file.base),
    savedAt: file.generatedAt,
    health: context.health ?? { kind: "fresh" },
    ...(file.touched ? { touched: file.touched } : {}),
    ...(context.clone ? { clone: context.clone } : {}),
    ...(diffHref ? { diffHref } : {}),
    entities,
    views: (file.views ?? {}) as Record<string, unknown>,
    elements: (file.elements ?? {}) as Record<string, unknown>,
  };
}
