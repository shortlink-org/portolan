import { absoluteTime } from "./format";

/**
 * What the running bundle was actually built from. Filled in at build time by
 * the `__BUILD_INFO__` define in vite.config.ts, which is the only place that
 * knows which forge and which CI produced it — by the time the value reaches
 * here the links are already resolved. Every field can be empty, and empty
 * means "not known": a stamp that admits it has no link is worth more than
 * one that guesses a URL and 404s.
 */
export type BuildInfo = {
  commit: string; // full sha
  shortCommit: string;
  branch: string;
  builtAt: string; // ISO 8601
  commitUrl: string; // the commit page on whatever forge this lives on
  buildUrl: string; // the CI run or pipeline that built it
  buildNumber: string; // the number a human reads off that pipeline
  dirty: boolean; // local build with uncommitted changes
  repoUrl: string; // the repository's page on the forge, for links into the tree
};

declare const __BUILD_INFO__: BuildInfo | undefined;

const UNKNOWN: BuildInfo = {
  commit: "",
  shortCommit: "",
  branch: "",
  builtAt: "",
  commitUrl: "",
  buildUrl: "",
  buildNumber: "",
  dirty: false,
  repoUrl: "",
};

// The define substitutes an object literal, which `typeof` is happy to take,
// so this reads as the real build in a bundle and as UNKNOWN under vitest,
// which does not define it at all.
export const buildInfo: BuildInfo =
  typeof __BUILD_INFO__ === "undefined" ? UNKNOWN : __BUILD_INFO__;

/**
 * Where the stamp goes when clicked: the commit it names, or the run that
 * built it when the forge is unknown but CI is not. Null when neither.
 */
export function buildHref(info: BuildInfo = buildInfo): string | null {
  return info.commitUrl || info.buildUrl || null;
}

/**
 * What the stamp reads: the commit, because that is the thing you can look up
 * in the repo. The build number is CI bookkeeping and lives in the tooltip.
 * A trailing "+" means the tree had uncommitted changes.
 */
export function buildLabel(info: BuildInfo = buildInfo): string {
  if (info.shortCommit)
    return info.dirty ? `${info.shortCommit}+` : info.shortCommit;
  if (info.buildNumber) return `#${info.buildNumber}`;
  return "dev";
}

/** The long form, for the tooltip: every field that has an answer. */
export function buildTitle(info: BuildInfo = buildInfo): string {
  const parts: string[] = [];
  if (info.shortCommit)
    parts.push(
      `commit ${info.shortCommit}${info.dirty ? " + uncommitted changes" : ""}`,
    );
  if (info.branch) parts.push(`branch ${info.branch}`);
  if (info.buildNumber) parts.push(`build #${info.buildNumber}`);
  parts.push(
    info.builtAt
      ? `built ${absoluteTime(info.builtAt)}`
      : "built at an unrecorded time",
  );
  return parts.join(" · ");
}
