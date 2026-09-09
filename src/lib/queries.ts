// Query definitions for everything the UI reads at runtime.
//
// The loaders in github-catalog, source-code and local-api stay plain async
// functions; this module only says how their results are keyed and shared.
// Two components asking for the same branches get one request, a token change
// is a different key and so a fresh request, and a reader's "Try again"
// resets one key prefix instead of a module-level Map.
//
// Access tokens are part of the keys. The query cache lives only in this tab's
// memory, which is the same promise the forge-access provider makes, and a
// key that did not include the token would hand an authenticated reader a
// public answer, or the other way round.

import { queryOptions } from "@tanstack/react-query";
import type { Catalog } from "../catalog";
import { diffCatalogs } from "./catalog-diff";
import type { Change } from "./catalog-diff";
import { findRef } from "./forge-refs";
import { listForgeRefs, loadForgeCatalog, loadForgeCommit } from "./github-catalog";
import type { ForgeRef, ForgeRepo } from "./github-catalog";
import { localStatus } from "./local-api";
import { loadSourceCode } from "./source-code";
import type { SourceFile } from "./source-code";
import type { SourceLocation } from "./source-link";

export const forgeKeys = {
  /** Prefix for every forge read; reset it to forget branches and catalogs. */
  all: ["forge"] as const,
  refs: (repo: ForgeRepo | null, token: string) =>
    ["forge", "refs", repo?.provider ?? "", repo?.webUrl ?? "", token] as const,
  comparison: (repo: ForgeRepo | null, token: string, baseSha: string, headSha: string) =>
    ["forge", "comparison", repo?.provider ?? "", repo?.webUrl ?? "", baseSha, headSha, token] as const,
  commit: (repo: ForgeRepo | null, token: string, sha: string) =>
    ["forge", "commit", repo?.provider ?? "", repo?.webUrl ?? "", sha, token] as const,
};

export const sourceKeys = {
  all: ["source"] as const,
  file: (location: SourceLocation, token: string) =>
    location.kind === "remote"
      ? (["source", "remote", location.provider, location.repositoryUrl, location.ref, location.path, token] as const)
      : (["source", "local", location.path] as const),
};

export const localKeys = {
  status: ["local", "status"] as const,
};

/** Branches and tags of the configured forge repository. Disabled without one. */
export function forgeRefsQuery(repo: ForgeRepo | null, token: string) {
  return queryOptions({
    queryKey: forgeKeys.refs(repo, token),
    queryFn: (): Promise<ForgeRef[]> => {
      if (!repo) throw new Error("No forge repository is configured.");
      return listForgeRefs(repo, { token });
    },
    enabled: repo !== null,
  });
}

/** One immutable commit, fetched only when its hover card is open. */
export function forgeCommitQuery(repo: ForgeRepo | null, token: string, sha: string) {
  return queryOptions({
    queryKey: forgeKeys.commit(repo, token, sha),
    queryFn: () => {
      if (!repo) throw new Error("No forge repository is configured.");
      return loadForgeCommit(repo, sha, { token });
    },
    enabled: repo !== null && Boolean(sha),
    staleTime: Infinity,
  });
}

/**
 * One side of a comparison: the name a reader typed, the commit it resolves
 * to, and the catalog itself when the side is the one this build was made
 * from - that catalog is already in the bundle and is never fetched.
 */
export type ComparisonSide = {
  name: string;
  sha: string;
  catalog: Catalog | null;
};

export type Comparison = {
  changes: Change[];
  baseSha: string;
  headSha: string;
};

/**
 * Resolves a branch or tag name against the forge's refs. The current
 * branch resolves to the bundled catalog; anything else must still exist on
 * the forge, and null says it no longer does.
 */
export function comparisonSide(
  name: string,
  refs: ForgeRef[],
  current: { name: string; sha: string; catalog: Catalog },
): ComparisonSide | null {
  if (name === current.name) return { name, sha: current.sha, catalog: current.catalog };
  const ref = findRef(refs, name);
  if (!ref) return null;
  return { name, sha: ref.commit, catalog: null };
}

/** The architectural diff between two resolved sides. Disabled until both resolve. */
export function comparisonQuery(
  repo: ForgeRepo | null,
  token: string,
  base: ComparisonSide | null,
  head: ComparisonSide | null,
) {
  return queryOptions({
    queryKey: forgeKeys.comparison(repo, token, base?.sha ?? "", head?.sha ?? ""),
    queryFn: async (): Promise<Comparison> => {
      if (!repo || !base || !head) throw new Error("The comparison is not resolved yet.");
      const load = (side: ComparisonSide) =>
        side.catalog ? Promise.resolve(side.catalog) : loadForgeCatalog(repo, side.sha, { token });
      const [before, after] = await Promise.all([load(base), load(head)]);
      return { changes: diffCatalogs(before, after), baseSha: base.sha, headSha: head.sha };
    },
    enabled: repo !== null && base !== null && head !== null,
  });
}

/** One source file for the hover preview, at the catalog's commit or from the working tree. */
export function sourceCodeQuery(location: SourceLocation, token: string) {
  return queryOptions({
    queryKey: sourceKeys.file(location, token),
    queryFn: (): Promise<SourceFile> => loadSourceCode(location, token),
  });
}

/**
 * Whether a local Portolan server answers, and what it knows about the last
 * generator run. Asked again on every visit to Settings: the server can be
 * started or stopped while the tab stays open.
 */
export function localStatusQuery() {
  return queryOptions({
    queryKey: localKeys.status,
    queryFn: () => localStatus(),
    staleTime: 0,
  });
}
