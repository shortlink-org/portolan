// Chapters: the rail's second level, above steps and below the flow.
//
// A forty-five step rail is a wall. What breaks it up is already in the data —
// every alt, parallel and loop is a self-contained episode with a name of its
// own, and the plain steps between two of them are the connective tissue that
// gets the sequence from one to the next. So a chapter is exactly one of those
// two things:
//
//   * a top-level frame — the alt, the par, the loop, named by its own title;
//   * a run of top-level plain steps, named by the first and last of them.
//
// Only TOP-LEVEL nodes make chapters. A frame nested inside another frame is
// part of its parent's episode, not an episode of its own, and promoting it
// would put the same steps in two chapters at once.
//
// Chapters are derived from the FLOW, never from the filtered rail: switching
// the cross-context filter must not renumber or rename them. What the filter
// changes is which chapters have any rows left to show, and that is decided
// where the rows are grouped rather than here.

import type { Flow, FlowNode, Status, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { contextResolver } from "./cross-context";
import type { OutlineRow } from "./outline";

export type ChapterKind = "alt" | "par" | "loop" | "steps";

export interface Chapter {
  /** Stable across renders and filters: the frame's id, or the first step's. */
  id: string;
  kind: ChapterKind;
  /**
   * What this episode is called. The frame's own title for a frame — an alt
   * takes its first branch's condition, which is the question being asked —
   * and "first → last" for a run of plain steps.
   */
  title: string;
  /** Step numbers this chapter spans, 1-based over the whole flow. */
  from: number;
  to: number;
  stepIds: string[];
  /** How many steps of each status. The header's summary dots. */
  status: Record<Status, number>;
  /** Contexts these steps touch, in the order they are first touched. */
  contexts: string[];
  /** An alt whose opening branch ends the flow rather than rejoining it. */
  terminal?: boolean;
}

/** A chapter and the rail rows that fall under it, in rail order. */
export interface ChapterGroup {
  chapter: Chapter;
  rows: OutlineRow[];
}

/** What a step is called when it has to name something. */
export function stepTitle(step: Step): string {
  return step.label ?? step.ref ?? step.kind;
}

const NO_STATUS: Record<Status, number> = {
  verified: 0,
  declared: 0,
  unresolved: 0,
};

/**
 * The chapters of one flow, in walk order. A flow with no frames yields
 * exactly one chapter, so callers never need a special case for the flat
 * shape — the rail draws one header and every step under it.
 */
export function buildChapters(flow: Flow): Chapter[] {
  const contextOf = contextResolver(flow);

  // Numbering runs over every step of the flow, frames included, and matches
  // the rail's own counter because both walk the tree the same way.
  const numberOf = new Map<string, number>();
  walkSteps(flow.steps).forEach((step, i) => numberOf.set(step.id, i + 1));

  const chapters: Chapter[] = [];

  const describe = (
    id: string,
    kind: ChapterKind,
    title: string,
    steps: Step[],
    terminal?: boolean,
  ): void => {
    if (steps.length === 0) return;
    const status = { ...NO_STATUS };
    const contexts: string[] = [];
    for (const step of steps) {
      status[step.status] += 1;
      for (const participant of [step.from, step.to]) {
        const context = contextOf(participant);
        if (context && !contexts.includes(context)) contexts.push(context);
      }
    }
    const first = steps[0];
    const last = steps[steps.length - 1];
    chapters.push({
      id,
      kind,
      title,
      from: (first && numberOf.get(first.id)) ?? 0,
      to: (last && numberOf.get(last.id)) ?? 0,
      stepIds: steps.map((s) => s.id),
      status,
      contexts,
      ...(terminal ? { terminal: true } : {}),
    });
  };

  /** The plain steps seen since the last frame, waiting for a name. */
  let run: Step[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) {
      run = [];
      return;
    }
    const title =
      run.length === 1
        ? stepTitle(first)
        : `${stepTitle(first)} → ${stepTitle(last)}`;
    describe(`steps:${first.id}`, "steps", title, run);
    run = [];
  };

  for (const node of flow.steps as FlowNode[]) {
    if (node.type === "step") {
      run.push(node);
      continue;
    }

    flushRun();

    if (node.type === "alt") {
      // The alt's name is the question it asks, and the first branch is where
      // that question is written down. The other conditions are one row below
      // as `else` frames, so repeating them in the header buys nothing.
      const opening = node.branches[0];
      describe(
        node.id,
        "alt",
        opening?.title ?? "alt",
        walkSteps([node]),
        opening?.terminal,
      );
      continue;
    }

    if (node.type === "parallel") {
      describe(node.id, "par", node.title ?? "in parallel", walkSteps([node]));
      continue;
    }

    describe(node.id, "loop", node.title, walkSteps([node]));
  }

  flushRun();
  return chapters;
}

/**
 * The rail's rows, cut into their chapters.
 *
 * A frame row belongs to the chapter of the first step underneath it: a frame
 * header with no steps left after filtering is not a chapter of its own, it is
 * a header for nothing, and it goes wherever its body went. Chapters whose
 * every step was filtered away are dropped entirely rather than drawn empty.
 */
export function groupRows(
  rows: readonly OutlineRow[],
  chapters: readonly Chapter[],
): ChapterGroup[] {
  const chapterOf = new Map<string, Chapter>();
  for (const chapter of chapters) {
    for (const stepId of chapter.stepIds) chapterOf.set(stepId, chapter);
  }

  // Resolved back to front: a frame's chapter is the chapter of the next step
  // row, and reading backwards is what makes "next" available without a scan.
  const owner: (Chapter | undefined)[] = new Array(rows.length);
  let ahead: Chapter | undefined;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.type === "step") ahead = chapterOf.get(row.step.id);
    owner[i] = ahead;
  }

  const groups: ChapterGroup[] = [];
  rows.forEach((row, i) => {
    const chapter = owner[i];
    if (!chapter) return;
    const last = groups[groups.length - 1];
    if (last && last.chapter.id === chapter.id) last.rows.push(row);
    else groups.push({ chapter, rows: [row] });
  });

  return groups;
}

/**
 * The rows a chapter actually draws.
 *
 * A frame chapter's header already says the keyword and the condition, so the
 * frame row that opens it would say them twice in a row. It is dropped — but
 * only when it really is the same row: under the cross-context filter the
 * opening branch can vanish and the NEXT one is promoted to head the frame, and
 * then the row carries a condition the header does not have and has to stay.
 */
export function railRows(group: ChapterGroup): OutlineRow[] {
  const [first, ...rest] = group.rows;
  if (
    group.chapter.kind !== "steps" &&
    first?.type === "frame" &&
    first.title === group.chapter.title
  ) {
    return rest;
  }
  return group.rows;
}
