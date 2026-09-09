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
export function splitLine(where: string): {
  path: string;
  line: number | null;
} {
  const m = /^(\S+?):(\d+)$/.exec(where);
  if (m) return { path: m[1]!, line: Number(m[2]) };
  return { path: where, line: null };
}

/** Whether a string is shaped like a path in a tree, not a sentence. */
export function looksLikePath(path: string): boolean {
  // A dot or a slash is what separates `Makefile:3` and `cmd/main.go` from a
  // word somebody wrote where a path was expected; a bare `Makefile` at the
  // root of a repository is a path all the same.
  return (
    /^[\w./@+-]+$/.test(path) &&
    !path.startsWith("/") &&
    (path.includes(".") || path.includes("/") || /file$/i.test(path))
  );
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
  const built = bare(info.repoUrl);
  const declared = bare(repo);
  if (built === declared) return true;
  // Project extractors sometimes only know the checkout's directory name.
  // It still identifies this build when it is a single segment matching the
  // repository name at the end of the forge URL.
  return !declared.includes("/") && built.split("/").at(-1) === declared;
}

/** A repository as `host/owner/name`, however it was spelled. */
export function bare(repo: string): string {
  return repo
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** Translate a path in the committed vendor copy back to the remote tree. */
function repositoryPath(path: string, repo: string, info: BuildInfo): string {
  if (!repo || sameRepo(repo, info)) return path;
  const segments = bare(repo).split("/").filter(Boolean);
  if (segments.length < 3) return path;
  const root = `vendor/repos/${segments.at(-2)}/${segments.at(-1)}`;
  if (path === root) return "";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
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

export type RemoteSourceLocation = {
  kind: "remote";
  provider: "github" | "gitlab";
  origin: string;
  repositoryUrl: string;
  ref: string;
  path: string;
  line: number | null;
  href: string;
};

export type LocalSourceLocation = {
  kind: "local";
  path: string;
  line: number | null;
  href: string | null;
};

/** Everything needed to fetch and display the immutable source behind a catalog fact. */
export type SourceLocation = RemoteSourceLocation | LocalSourceLocation;

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

function providerFor(url: string, info: BuildInfo): "github" | "gitlab" | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (info.repoUrl && bare(info.repoUrl) === bare(url) && info.forge)
    return info.forge;
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.includes("gitlab")) return "gitlab";
  return null;
}

/**
 * Resolve a catalog source to a fetchable location. When no forge is known,
 * the same relative path can still be served by Portolan's localhost-only
 * control plane in local mode.
 */
export function sourceLocation(
  where: string,
  service: Pick<Service, "repo"> | null | undefined,
  pins: readonly RepoPin[] = [],
  info: BuildInfo = buildInfo,
): SourceLocation | null {
  const { path, line } = splitLine(where);
  if (!looksLikePath(path)) return null;
  const repo = service?.repo ?? "";
  const at = whereFor(repo, pins, info);
  const href = at
    ? `${at.url}${blobPath(at.url)}${at.ref}/${repositoryPath(path, repo, info)}${line ? `#L${line}` : ""}`
    : null;
  if (!at) return { kind: "local", path, line, href: null };

  const provider = providerFor(at.url, info);
  if (!provider) return { kind: "local", path, line, href };
  return {
    kind: "remote",
    provider,
    origin: new URL(at.url).origin,
    repositoryUrl: at.url,
    ref: at.ref,
    path: repositoryPath(path, repo, info),
    line,
    href: href!,
  };
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
  return sourceLocation(where, service, pins, info)?.href ?? null;
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

  const remotePath = repositoryPath(
    path.replace(/\/$/, ""),
    service?.repo ?? "",
    info,
  );
  return `${at.url}${blobPath(at.url).replace("blob", "tree")}${at.ref}${remotePath ? `/${remotePath}` : ""}`;
}
