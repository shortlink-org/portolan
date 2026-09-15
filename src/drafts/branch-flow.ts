// A flow as a branch has it, in the catalog's own shape, so the flow page's
// own rail, table, walkthrough and detail panel read it the way they read
// main's. What the branch did to each step travels beside it as a mark, and
// the page draws the marks on the rows it already has.

import type { Flow, FlowNode, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { alignSteps } from "../lib/branch-draft";
import type { DraftEntity } from "./model";

export type StepMarkState = "added" | "changed" | "removed" | "main";

export interface StepMark {
  state: StepMarkState;
  /** The label main has, for a step the branch changed. */
  was?: string;
  /** What main did to it since the base, for a conflict. */
  note?: string;
}

export interface BranchFlow {
  /** What the rail and the table list: the branch's steps, with main's removed ones in place. */
  flow: Flow;
  /** The branch's own flow, which is what the saved view draws. */
  drawn: Flow;
  marks: Map<string, StepMark>;
}

/** The id a step the branch removed is listed under, apart from the branch's own ids. */
export function removedStepId(id: string): string {
  return `was-${id}`;
}

function insertAfter(nodes: FlowNode[], after: string, step: Step): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === "step") {
      if (node.id === after) {
        nodes.splice(i + 1, 0, step);
        return true;
      }
      continue;
    }
    if (node.type === "parallel" && node.branches.some((branch) => insertAfter(branch, after, step))) return true;
    if (node.type === "alt" && node.branches.some((branch) => insertAfter(branch.steps, after, step))) return true;
    if (node.type === "loop" && insertAfter(node.steps, after, step)) return true;
  }
  return false;
}

const label = (step: Step) => step.label ?? step.ref ?? step.kind;

/**
 * Main's flow read as the branch has it. Steps are paired by what they do
 * (alignSteps), so a step inserted near the top is one added step; a step
 * the branch dropped stays on the rail, struck through, where it stood.
 */
export function branchFlow(main: Flow, entity: DraftEntity): BranchFlow {
  const drawn = entity.versions.branch as Flow | undefined;
  if (!drawn) {
    // Removed on the branch: main's flow, every step of it gone.
    return { flow: main, drawn: main, marks: new Map(walkSteps(main.steps).map((step) => [step.id, { state: "removed" }])) };
  }
  const flow: Flow = structuredClone(drawn);
  const aligned = alignSteps(main, drawn);
  const marks = new Map<string, StepMark>();
  for (const [id, mark] of aligned.branch) {
    marks.set(id, mark.change === "added" ? { state: "added" } : { state: "changed", ...(mark.was ? { was: label(mark.was) } : {}) });
  }
  for (const removed of aligned.removed) {
    const step: Step = { ...structuredClone(removed), id: removedStepId(removed.id) };
    const after = aligned.removedAfter.get(removed.id);
    if (!after || !insertAfter(flow.steps, after, step)) flow.steps.unshift(step);
    for (const lane of [step.from, step.to]) {
      const participant = main.participants.find((candidate) => candidate.id === lane);
      if (participant && !flow.participants.some((candidate) => candidate.id === lane)) flow.participants.push(participant);
    }
    marks.set(step.id, { state: "removed" });
  }
  return { flow, drawn, marks };
}

/** The slug a branch-only flow is addressed by. */
export function addedFlowSlug(entity: DraftEntity): string {
  return (entity.versions.branch as Flow | undefined)?.slug ?? entity.id.replace(/^flow\./, "");
}

/**
 * A flow only a branch has, as the branch's catalog holds it. Every step is
 * marked added: main has none of them.
 */
export function addedFlow(entity: DraftEntity): BranchFlow | null {
  const flow = entity.versions.branch as Flow | undefined;
  if (!flow) return null;
  return { flow, drawn: flow, marks: new Map(walkSteps(flow.steps).map((step) => [step.id, { state: "added" }])) };
}
