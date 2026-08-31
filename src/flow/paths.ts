// A path through a flow: one way the sequence can actually run.
//
// The step tree unions every alt branch, which is right for asking "what does
// this flow touch" and wrong for asking "what happens". Those are different
// questions and this module answers the second one.
//
// Only `alt` forks. A `parallel` runs all of its branches and a `loop` runs its
// body, so neither multiplies the count; and a `terminal` alt branch ENDS the
// path, so nothing written after that alt — at any enclosing level — belongs to
// it. That last rule is the whole reason `AltBranch.terminal` exists.

import type { Alt, Flow, FlowNode } from "../catalog";

export interface PathChoice {
  /** Id of the Alt this choice was made at. */
  altId: string;
  branchIndex: number;
  /** The branch condition, verbatim. */
  title: string;
  /** This branch ends the flow rather than rejoining it. */
  terminal?: boolean;
}

export interface FlowPath {
  /** Stable across renders: the choices, in order, as "<altId>:<index>". */
  id: string;
  /** The conditions along the way, for a menu or a heading. */
  label: string;
  choices: PathChoice[];
  /** Steps on this path, in walk order. */
  stepIds: Set<string>;
  /** The path stops at a terminal branch instead of running to the end. */
  terminal: boolean;
}

export interface FlowPaths {
  paths: FlowPath[];
  /**
   * Set when enumeration hit the ceiling. The paths listed are still real; there
   * are simply more of them. Said out loud rather than truncated in silence,
   * which would read as "these are all of them".
   */
  truncated: boolean;
}

/** Enough for any flow a person is going to read; a guard, not a design limit. */
export const MAX_PATHS = 64;

/**
 * Every way this flow can run. A flow with no alt yields exactly one path with
 * no choices, so callers never need a special case for the flat shape.
 */
export function flowPaths(flow: Flow): FlowPaths {
  const out: FlowPath[] = [];
  let truncated = false;

  /**
   * Walks `nodes`, carrying the choices and steps gathered so far, and calls
   * `emit` once for every way the walk can finish. Whatever follows a frame is
   * spliced onto the front of the recursion rather than visited afterwards, so
   * a terminal branch simply never receives its siblings.
   */
  const walk = (
    nodes: FlowNode[],
    choices: PathChoice[],
    steps: string[],
    emit: (choices: PathChoice[], steps: string[], terminal: boolean) => void,
  ): void => {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node) continue;

      if (node.type === "step") {
        steps.push(node.id);
        continue;
      }

      if (node.type === "loop") {
        // The body always runs, so it neither forks nor is optional here.
        const rest = nodes.slice(i + 1);
        walk([...node.steps, ...rest], choices, steps, emit);
        return;
      }

      if (node.type === "parallel") {
        const rest = nodes.slice(i + 1);
        walk([...node.branches.flat(), ...rest], choices, steps, emit);
        return;
      }

      // An alt is the only fork. Each branch continues into whatever follows
      // the alt — unless it is terminal, in which case nothing follows it.
      const alt: Alt = node;
      const rest = nodes.slice(i + 1);
      alt.branches.forEach((branch, branchIndex) => {
        const choice: PathChoice = {
          altId: alt.id,
          branchIndex,
          title: branch.title,
          ...(branch.terminal ? { terminal: true } : {}),
        };
        const nextChoices = [...choices, choice];
        const nextSteps = [...steps];
        if (branch.terminal) {
          walk(branch.steps, nextChoices, nextSteps, (c, s) =>
            emit(c, s, true),
          );
        } else {
          walk([...branch.steps, ...rest], nextChoices, nextSteps, emit);
        }
      });
      return;
    }

    emit(choices, steps, false);
  };

  walk(flow.steps, [], [], (choices, steps, terminal) => {
    if (out.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    out.push({
      id: choices.map((c) => `${c.altId}:${c.branchIndex}`).join("|"),
      label: pathLabel(choices),
      choices,
      stepIds: new Set(steps),
      terminal,
    });
  });

  return { paths: out, truncated };
}

/** The conditions along a path, or a name for the one path a flat flow has. */
function pathLabel(choices: readonly PathChoice[]): string {
  if (choices.length === 0) return "the only path";
  return choices.map((c) => c.title).join(" · ");
}

/** The path with this id, if the flow still has one. */
export function findPath(
  paths: readonly FlowPath[],
  id: string,
): FlowPath | null {
  return paths.find((p) => p.id === id) ?? null;
}
