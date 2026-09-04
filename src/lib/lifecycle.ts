// The lifecycle of an aggregate, laid out for drawing.
//
// A state machine read off code is small - a handful of states, a fan of
// moves out of the first - and the picture worth having is the one a person
// would sketch: the initial state on the left, what it can become to its
// right, and anything that leads back drawn underneath so it reads as the
// exception it is. Everything here is geometry over the catalog's own facts,
// so the diagram is asserted in a test rather than eyeballed.

import type { Lifecycle, Transition } from "../catalog";

export interface LifecycleBox {
  state: string;
  /** The state a new root starts in: the first the code lists. */
  initial: boolean;
  /** Nothing leads out: the root is a record from here on. */
  terminal: boolean;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface LifecycleEdge extends Transition {
  /** Leads to a column at or before its own: drawn underneath. */
  back: boolean;
  path: string;
  labelX: number;
  labelY: number;
}

export interface LifecycleLayout {
  width: number;
  height: number;
  boxes: LifecycleBox[];
  edges: LifecycleEdge[];
}

export interface Metrics {
  boxWidth: number;
  boxHeight: number;
  gapX: number;
  gapY: number;
  pad: number;
}

/** The gap between columns is what holds a label - `mergeInto · BasketMerged` - clear of both boxes. */
export const METRICS: Metrics = { boxWidth: 128, boxHeight: 36, gapX: 224, gapY: 28, pad: 12 };

/** How far above its line a forward label sits, so the arrow stays readable under it. */
const LIFT = 10;

/** How deep below the row of boxes a back edge dips. */
const DIP = 36;

export function isTerminal(lifecycle: Lifecycle, state: string): boolean {
  return !lifecycle.transitions.some((t) => t.from === state && t.to !== state);
}

/**
 * Columns by how many moves a state is from the initial one; a state nothing
 * reaches sits in a column of its own at the far right, so it is drawn and
 * seen rather than dropped. Rows follow the order the code listed the states.
 */
export function columnsOf(lifecycle: Lifecycle): Map<string, number> {
  const depth = new Map<string, number>();
  const [initial] = lifecycle.states;
  if (initial === undefined) return depth;
  depth.set(initial, 0);
  const queue = [initial];
  while (queue.length > 0) {
    const from = queue.shift()!;
    for (const t of lifecycle.transitions) {
      if (t.from !== from || depth.has(t.to)) continue;
      depth.set(t.to, depth.get(from)! + 1);
      queue.push(t.to);
    }
  }
  const beyond = Math.max(-1, ...depth.values()) + 1;
  for (const state of lifecycle.states) if (!depth.has(state)) depth.set(state, beyond);
  return depth;
}

export function layoutLifecycle(lifecycle: Lifecycle, m: Metrics = METRICS): LifecycleLayout {
  const columns = columnsOf(lifecycle);
  const perColumn = new Map<number, string[]>();
  for (const state of lifecycle.states) {
    const c = columns.get(state)!;
    perColumn.set(c, [...(perColumn.get(c) ?? []), state]);
  }
  const columnCount = perColumn.size === 0 ? 0 : Math.max(...perColumn.keys()) + 1;
  const tallest = Math.max(0, ...[...perColumn.values()].map((s) => s.length));
  const stride = { x: m.boxWidth + m.gapX, y: m.boxHeight + m.gapY };
  const rowsHeight = tallest * m.boxHeight + Math.max(0, tallest - 1) * m.gapY;

  const boxes: LifecycleBox[] = [];
  const at = new Map<string, LifecycleBox>();
  for (const state of lifecycle.states) {
    const column = columns.get(state)!;
    const column_ = perColumn.get(column)!;
    const row = column_.indexOf(state);
    // Each column is centred on the tallest, so a fan reads as a fan.
    const offset = (rowsHeight - (column_.length * m.boxHeight + (column_.length - 1) * m.gapY)) / 2;
    const box: LifecycleBox = {
      state,
      initial: state === lifecycle.states[0],
      terminal: isTerminal(lifecycle, state),
      column,
      row,
      x: m.pad + column * stride.x,
      y: m.pad + offset + row * stride.y,
    };
    boxes.push(box);
    at.set(state, box);
  }

  // Two moves between the same pair - a lock lapsing on a wrong password and
  // on a right one - are two edges, and each needs its own line and label:
  // the second dips deeper, or sits a step higher, than the first.
  const seen = new Map<string, number>();
  let deepest = 0;
  const edges: LifecycleEdge[] = lifecycle.transitions.map((t) => {
    const a = at.get(t.from)!;
    const z = at.get(t.to)!;
    const pair = `${t.from}→${t.to}`;
    const k = seen.get(pair) ?? 0;
    seen.set(pair, k + 1);
    const back = z.column <= a.column;
    if (!back) {
      const x1 = a.x + m.boxWidth;
      const y1 = a.y + m.boxHeight / 2;
      const x2 = z.x;
      const y2 = z.y + m.boxHeight / 2;
      const bend = (x2 - x1) / 2;
      return {
        ...t,
        back,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        labelX: (x1 + x2) / 2,
        labelY: (y1 + y2) / 2 - LIFT * (k + 1),
      };
    }
    // Underneath, from the bottom of one box to the bottom of the other.
    const x1 = a.x + m.boxWidth / 2;
    const x2 = z.x + m.boxWidth / 2;
    const y1 = a.y + m.boxHeight;
    const y2 = z.y + m.boxHeight;
    const low = m.pad + rowsHeight + DIP * (k + 1);
    deepest = Math.max(deepest, DIP * (k + 1));
    return {
      ...t,
      back,
      path: `M ${x1} ${y1} C ${x1} ${low}, ${x2} ${low}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: low - 6,
    };
  });

  return {
    width: m.pad * 2 + columnCount * m.boxWidth + Math.max(0, columnCount - 1) * m.gapX,
    height: m.pad * 2 + rowsHeight + deepest,
    boxes,
    edges,
  };
}
