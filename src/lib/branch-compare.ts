import { buildInfo } from "./build-info";
import type { BuildInfo } from "./build-info";

/** A forge comparison for the selected pair, when this build knows its forge. */
export function branchCompareHref(
  base: string,
  head: string,
  info: BuildInfo = buildInfo,
): string | null {
  if (!info.repoUrl || !base || !head || base === head) return null;
  const pair = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const root = info.repoUrl.replace(/\/$/, "");
  return /gitlab/i.test(root)
    ? `${root}/-/compare/${pair}`
    : `${root}/compare/${pair}`;
}
