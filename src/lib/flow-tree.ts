// Who a flow belongs to, and how far it can be trusted.
//
// The sidebar files flows under a context rather than listing them flat,
// because "which of our flows cross into payments" is a question about the
// estate and "how many flows does shop own" is a question about a team. The
// owner is never guessed: whatever derived the flow already knew whose tree it
// read, and this module only reads the answer back out.
//
// Nothing here reads the DOM or the router, so every group, dot and count the
// tree draws can be asserted in a test.

import type { Flow, Status } from "../catalog";
import { flowContexts, walkSteps } from "../catalog";

/**
 * How far a flow can be believed, in one word.
 *
 * Three states. A flow read out of source is in one of two: either every step
 * resolves, or one points at something the catalog does not have. The third
 * is reached only by a recording of the system running - a verifier that saw
 * the hops happen - and it is held to the hops a trace can show: the call in,
 * and every message between services. A `call` on a store is never raised by
 * a trace, because a query having run is not the claim the code makes, so a
 * flow whose every rpc and event is verified is as verified as a flow gets.
 */
export type FlowHealth = "verified" | "declared" | "unresolved";

/** Order of attention: a broken flow first, a proven one last. */
const HEALTH_RANK: Record<FlowHealth, number> = {
  unresolved: 0,
  declared: 1,
  verified: 2,
};

export const FLOW_HEALTH_NOTE: Record<FlowHealth, string> = {
  unresolved: "a step in this flow points at something the catalog does not have",
  declared: "every step resolves to something the catalog has; none has been seen running",
  verified: "every call in and every message between services has been seen running",
};

export function flowHealth(flow: Flow): FlowHealth {
  const steps = walkSteps(flow.steps);
  const statuses: Status[] = steps.map((s) => s.status);
  if (statuses.some((s) => s === "unresolved")) return "unresolved";
  const hops = steps.filter((s) => s.kind !== "call");
  if (hops.length > 0 && hops.every((s) => s.status === "verified"))
    return "verified";
  return "declared";
}

/** How many steps of each status, for a card or a row that counts rather than dots. */
export function statusCounts(flow: Flow): Record<Status, number> {
  const counts: Record<Status, number> = { verified: 0, declared: 0, unresolved: 0 };
  for (const step of walkSteps(flow.steps)) counts[step.status] += 1;
  return counts;
}

/**
 * The context a flow belongs to, or null when the catalog does not say.
 *
 * Read off the flow, never worked out from it. A flow that names no owner is a
 * broken extraction, not a flow that belongs wherever its first participant
 * happens to sit - so it comes back null and the tree shows it rather than
 * filing it somewhere plausible.
 */
export function flowOwner(flow: Flow): string | null {
  return flow.owner ?? null;
}

export interface FlowEntry {
  flow: Flow;
  health: FlowHealth;
  /** Contexts the flow crosses beyond the one that owns it, in lane order. */
  reach: string[];
}

export interface FlowGroup {
  /** Context id, or null for the group of flows nothing claims. */
  owner: string | null;
  entries: FlowEntry[];
}

export function flowEntry(flow: Flow): FlowEntry {
  const owner = flowOwner(flow);
  return {
    flow,
    health: flowHealth(flow),
    reach: flowContexts(flow).filter((c) => c !== owner),
  };
}

/**
 * Flows filed under their owner. Groups are ordered by how many flows they
 * hold, so the context the estate does most of its work in is the one at the
 * top; the unowned group is always last, because it is a defect report rather
 * than a place.
 *
 * Inside a group the order is by health and then by name: a broken flow is the
 * one worth opening, and everything below it is alphabetical so a reader can
 * find a name they already know.
 */
export function groupFlowsByOwner(flows: Flow[]): FlowGroup[] {
  const byOwner = new Map<string | null, FlowEntry[]>();
  for (const flow of flows) {
    const entry = flowEntry(flow);
    const owner = flowOwner(flow);
    const list = byOwner.get(owner);
    if (list) list.push(entry);
    else byOwner.set(owner, [entry]);
  }

  const groups: FlowGroup[] = [...byOwner].map(([owner, entries]) => ({
    owner,
    entries: [...entries].sort(
      (a, b) =>
        HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
        a.flow.name.localeCompare(b.flow.name),
    ),
  }));

  groups.sort((a, b) => {
    if (a.owner === null) return 1;
    if (b.owner === null) return -1;
    return b.entries.length - a.entries.length || a.owner.localeCompare(b.owner);
  });
  return groups;
}

/**
 * How many flows a group shows before it stops listing and starts counting.
 * Past this the tree is no longer something a reader scans - the index page
 * is, and the last row says so.
 */
export const GROUP_SHOW_LIMIT = 8;
export const GROUP_SHOW_HEAD = 5;

/** The rows a group actually draws, and how many it is standing in for. */
export function visibleEntries(entries: FlowEntry[]): {
  shown: FlowEntry[];
  hidden: number;
} {
  if (entries.length <= GROUP_SHOW_LIMIT) {
    return { shown: entries, hidden: 0 };
  }
  return {
    shown: entries.slice(0, GROUP_SHOW_HEAD),
    hidden: entries.length - GROUP_SHOW_HEAD,
  };
}

/** Up to three reach dots, and what the "+n" after them stands for. */
export const REACH_DOTS = 3;

export function reachDots(reach: string[]): {
  dots: string[];
  more: number;
} {
  if (reach.length <= REACH_DOTS) return { dots: reach, more: 0 };
  return { dots: reach.slice(0, REACH_DOTS), more: reach.length - REACH_DOTS };
}
