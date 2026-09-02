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
 * Whether every hop in a flow lands somewhere the catalog knows, in one word.
 *
 * Two states, because a flow read out of source can only be in two: either
 * every step resolves, or one of them points at something the catalog does not
 * have. There is no third, better state to reach - a flow is not evidence that
 * anything ran, and a shade meaning "checked" would say it was.
 */
export type FlowHealth = "declared" | "unresolved";

/** Order of attention: a broken flow first. */
const HEALTH_RANK: Record<FlowHealth, number> = {
  unresolved: 0,
  declared: 1,
};

export const FLOW_HEALTH_NOTE: Record<FlowHealth, string> = {
  unresolved: "a step in this flow points at something the catalog does not have",
  declared: "every step resolves to something the catalog has",
};

export function flowHealth(flow: Flow): FlowHealth {
  const statuses: Status[] = walkSteps(flow.steps).map((s) => s.status);
  return statuses.some((s) => s === "unresolved") ? "unresolved" : "declared";
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
