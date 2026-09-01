// The shared visual language. Both renderers speak it: these are the same
// tokens LikeC4 gets baked into its generated spec, so the seam is invisible.

import type { Status } from "../catalog";

/** Radii used by LikeC4's own nodes; React Flow nodes match them. */
export const NODE_RADIUS = 2;

/**
 * The focused event graph's boxes - the only nodes elk sizes from these
 * defaults. Two lines tall: an eyebrow naming the role and the name under it.
 */
export const NODE_W = 176;
export const NODE_H = 48;
export const EVENT_W = 204;

// ---------------------------------------------------------------------------
// The dependency graph's two node kinds.
// ---------------------------------------------------------------------------

/** A service box: context bar, name, and the two traffic counters under it. */
export const SERVICE_W = 190;
export const SERVICE_H = 52;

/** An event pill. 28px is the height of a chip, which is what it is. */
export const EVENT_H = 28;
export const EVENT_MIN_W = 104;
export const EVENT_MAX_W = 260;

/** Width of a pill collapsed to its icon, at fit zooms too small to read. */
export const EVENT_ICON_W = 28;

/**
 * Below this zoom a pill's 11px mono renders under 6px on screen, which is a
 * smudge with a shape rather than a word. Pills collapse to their icon there
 * and give their name back on hover.
 *
 * The threshold is a judgement, and it is set by what the graphs actually fit
 * at. The sample estate fits a full-width pane at about 0.58, so it keeps its
 * names - small, but names; the forty-service estate fits at a third of that,
 * where a row of clean icons beats a row of grey marks. Anything in between
 * lands on the side its own fit zoom puts it.
 */
export const LEGIBLE_ZOOM = 0.55;

/**
 * How wide a pill has to be to hold a name.
 *
 * Measured rather than guessed would mean a canvas pass per label before elk
 * can start; 6.35px is the advance of the app's mono at 11px, and the box is
 * padded to the point where being a pixel out is invisible.
 */
export function eventWidth(name: string, extras = 0): number {
  const text = name.length * 6.35;
  return Math.min(EVENT_MAX_W, Math.max(EVENT_MIN_W, text + 42 + extras));
}

export function statusColor(status: Status): string {
  return `var(--status-${status})`;
}

/** Same three markers as the LikeC4 spec: solid / dashed / dotted. */
export function statusDash(status: Status): string | undefined {
  switch (status) {
    case "verified":
      return undefined;
    case "declared":
      return "5 3";
    case "unresolved":
      return "2 3";
  }
}
