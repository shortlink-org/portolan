// Where a path in the catalog can be opened.
//
// The catalog spells sources three ways: a file, `internal/oms/app/checkout.go`;
// a file and a line, `order_repo.go:141`; and wherever else a hop was seen,
// `trace 9f2c1a../span 04`. Only the first two are places on a forge, and only
// when the forge is known: the build stamp knows which repository this bundle
// was built from, and a service says which repository it lives in. When the
// two are the same repository the path is a link at the built commit; when
// they differ, or nothing is known, the path stays what it was - text to copy
// - because a link that 404s is worse than none.

import type { Service } from "../catalog";
import { buildInfo } from "./build-info";
import type { BuildInfo } from "./build-info";

/** A `file:line` split, or the whole thing as a path when it is not one. */
export function splitLine(where: string): { path: string; line: number | null } {
  const m = /^(\S+?):(\d+)$/.exec(where);
  if (m) return { path: m[1]!, line: Number(m[2]) };
  return { path: where, line: null };
}

/** Whether a string is shaped like a path in a tree, not a sentence. */
function looksLikePath(path: string): boolean {
  return /^[\w./@+-]+$/.test(path) && !path.startsWith("/") && path.includes(".");
}

/**
 * The service's repository, as a URL, when it is the one this was built from.
 * `repo` is written the way go.mod writes it, `github.com/org/name`; the
 * build stamp has the same thing with a scheme.
 */
function sameRepo(repo: string, info: BuildInfo): boolean {
  if (!info.repoUrl) return false;
  if (!repo) return true;
  const built = info.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  return built.toLowerCase() === repo.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

/** GitLab keeps the tree under /-/; everything else uses /blob directly. */
function blobPath(info: BuildInfo): string {
  return /gitlab/i.test(info.repoUrl) ? "/-/blob/" : "/blob/";
}

/**
 * A link to `where` in the repository `service` lives in, or null when the
 * path is not one, or the repository is not the one this was built from.
 */
export function sourceHref(
  where: string,
  service: Pick<Service, "repo"> | null | undefined,
  info: BuildInfo = buildInfo,
): string | null {
  const { path, line } = splitLine(where);
  if (!looksLikePath(path)) return null;
  if (!sameRepo(service?.repo ?? "", info)) return null;
  const ref = info.commit || "HEAD";
  return `${info.repoUrl.replace(/\/$/, "")}${blobPath(info)}${ref}/${path}${line ? `#L${line}` : ""}`;
}

/** A link to a directory of the repository, for a service's own path. */
export function treeHref(
  path: string,
  service: Pick<Service, "repo"> | null | undefined,
  info: BuildInfo = buildInfo,
): string | null {
  if (!path || !sameRepo(service?.repo ?? "", info)) return null;
  const ref = info.commit || "HEAD";
  return `${info.repoUrl.replace(/\/$/, "")}${blobPath(info).replace("blob", "tree")}${ref}/${path.replace(/\/$/, "")}`;
}
