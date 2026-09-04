// A route is planned, driven, and closed. Nothing leads out of `closed`: the
// day is over and what happened is history.

export type RouteStatus = "planned" | "driving" | "closed";

export const TRANSITIONS: Readonly<Record<RouteStatus, readonly RouteStatus[]>> = {
  planned: ["driving", "closed"],
  driving: ["closed"],
  closed: [],
};

export function canMove(from: RouteStatus, to: RouteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
