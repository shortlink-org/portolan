import { absoluteTime } from "./format";

/**
 * What the running bundle was actually built from. Filled in at build time by
 * the `__BUILD_INFO__` define in vite.config.ts: from the Actions environment
 * on CI, from git locally. Every field can be empty, and empty means "not
 * known" — a stamp that admits it has no build number is worth more than one
 * that invents a plausible-looking sha.
 */
export type BuildInfo = {
  commit: string; // full sha
  shortCommit: string;
  branch: string;
  builtAt: string; // ISO 8601
  repo: string; // "owner/repo"
  server: string; // "https://github.com"
  runNumber: string; // the number a human reads: "#128"
  runId: string; // the number the run URL takes
  dirty: boolean; // local build with uncommitted changes
};

declare const __BUILD_INFO__: BuildInfo | undefined;

const UNKNOWN: BuildInfo = {
  commit: "",
  shortCommit: "",
  branch: "",
  builtAt: "",
  repo: "",
  server: "",
  runNumber: "",
  runId: "",
  dirty: false,
};

// The define substitutes an object literal, which `typeof` is happy to take,
// so this reads as the real build in a bundle and as UNKNOWN under vitest,
// which does not define it at all.
export const buildInfo: BuildInfo =
  typeof __BUILD_INFO__ === "undefined" ? UNKNOWN : __BUILD_INFO__;

/** The run that produced this bundle. Null when CI did not build it. */
export function runUrl(info: BuildInfo = buildInfo): string | null {
  if (!info.server || !info.repo || !info.runId) return null;
  return `${info.server}/${info.repo}/actions/runs/${info.runId}`;
}

/** The commit this bundle was built from. Null when we cannot name a repo. */
export function commitUrl(info: BuildInfo = buildInfo): string | null {
  if (!info.server || !info.repo || !info.commit) return null;
  return `${info.server}/${info.repo}/commit/${info.commit}`;
}

/**
 * What the stamp reads: the build number when there was a build, the commit
 * when it was made by hand, and "dev" when git had nothing to say either.
 * A trailing "+" means the tree had uncommitted changes.
 */
export function buildLabel(info: BuildInfo = buildInfo): string {
  if (info.runNumber) return `#${info.runNumber}`;
  if (info.shortCommit)
    return info.dirty ? `${info.shortCommit}+` : info.shortCommit;
  return "dev";
}

/** The long form, for the tooltip: every field that has an answer. */
export function buildTitle(info: BuildInfo = buildInfo): string {
  const parts: string[] = [];
  if (info.runNumber) parts.push(`build #${info.runNumber}`);
  if (info.shortCommit)
    parts.push(
      `commit ${info.shortCommit}${info.dirty ? " + uncommitted changes" : ""}`,
    );
  if (info.branch) parts.push(`branch ${info.branch}`);
  parts.push(
    info.builtAt
      ? `built ${absoluteTime(info.builtAt)}`
      : "built at an unrecorded time",
  );
  return parts.join(" · ");
}
