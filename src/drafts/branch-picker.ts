// Which branches the new-draft picker offers, and in what order. A service can
// have hundreds of branches, most of them merged long ago or abandoned and
// named after a hash; the picker leads with what moved recently and finds the
// rest by search (PORTOLAN-23).

import type { BranchChoice } from "./model";

/** A branch with no commit in this many days is stale: left out until searched for or asked for. */
export const STALE_AFTER_DAYS = 90;

const DAY = 86_400_000;

const timeOf = (choice: BranchChoice): number => (choice.date ? Date.parse(choice.date) : Number.NaN);

/**
 * Whether a branch's last commit is older than the stale threshold. A branch
 * whose date the dev server did not send is not called stale: nothing says it
 * is old.
 */
export function isStale(choice: BranchChoice, now: Date): boolean {
  const at = timeOf(choice);
  return Number.isFinite(at) && now.getTime() - at > STALE_AFTER_DAYS * DAY;
}

/** Newest last commit first; a branch without a date after every dated one; then by name. */
export function byRecency(left: BranchChoice, right: BranchChoice): number {
  const l = timeOf(left);
  const r = timeOf(right);
  if (Number.isFinite(l) && Number.isFinite(r) && l !== r) return r - l;
  if (Number.isFinite(l) !== Number.isFinite(r)) return Number.isFinite(l) ? -1 : 1;
  return left.branch.localeCompare(right.branch);
}

/** Every word of the query appears in the branch name, its last commit's subject or its tip. */
export function matchesBranch(choice: BranchChoice, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${choice.branch} ${choice.subject ?? ""} ${choice.tip}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

export interface BranchList {
  /** The branches to offer, newest first. */
  shown: BranchChoice[];
  /** Stale branches that match and are left out of `shown`. */
  hidden: number;
  /** Every stale branch of the list, matching or not. */
  stale: number;
}

/**
 * The branches to offer for a query. Without one, stale branches wait behind
 * `showStale`; a search looks through all of them, because a reader who types
 * a name is asking for that branch however old it is.
 */
export function arrangeBranches(choices: BranchChoice[], { query, now, showStale }: { query: string; now: Date; showStale: boolean }): BranchList {
  const sorted = [...choices].sort(byRecency);
  const stale = sorted.filter((choice) => isStale(choice, now)).length;
  const found = sorted.filter((choice) => matchesBranch(choice, query));
  if (showStale || query.trim()) return { shown: found, hidden: 0, stale };
  const shown = found.filter((choice) => !isStale(choice, now));
  return { shown, hidden: found.length - shown.length, stale };
}

/** The branch the picker starts on: the newest one that is not stale, or the newest of all. */
export function defaultBranch(choices: BranchChoice[], now: Date): BranchChoice | undefined {
  const sorted = [...choices].sort(byRecency);
  return sorted.find((choice) => !isStale(choice, now)) ?? sorted[0];
}
