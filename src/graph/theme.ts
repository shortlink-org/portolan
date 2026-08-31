// The shared visual language. Both renderers speak it: these are the same
// tokens LikeC4 gets baked into its generated spec, so the seam is invisible.

import type { Status } from "../catalog";

/** Radii used by LikeC4's own nodes; React Flow nodes match them. */
export const NODE_RADIUS = 2;
export const NODE_W = 168;
export const NODE_H = 34;
export const EVENT_W = 190;

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
