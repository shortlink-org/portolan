// The whole path, not one service's slice of it.
//
// A flow stops where its service stops. The step that calls the next service
// is the end of this story and the beginning of another one, and the catalog
// already knows which: `continues.ts` pairs a step with the flow that opens
// where it lands. Until now that pairing was a link - the reader jumped, and
// the thread they were following stayed on the page behind them.
//
// So a journey is that pairing, followed: the rows of this flow, and under a
// step the reader opened, the rows of the flow it continues in, indented and
// marked with whose they are. Nothing is composed in the catalog and nothing
// is written down; the fragments are unchanged, and what this builds is a
// reading of them, one the address can carry (`?open=`) so a path opened is a
// path that can be sent to somebody.
//
// Two guards, both of which say so on the row rather than silently stopping:
// a flow already on the path is not opened again - a service that calls back
// into its caller is a cycle, not an infinite story - and the path stops at
// `MAX_DEPTH` flows deep, because a reader who has gone four services down is
// reading a different question from the one they opened.

import type { Alt, Flow, FlowNode, Parallel, Participant, Step } from "../catalog.ts";
import type { Chapter, ChapterGroup } from "./chapters.ts";
import { railRows } from "./chapters.ts";
import { continuationIndex, openingStep } from "./continues.ts";
import type { Continuation } from "./continues.ts";
import { buildOutline } from "./outline.ts";
import type { OutlineFrame, OutlineRow, OutlineStep } from "./outline.ts";

/** How many flows deep a path is followed before it says "far enough". */
export const MAX_DEPTH = 4;

/** Which flow a row came from, absent for the rows of the flow on screen. */
export interface JourneyOrigin {
  slug: string;
  name: string;
  /** The service the flow belongs to, for the reader who is counting hops. */
  service: string;
  /** How many flows deep: 1 for the first one opened. */
  depth: number;
}

export type JourneyStep = OutlineStep & { origin?: JourneyOrigin };
export type JourneyFrame = OutlineFrame & { origin?: JourneyOrigin };

/** The row a continuation is: a door, open or closed, with what is behind it. */
export interface JourneyEntry {
  type: "entered";
  /** What `?open=` carries: the step's row key and the flow it continues in. */
  key: string;
  depth: number;
  via: Continuation;
  service: string;
  /** Steps behind the door, so a closed one can say what it costs to open. */
  steps: number;
  open: boolean;
  /** The flow is already on this path: opening it again would go round. */
  repeats?: boolean;
  /** The path has gone as deep as it goes. */
  deepest?: boolean;
}

export type JourneyRow = JourneyStep | JourneyFrame | JourneyEntry;

export interface JourneyGroup {
  chapter: Chapter;
  rows: JourneyRow[];
}

export interface JourneyOptions {
  /** The flow on screen: where the path starts, and the first slug on it. */
  flow: Flow;
  /** Every flow of the catalog: where a continuation is looked up. */
  flows: readonly Flow[];
  /** The flow on screen, by step id; computed once by the page. */
  continuations: ReadonlyMap<string, Continuation[]>;
  /** The entry keys the reader has opened. */
  opened: ReadonlySet<string>;
  /**
   * Whether an opened continuation is unfolded into this rail. False when the
   * reader opens it as a document of its own (portolan.0028): the door still
   * says what is behind it and that it is open, and the flow is read in its
   * own window rather than inside this one's list.
   */
  expand?: boolean;
  maxDepth?: number;
}

/**
 * The rail's groups with every opened continuation followed into them.
 *
 * The rows of the flow on screen are untouched - its filters, numbering and
 * chapters are the page's, not this module's - and what is added sits under
 * the step it belongs to.
 */
export function journeyGroups(groups: readonly ChapterGroup[], options: JourneyOptions): JourneyGroup[] {
  const reader = new Reader(options);
  return groups.map((group) => ({
    chapter: group.chapter,
    // The flow on screen is the first one on the path: a flow that comes round
    // to it is a cycle like any other.
    rows: reader.rows(group.rows, options.continuations, [options.flow.slug], 0, ""),
  }));
}

/**
 * Every entry key of the path, opened as far as the guards allow: what the
 * "expand all" control opens, computed the same way the rail draws it so the
 * two cannot disagree.
 */
export function openEverything(groups: readonly ChapterGroup[], options: Omit<JourneyOptions, "opened">): Set<string> {
  const opened = new Set<string>();
  // Each pass opens the doors it can see; a door behind a door only appears
  // once the first is open, so the passes run until nothing new turns up.
  for (let pass = 0; pass < (options.maxDepth ?? MAX_DEPTH); pass += 1) {
    const before = opened.size;
    for (const group of journeyGroups(groups, { ...options, opened })) {
      for (const row of group.rows) {
        if (row.type === "entered" && !row.open && !row.repeats && !row.deepest) opened.add(row.key);
      }
    }
    if (opened.size === before) break;
  }
  return opened;
}

/**
 * What the path is: the doors it shows, how many stand open, and what the open
 * ones added. The toolbar says it, so a reader knows what following costs
 * before they follow.
 */
export function journeyReach(groups: readonly JourneyGroup[]): {
  doors: number;
  open: number;
  steps: number;
  services: number;
} {
  const services = new Set<string>();
  let steps = 0;
  let doors = 0;
  let open = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.type === "entered") {
        doors += 1;
        if (row.open) open += 1;
        continue;
      }
      if (!row.origin) continue;
      if (row.type === "step") steps += 1;
      services.add(row.origin.service);
    }
  }
  return { doors, open, steps, services: services.size };
}

/**
 * The opened path as one flow.
 *
 * The rail reads a journey row by row; anything that draws a sequence - the
 * Mermaid copy, and whatever else wants the whole story in one object - wants
 * a flow. So the followed flows' nodes are spliced in after the step that
 * calls them, with every id spelled from the door it came through, which is
 * the same spelling the rail and the address use. Nothing here is written to
 * the catalog: this is the reading, built when it is asked for.
 */
export function journeyFlow(options: JourneyOptions): Flow {
  const bySlug = new Map(options.flows.map((flow) => [flow.slug, flow]));
  const opened = options.opened;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const participants: Participant[] = [...options.flow.participants];
  /** Each followed flow's own continuations, looked up when it is entered. */
  const indexes = new Map<string, ReadonlyMap<string, Continuation[]>>();
  const join = (more: readonly Participant[]): void => {
    for (const participant of more) {
      if (!participants.some((seen) => seen.id === participant.id)) participants.push(participant);
    }
  };

  const compose = (nodes: readonly FlowNode[], prefix: string, path: readonly string[]): FlowNode[] => {
    const out: FlowNode[] = [];
    for (const node of nodes) {
      const id = prefix ? `${prefix}/${node.id}` : node.id;
      switch (node.type) {
        case "step": {
          const step: Step = { ...node, id };
          out.push(step);
          for (const via of continuationsOfStep(node, path, prefix)) out.push(...via);
          break;
        }
        case "parallel": {
          const parallel: Parallel = {
            ...node,
            id,
            branches: node.branches.map((branch) => compose(branch, prefix, path)),
          };
          out.push(parallel);
          break;
        }
        case "alt": {
          const alt: Alt = {
            ...node,
            id,
            branches: node.branches.map((branch) => ({ ...branch, steps: compose(branch.steps, prefix, path) })),
          };
          out.push(alt);
          break;
        }
        case "loop": {
          out.push({ ...node, id, steps: compose(node.steps, prefix, path) });
          break;
        }
      }
    }
    return out;
  };

  /** What an open door on this step adds: the other flow, composed in turn. */
  const continuationsOfStep = (step: Step, path: readonly string[], prefix: string): FlowNode[][] => {
    const stepKey = prefix ? `${prefix}/${step.id}` : step.id;
    const index = path.length === 1 ? options.continuations : indexes.get(path[path.length - 1] ?? "");
    const out: FlowNode[][] = [];
    for (const via of index?.get(step.id) ?? []) {
      const key = `${stepKey}>${via.slug}`;
      const flow = bySlug.get(via.slug);
      if (!flow || !opened.has(key) || path.includes(via.slug) || path.length > maxDepth) continue;
      const renamed = callerLane(flow);
      join(flow.participants.filter((participant) => !(answersTheCall(via) && participant.id === renamed)));
      indexes.set(flow.slug, continuationIndex(flow, options.flows));
      out.push(compose(followedSteps(flow, via, step.from), key, [...path, flow.slug]));
    }
    return out;
  };

  const steps = compose(options.flow.steps, "", [options.flow.slug]);
  return { ...options.flow, participants, steps };
}

/** Every step row of the journey, in rail order: what the keyboard walks. */
export function journeySteps(groups: readonly JourneyGroup[]): JourneyStep[] {
  return groups.flatMap((group) => group.rows.filter((row): row is JourneyStep => row.type === "step"));
}

/**
 * Whether the continuation is the call being answered, rather than a message
 * arriving: a flow that answers a call opens with that same call, seen from
 * the other side, and drawing it again would say the hop happened twice.
 * A published event is not that - the send and the receive are two hops -
 * and neither is a job handed to a queue.
 */
function answersTheCall(via: Continuation): boolean {
  return via.kind === "contract";
}

/**
 * The steps of a followed flow as they read on this path: less the call this
 * step already is, and with the callee's own caller lane named after who is
 * actually calling. A flow read on its own says `client`, because from where
 * it was read that is who calls; inside a path the caller is the service one
 * hop up, and a picture that still said `client` would put the reader's
 * browser where a service stands.
 */
function followedSteps(flow: Flow, via: Continuation, caller: string): FlowNode[] {
  const steps = answersTheCall(via) && flow.steps[0]?.type === "step" ? flow.steps.slice(1) : flow.steps;
  const actor = callerLane(flow);
  return answersTheCall(via) && actor && actor !== caller ? rename(steps, actor, caller) : steps;
}

/** The lane a flow's own caller stands in, when it has one. */
function callerLane(flow: Flow): string | undefined {
  const opening = flow.steps[0];
  const from = opening?.type === "step" ? opening.from : undefined;
  return flow.participants.find((participant) => participant.id === from && participant.kind === "actor")?.id;
}

function rename(nodes: readonly FlowNode[], from: string, to: string): FlowNode[] {
  return nodes.map((node) => {
    switch (node.type) {
      case "step":
        return { ...node, from: node.from === from ? to : node.from, to: node.to === from ? to : node.to };
      case "parallel":
        return { ...node, branches: node.branches.map((branch) => rename(branch, from, to)) };
      case "alt":
        return { ...node, branches: node.branches.map((branch) => ({ ...branch, steps: rename(branch.steps, from, to) })) };
      case "loop":
        return { ...node, steps: rename(node.steps, from, to) };
    }
  });
}

/** The service a flow belongs to: where its opening step lands. */
export function flowService(flow: Flow): string {
  const opening = openingStep(flow);
  const participants = flow.participants.filter((participant) => participant.kind === "service");
  const landed = participants.find((participant) => participant.id === opening?.to);
  return landed?.id ?? participants[0]?.id ?? flow.owner;
}

/** The reading, with what it has already looked up kept between the recursions. */
class Reader {
  private readonly flows: readonly Flow[];
  private readonly opened: ReadonlySet<string>;
  private readonly expand: boolean;
  private readonly maxDepth: number;
  private readonly bySlug: Map<string, Flow>;
  private readonly indexes = new Map<string, ReadonlyMap<string, Continuation[]>>();
  private readonly outlines = new Map<string, OutlineRow[]>();

  constructor(options: JourneyOptions) {
    this.flows = options.flows;
    this.opened = options.opened;
    this.expand = options.expand ?? true;
    this.maxDepth = options.maxDepth ?? MAX_DEPTH;
    this.bySlug = new Map(options.flows.map((flow) => [flow.slug, flow]));
  }

  /**
   * One flow's rows, with the doors under them. `path` is the flows already
   * entered, which is what makes a cycle a row rather than a hang; `prefix`
   * keeps a nested row's key unique, since two flows both call their first
   * step `s1`.
   */
  rows(
    source: readonly OutlineRow[],
    continuations: ReadonlyMap<string, Continuation[]>,
    path: readonly string[],
    indent: number,
    prefix: string,
    origin?: JourneyOrigin,
  ): JourneyRow[] {
    const out: JourneyRow[] = [];
    for (const row of source) {
      const key = prefix ? `${prefix}/${row.key}` : row.key;
      out.push({ ...row, key, depth: row.depth + indent, ...(origin ? { origin } : {}) } as JourneyRow);
      if (row.type !== "step") continue;
      for (const via of continuations.get(row.step.id) ?? []) {
        out.push(...this.door(via, key, row.depth + indent, path, row.step.from));
      }
    }
    return out;
  }

  /** A continuation as a row, and what is behind it when the reader opened it. */
  private door(via: Continuation, stepKey: string, indent: number, path: readonly string[], caller: string): JourneyRow[] {
    const key = `${stepKey}>${via.slug}`;
    const flow = this.bySlug.get(via.slug);
    // The flow on screen is the first entry on the path and is not a hop.
    const depth = path.length;
    const repeats = path.includes(via.slug);
    const deepest = depth > this.maxDepth;
    const open = !repeats && !deepest && this.opened.has(key) && flow !== undefined;
    const entry: JourneyEntry = {
      type: "entered",
      key,
      // Under the step it belongs to, at the indent its rows will have.
      depth: indent + 1,
      via,
      service: flow ? flowService(flow) : "",
      steps: flow ? this.outline(flow, via, caller).filter((row) => row.type === "step").length : 0,
      open,
      ...(repeats ? { repeats: true } : {}),
      ...(deepest ? { deepest: true } : {}),
    };
    if (!open || !flow || !this.expand) return [entry];
    const origin: JourneyOrigin = {
      slug: flow.slug,
      name: flow.name,
      service: entry.service,
      depth,
    };
    // The door heads what it opens: both sit one indent under the step.
    return [entry, ...this.rows(this.outline(flow, via, caller), this.index(flow), [...path, flow.slug], indent + 1, key, origin)];
  }

  /**
   * A followed flow's own rows: its whole tree, unfiltered. The filters on
   * screen - a chosen path, a status, the cross-context switch - are answers
   * about the flow the reader opened, and applying them to another service's
   * flow would hide steps for a reason that flow never heard.
   */
  private outline(flow: Flow, via: Continuation, caller: string): OutlineRow[] {
    const key = `${flow.slug}|${answersTheCall(via)}|${caller}`;
    const hit = this.outlines.get(key);
    if (hit) return hit;
    const rows = buildOutline({ ...flow, steps: followedSteps(flow, via, caller) }, {
      hidden: new Set<string>(),
      crossOnly: false,
      path: null,
      statuses: null,
    });
    this.outlines.set(key, rows);
    return rows;
  }

  private index(flow: Flow): ReadonlyMap<string, Continuation[]> {
    const hit = this.indexes.get(flow.slug);
    if (hit) return hit;
    const built = continuationIndex(flow, this.flows);
    this.indexes.set(flow.slug, built);
    return built;
  }
}

/** The rows of a group as the rail draws them, doors included. */
export function journeyRailRows(group: JourneyGroup): JourneyRow[] {
  return railRows(group);
}
