// The small pieces every draft surface shares (portolan.0019).

import { GitBranch } from "lucide-react";
import type { DraftState } from "./model";

export const STATE_LABEL: Record<DraftState, string> = {
  added: "Added",
  changed: "Changed",
  grown: "Also on main",
  conflict: "Conflict",
  removed: "Removed",
};

export const STATE_TONE: Record<DraftState, string> = {
  added: "text-verified border-verified/30 bg-verified/5",
  changed: "text-accent border-accent/30 bg-accent/5",
  grown: "text-declared border-declared/30 bg-declared/5",
  conflict: "text-unresolved border-unresolved/30 bg-unresolved/5",
  removed: "text-muted border-line bg-surface",
};

export const STATES: DraftState[] = ["added", "changed", "grown", "conflict", "removed"];

export function StateChip({ state }: { state: DraftState }) {
  return (
    <span className={`mono shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] ${STATE_TONE[state]}`}>
      {STATE_LABEL[state]}
    </span>
  );
}

export function DraftChip({ branch }: { branch: string }) {
  return (
    <span
      className="mono inline-flex shrink-0 items-center gap-1 rounded-sm border border-dashed border-accent/50 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent"
      title={`Draft from ${branch}`}
    >
      <GitBranch size={10} aria-hidden />
      draft · {branch}
    </span>
  );
}

export function when(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
