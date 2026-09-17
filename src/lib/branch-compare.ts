import { buildInfo } from "./build-info";
import type { BuildInfo } from "./build-info";

/**
 * A forge comparison of two refs in one repository. The shape is the forge's:
 * GitLab puts `-` before it, GitHub does not, and a repository whose forge is
 * not known gets no link rather than a guessed one.
 */
export function forgeCompareHref(repoUrl: string | undefined, base: string, head: string, forge?: BuildInfo["forge"]): string | null {
  if (!repoUrl || !base || !head || base === head) return null;
  const pair = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const root = repoUrl.replace(/\/$/, "");
  return forge === "gitlab" || /gitlab/i.test(root) ? `${root}/-/compare/${pair}` : `${root}/compare/${pair}`;
}

/** A forge comparison for the selected pair, when this build knows its forge. */
export function branchCompareHref(
  base: string,
  head: string,
  info: BuildInfo = buildInfo,
): string | null {
  return forgeCompareHref(info.repoUrl, base, head, info.forge);
}
