import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog";
import type { ForgeRef, ForgeRepo } from "./github-catalog";
import {
  comparisonQuery,
  comparisonSide,
  forgeKeys,
  forgeRefsQuery,
  localStatusQuery,
  sourceCodeQuery,
  sourceKeys,
} from "./queries";
import type { RemoteSourceLocation, SourceLocation } from "./source-link";

const REPO: ForgeRepo = {
  provider: "github",
  owner: "acme",
  repo: "portolan",
  webUrl: "https://github.com/acme/portolan",
};
const OTHER: ForgeRepo = { ...REPO, repo: "shop", webUrl: "https://github.com/acme/shop" };
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const REFS: ForgeRef[] = [
  { name: "main", commit: SHA, protected: true, kind: "branch" },
  { name: "feature", commit: OTHER_SHA, protected: false, kind: "branch" },
];
const bundled = { name: "main", sha: SHA, catalog: { contexts: [] } as unknown as Catalog };

const remote: RemoteSourceLocation = {
  kind: "remote",
  provider: "github",
  origin: "https://github.com",
  repositoryUrl: "https://github.com/acme/shop",
  ref: SHA,
  path: "internal/cart/cart.go",
  line: 3,
  href: `https://github.com/acme/shop/blob/${SHA}/internal/cart/cart.go#L3`,
};
const local: SourceLocation = { kind: "local", path: "internal/cart/cart.go", line: 1, href: null };

describe("forgeRefsQuery", () => {
  it("is disabled without a repository and keyed under the forge prefix", () => {
    expect(forgeRefsQuery(null, "").enabled).toBe(false);
    expect(forgeRefsQuery(REPO, "").enabled).toBe(true);
    expect(forgeRefsQuery(REPO, "").queryKey.slice(0, forgeKeys.all.length)).toEqual(forgeKeys.all);
  });

  // A token makes the answer the token's: a different key, so a reader who
  // connects never sees the anonymous listing, and one who disconnects never
  // keeps the authenticated one.
  it("keys by repository and by token", () => {
    expect(forgeRefsQuery(REPO, "").queryKey).not.toEqual(forgeRefsQuery(OTHER, "").queryKey);
    expect(forgeRefsQuery(REPO, "").queryKey).not.toEqual(forgeRefsQuery(REPO, "secret").queryKey);
    expect(forgeRefsQuery(REPO, "secret").queryKey).toEqual(forgeRefsQuery(REPO, "secret").queryKey);
  });
});

describe("comparisonSide", () => {
  it("resolves the current branch to the bundled catalog without a lookup", () => {
    expect(comparisonSide("main", [], bundled)).toEqual({ name: "main", sha: SHA, catalog: bundled.catalog });
  });

  it("resolves other names through the forge refs, and unknown names to null", () => {
    expect(comparisonSide("feature", REFS, bundled)).toEqual({ name: "feature", sha: OTHER_SHA, catalog: null });
    expect(comparisonSide("gone", REFS, bundled)).toBeNull();
  });
});

describe("comparisonQuery", () => {
  const base = comparisonSide("main", REFS, bundled);
  const head = comparisonSide("feature", REFS, bundled);

  it("waits until both sides are resolved", () => {
    expect(comparisonQuery(REPO, "", base, null).enabled).toBe(false);
    expect(comparisonQuery(null, "", base, head).enabled).toBe(false);
    expect(comparisonQuery(REPO, "", base, head).enabled).toBe(true);
  });

  // Two names that point at the same commits are the same comparison; the
  // key is the commits, so a renamed branch does not fetch twice.
  it("keys by the resolved commits, not the names", () => {
    const renamed = { ...head!, name: "feature-renamed" };
    expect(comparisonQuery(REPO, "", base, head).queryKey).toEqual(comparisonQuery(REPO, "", base, renamed).queryKey);
    expect(comparisonQuery(REPO, "", base, head).queryKey).not.toEqual(comparisonQuery(REPO, "", head, base).queryKey);
    expect(comparisonQuery(REPO, "", base, head).queryKey.slice(0, forgeKeys.all.length)).toEqual(forgeKeys.all);
  });
});

describe("sourceCodeQuery", () => {
  it("keys remote files by forge, repository, commit, path and token", () => {
    const key = sourceCodeQuery(remote, "").queryKey;
    expect(key.slice(0, sourceKeys.all.length)).toEqual(sourceKeys.all);
    expect(key).not.toEqual(sourceCodeQuery({ ...remote, ref: OTHER_SHA }, "").queryKey);
    expect(key).not.toEqual(sourceCodeQuery({ ...remote, path: "go.mod" }, "").queryKey);
    expect(key).not.toEqual(sourceCodeQuery(remote, "secret").queryKey);
  });

  it("keys local files by path alone, under the same prefix", () => {
    const key = sourceCodeQuery(local, "").queryKey;
    expect(key.slice(0, sourceKeys.all.length)).toEqual(sourceKeys.all);
    expect(key).toEqual(sourceCodeQuery(local, "ignored").queryKey);
    expect(key).not.toEqual(sourceCodeQuery(remote, "").queryKey);
  });
});

describe("localStatusQuery", () => {
  // Settings is where a reader learns whether a local server is up, and the
  // server may have been started since the last visit.
  it("is stale at once so every visit asks again", () => {
    expect(localStatusQuery().staleTime).toBe(0);
  });
});
