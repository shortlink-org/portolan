// Who a flow belongs to, and how far it can be trusted.
//
// The sidebar files flows under a context rather than listing them flat,
// because "which of our flows cross into payments" is a question about the
// estate and "how many flows does shop own" is a question about a team. The
// owner is never guessed: each provenance already carries the answer, and this
// module only reads it back out.
//
// Nothing here reads the DOM or the router, so every group, dot and count the
// tree draws can be asserted in a test.

import type { CatalogIndex, Flow, Status } from "../catalog";
import { flowContexts, walkSteps } from "../catalog";

/**
 * How far a flow has been made good on, in one word.
 *
 * `unresolved` is a defect: a step points at something the catalog does not
 * have. `unverified` is the absence of evidence rather than evidence of
 * absence - an authored flow nobody has watched run. `mixed` is the ordinary
 * middle, and `verified` is the only state that claims anything.
 */
export type FlowHealth = "verified" | "mixed" | "unresolved" | "unverified";

/** Order of attention: a broken flow first, a settled one last. */
const HEALTH_RANK: Record<FlowHealth, number> = {
  unresolved: 0,
  mixed: 1,
  unverified: 2,
  verified: 3,
};

export const FLOW_HEALTH_NOTE: Record<FlowHealth, string> = {
  unresolved: "a step in this flow points at something the catalog does not have",
  mixed: "some steps are verified, some are only declared",
  unverified: "written by hand; no step here has been observed running",
  verified: "every step has been observed running",
};

export function flowHealth(flow: Flow): FlowHealth {
  const statuses: Status[] = walkSteps(flow.steps).map((s) => s.status);
  if (statuses.some((s) => s === "unresolved")) return "unresolved";
  if (statuses.length > 0 && statuses.every((s) => s === "verified")) {
    return "verified";
  }
  // An authored flow with nothing verified is not "mixed": nothing about it
  // has been checked at all, and amber would claim a partial verification the
  // catalog never made.
  if (!statuses.some((s) => s === "verified")) return "unverified";
  return "mixed";
}

/**
 * The context a flow belongs to, or null when the catalog does not say.
 *
 * One rule per provenance, and no fallbacks between them. A derived-from-test
 * flow whose source names no service is a broken extraction, not a flow that
 * belongs wherever its first participant happens to sit - so it comes back
 * null and the tree shows it rather than filing it somewhere plausible.
 */
export function flowOwner(flow: Flow, index: CatalogIndex): string | null {
  switch (flow.provenance) {
    case "authored":
      return flow.owner ?? null;
    case "derived-from-test":
      return contextOfSource(flow.source, index);
    case "derived-from-otel":
      return firstServiceContext(flow, index);
  }
}

/**
 * The context owning the service whose tree the file sits in. Services declare
 * a `path`, and a test file under that path was written by that service's
 * team; the longest matching path wins, so a service nested inside another
 * one's directory still claims its own tests.
 */
function contextOfSource(
  source: string | undefined,
  index: CatalogIndex,
): string | null {
  if (!source) return null;
  let best: { path: string; serviceId: string } | null = null;
  for (const [serviceId, service] of index.serviceById) {
    const path = service.path;
    if (!path) continue;
    if (source !== path && !source.startsWith(`${path}/`)) continue;
    if (!best || path.length > best.path.length) best = { path, serviceId };
  }
  return best ? (index.serviceContext.get(best.serviceId)?.id ?? null) : null;
}

/** The context of the first participant that is a service of this estate. */
function firstServiceContext(flow: Flow, index: CatalogIndex): string | null {
  for (const participant of flow.participants) {
    if (participant.kind !== "service") continue;
    const context = index.serviceContext.get(participant.id);
    if (context) return context.id;
  }
  return null;
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

export function flowEntry(flow: Flow, index: CatalogIndex): FlowEntry {
  const owner = flowOwner(flow, index);
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
export function groupFlowsByOwner(
  flows: Flow[],
  index: CatalogIndex,
): FlowGroup[] {
  const byOwner = new Map<string | null, FlowEntry[]>();
  for (const flow of flows) {
    const entry = flowEntry(flow, index);
    const owner = flowOwner(flow, index);
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
