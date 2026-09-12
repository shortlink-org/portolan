// The rail's shape. A flow is a tree of frames, but a rail is a list, and the
// flattening is where the meaning usually goes missing: indentation alone
// cannot tell an alternative apart from a step that merely runs later.
//
// So the frames are flattened INTO the list rather than out of it. Every alt,
// parallel and loop keeps a header row carrying its keyword and its condition,
// in the sequence-diagram convention — alt / else, par / and, loop — and the
// steps inside it are indented under that row.

import type { Flow, FlowNode, Status, Step } from "../catalog";

export type FrameKeyword = "alt" | "else" | "par" | "and" | "loop";

export interface OutlineFrame {
  type: "frame";
  key: string;
  depth: number;
  keyword: FrameKeyword;
  /** The loop's title, the parallel's title, or the alt branch's condition. */
  title?: string;
  /** Alt branch that ends the flow instead of rejoining it. */
  terminal?: boolean;
  /** No step under this frame runs on the chosen path. */
  offPath?: boolean;
}

export interface OutlineStep {
  type: "step";
  key: string;
  depth: number;
  step: Step;
  /** Position in the flow's overall step order, 1-based, frames included. */
  number: number;
  /** True when the cross-context view would leave this step out. */
  hidden: boolean;
  /** Reserved for consumers that render an unfocused path as context. */
  offPath: boolean;
  /** True when the status filter is on and this step is not the status asked for. */
  offStatus: boolean;
}

export type OutlineRow = OutlineFrame | OutlineStep;

export interface OutlineOptions {
  /** Steps the cross-context view drops. */
  hidden: ReadonlySet<string>;
  /** When true, those steps are left out and empty frames go with them. */
  crossOnly: boolean;
  /**
   * When set, only steps on this executable path remain. The unfiltered state
   * already shows the whole decision tree; choosing a path is an explicit
   * request to focus on one run through it, not merely recolour the tree.
   */
  path?: ReadonlySet<string> | null;
  /**
   * When set, steps of other statuses are marked `offStatus`. Like `path`,
   * the step stays and recedes: the filter answers "which hops have been seen
   * running", and the answer only means something against the ones that have
   * not.
   */
  statuses?: ReadonlySet<Status> | null;
}

/**
 * Rows for one flow, in walk order. Numbering runs over every step whether it
 * is shown or not, so a filtered rail still says step 7 is the seventh step.
 */
export function buildOutline(
  flow: Flow,
  options: OutlineOptions,
): OutlineRow[] {
  let counter = 0;

  const emit = (nodes: FlowNode[], depth: number): OutlineRow[] => {
    const rows: OutlineRow[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "step": {
          counter += 1;
          const hidden = options.hidden.has(node.id);
          if (options.crossOnly && hidden) break;
          if (options.path && !options.path.has(node.id)) break;
          rows.push({
            type: "step",
            key: node.id,
            depth,
            step: node,
            number: counter,
            hidden,
            offPath: false,
            offStatus: options.statuses
              ? !options.statuses.has(node.status)
              : false,
          });
          break;
        }

        case "parallel": {
          // Branch bodies are built first: a frame whose every branch was
          // filtered away has nothing left to head, and heading nothing reads
          // as a frame that exists but is empty.
          const bodies = node.branches.map((branch) => emit(branch, depth + 1));
          let opened = false;
          bodies.forEach((body, i) => {
            if (body.length === 0) return;
            rows.push({
              type: "frame",
              key: `${node.id}:${i}`,
              depth,
              keyword: opened ? "and" : "par",
              title: opened ? undefined : node.title,
              offPath: false,
            });
            opened = true;
            rows.push(...body);
          });
          break;
        }

        case "alt": {
          const bodies = node.branches.map((branch) =>
            emit(branch.steps, depth + 1),
          );
          let opened = false;
          bodies.forEach((body, i) => {
            const branch = node.branches[i];
            // A declared branch with nothing in it is the code's way of
            // saying "or not", and needs no row. A counted one - the
            // recordings that went no further - is a fact worth a row.
            if (!branch || (body.length === 0 && !branch.seen)) return;
            rows.push({
              type: "frame",
              key: `${node.id}:${i}`,
              depth,
              keyword: opened ? "else" : "alt",
              title: branch.seen
                ? `${branch.title} · ${branch.seen.traces} ${branch.seen.traces === 1 ? "recording" : "recordings"}`
                : branch.title,
              terminal: branch.terminal,
              offPath: false,
            });
            opened = true;
            rows.push(...body);
          });
          break;
        }

        case "loop": {
          const body = emit(node.steps, depth + 1);
          if (body.length === 0) break;
          rows.push({
            type: "frame",
            key: node.id,
            depth,
            keyword: "loop",
            title: node.title,
            offPath: false,
          });
          rows.push(...body);
          break;
        }
      }
    }

    return rows;
  };

  return emit(flow.steps, 0);
}

/** Just the step rows, for anything that walks the rail rather than draws it. */
export function outlineSteps(rows: readonly OutlineRow[]): OutlineStep[] {
  return rows.filter((row): row is OutlineStep => row.type === "step");
}
