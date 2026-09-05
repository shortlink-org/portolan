// Where a path in the catalog can be opened.
//
// The catalog spells sources three ways: a file, `internal/oms/app/checkout.go`;
// a file and a line, `order_repo.go:141`; and wherever else a hop was seen,
// `trace 9f2c1a../span 04`. Only the first two are places on a forge, and only
// when the forge is known.
//
// Two things can know it. The build stamp knows which repository this bundle
// was built from, which answers for every service that lives here. A repo pin
// answers for the rest: a service fetched out of another repository is on disk
// at one commit, and the pin is that commit carried into the catalog - without
// it, every source path of every vendored service is dead text, which is most
// of the point of vendoring it undone.
//
// When neither knows, the path stays what it was - text to copy - because a
// link that 404s is worse than none. Guessing `HEAD` of a repository nobody
// pinned is exactly that guess: the line number would be read against whatever
// the branch says today, which is a different file from the one the catalog
// was built from.

import type { RepoPin, Service } from "../catalog";
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
 * Whether `repo` is the repository this bundle was built from.
 *
 * `repo` is written the way go.mod writes it, `github.com/org/name`; the build
 * stamp has the same thing with a scheme. An empty `repo` is a source that
 * names no service - a hand-written flow, a glossary term - and belongs to
 * whatever this was built from.
 */
function sameRepo(repo: string, info: BuildInfo): boolean {
  if (!info.repoUrl) return false;
  if (!repo) return true;

  return bare(info.repoUrl) === bare(repo);
}

/** A repository as `host/owner/name`, however it was spelled. */
function bare(repo: string): string {
  return repo
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** GitLab keeps the tree under /-/; everything else uses /blob directly. */
function blobPath(url: string): string {
  return /gitlab/i.test(url) ? "/-/blob/" : "/blob/";
}

/** The repository a service's paths are read against, and the commit to read them at. */
interface Where {
  url: string;
  ref: string;
}

/**
 * Where `service` can be read: this repository at the built commit, or the
 * repository the service lives in at the commit it was fetched at. Null when
 * neither is known, which is the answer a link is not built from.
 */
function whereFor(
  repo: string,
  pins: readonly RepoPin[],
  info: BuildInfo,
): Where | null {
  if (sameRepo(repo, info)) {
    return { url: info.repoUrl.replace(/\/$/, ""), ref: info.commit || "HEAD" };
  }

  const pin = pins.find((p) => bare(p.repo) === bare(repo));
  if (!pin || !pin.commit) return null;

  return { url: `https://${bare(pin.repo)}`, ref: pin.commit };
}

/**
 * A link to `where` in the repository `service` lives in, or null when the
 * path is not one, or nothing knows where that repository is.
 */
export function sourceHref(
  where: string,
  service: Pick<Service, "repo"> | null | undefined,
  pins: readonly RepoPin[] = [],
  info: BuildInfo = buildInfo,
): string | null {
  const { path, line } = splitLine(where);
  if (!looksLikePath(path)) return null;
  const at = whereFor(service?.repo ?? "", pins, info);
  if (!at) return null;

  return `${at.url}${blobPath(at.url)}${at.ref}/${path}${line ? `#L${line}` : ""}`;
}

/** A link to a directory of the repository, for a service's own path. */
export function treeHref(
  path: string,
  service: Pick<Service, "repo"> | null | undefined,
  pins: readonly RepoPin[] = [],
  info: BuildInfo = buildInfo,
): string | null {
  if (!path) return null;
  const at = whereFor(service?.repo ?? "", pins, info);
  if (!at) return null;

  return `${at.url}${blobPath(at.url).replace("blob", "tree")}${at.ref}/${path.replace(/\/$/, "")}`;
}
