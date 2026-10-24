import type { SpecHistoryEntry } from "virtual:portolan-spec-history";
import type { ChangeSpec } from "../catalog";
import type { Change, Severity } from "./catalog-diff";
import { diffSpecification } from "./catalog-diff";
import type { PathImpact } from "./path-impact";

export type ActivityEvidence = "author-intent" | "catalog-diff" | "git-history" | "changed-with";

export interface ActivityLink {
  label: string;
  href?: string;
  external?: boolean;
}

export interface SpecActivityEvent {
  key: string;
  kind: string;
  timestamp?: string;
  summary: string;
  evidence: ActivityEvidence;
  severity?: Severity;
  source?: ActivityLink;
  architecture?: ActivityLink;
}

export interface SpecActivityInput {
  spec?: ChangeSpec;
  previous?: ChangeSpec;
  changes?: readonly Change[];
  history?: readonly SpecHistoryEntry[];
  impact?: readonly PathImpact[];
  hrefForCatalogId?: (id: string) => string | undefined;
  hrefForSpecSubject?: (change: Change) => string | undefined;
}

const time = (value: string | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

/** Newest first; equal or missing dates are stable across runtimes and inputs. */
export function sortSpecActivity(events: readonly SpecActivityEvent[]): SpecActivityEvent[] {
  return [...events].sort(
    (left, right) =>
      time(right.timestamp) - time(left.timestamp) ||
      left.kind.localeCompare(right.kind) ||
      left.key.localeCompare(right.key),
  );
}

function historyHref(entry: SpecHistoryEntry, commit: string): string | undefined {
  if (!entry.repository) return undefined;
  const route = /gitlab/i.test(entry.repository) ? "/-/blob/" : "/blob/";
  const path = entry.source.split("/").map(encodeURIComponent).join("/");
  return `${entry.repository.replace(/\/$/, "")}${route}${encodeURIComponent(commit)}/${path}`;
}

function historyEvents(entries: readonly SpecHistoryEntry[]): SpecActivityEvent[] {
  const events: SpecActivityEvent[] = [];
  for (const entry of entries) {
    if (entry.status !== "available" || !entry.first || !entry.latest) {
      events.push({
        key: `git:unavailable:${entry.source}:${entry.reason ?? "unknown"}`,
        kind: "git.unavailable",
        summary: `History is unavailable for ${entry.source}: ${(entry.reason ?? "unknown").replaceAll("-", " ")}`,
        evidence: "git-history",
        source: { label: entry.source },
      });
      continue;
    }
    const commits = entry.first.commit === entry.latest.commit
      ? [{ phase: "introduced", commit: entry.first }]
      : [{ phase: "introduced", commit: entry.first }, { phase: "changed", commit: entry.latest }];
    for (const item of commits) {
      events.push({
        key: `git:${item.commit.commit}:${entry.source}:${item.phase}`,
        kind: `git.${item.phase}`,
        timestamp: item.commit.date,
        summary: `${entry.source} was ${item.phase} in ${item.commit.commit.slice(0, 7)} by ${item.commit.author}`,
        evidence: "git-history",
        source: { label: entry.source, href: historyHref(entry, item.commit.commit), external: true },
      });
    }
    if (entry.uncommitted) {
      events.push({
        key: `git:uncommitted:${entry.source}`,
        kind: "git.uncommitted",
        summary: `${entry.source} has uncommitted changes`,
        evidence: "git-history",
        source: { label: entry.source },
      });
    }
  }
  return events;
}

function currentIntentEvents(spec: ChangeSpec): SpecActivityEvent[] {
  return [
    {
      key: `intent:lifecycle:${spec.id}:${spec.lifecycle}`,
      kind: "spec.lifecycle",
      summary: `Lifecycle is ${spec.lifecycle}`,
      evidence: "author-intent",
      source: { label: spec.source },
    },
    ...spec.tasks.filter((task) => task.done).map((task): SpecActivityEvent => ({
      key: `intent:task:${spec.id}:${task.id}:completed`,
      kind: "task.completed",
      summary: `${task.id} is marked complete`,
      evidence: "author-intent",
      source: { label: task.source, href: `#spec-task-${encodeURIComponent(task.id)}` },
    })),
  ];
}

function changeEvents(changes: readonly Change[], hrefForSubject?: (change: Change) => string | undefined): SpecActivityEvent[] {
  return changes.map((change) => ({
    key: `diff:${change.kind}:${change.where}:${change.summary}`,
    kind: change.kind,
    summary: change.summary,
    evidence: "catalog-diff",
    severity: change.severity,
    source: { label: change.where, href: hrefForSubject?.(change) },
  }));
}

function impactEvents(impact: readonly PathImpact[], hrefForCatalogId?: (id: string) => string | undefined): SpecActivityEvent[] {
  return impact.map((item) => {
    const architecture = item.level === "service"
      ? { label: item.service, href: hrefForCatalogId?.(item.service) }
      : item.reason === "ambiguous"
        ? { label: `repository · ambiguous (${item.candidates.join(", ")})` }
        : { label: "repository · unmatched" };
    return {
      key: `impact:${item.repository}:${item.path}`,
      kind: "path.impact",
      summary: `${item.path} changed with ${architecture.label}`,
      evidence: "changed-with",
      source: { label: item.path },
      architecture,
    };
  });
}

/** Project every available evidence source into one normalized activity stream. */
export function projectSpecActivity(input: SpecActivityInput): SpecActivityEvent[] {
  const changes = input.changes ?? (input.spec && input.previous ? diffSpecification(input.previous, input.spec) : []);
  const intent = input.spec && !input.previous && !input.changes ? currentIntentEvents(input.spec) : [];
  return sortSpecActivity([
    ...historyEvents(input.history ?? []),
    ...changeEvents(changes, input.hrefForSpecSubject),
    ...impactEvents(input.impact ?? [], input.hrefForCatalogId),
    ...intent,
  ]);
}
