// The order a reader picks a comparison head in, and how a name is resolved.
//
// Branches are what is being worked on and tags are what was shipped, and
// they read differently: a branch list is scanned by name, a tag list from the
// newest release down. So branches sort by name after the two a reader
// reaches for first - the catalog's own branch, then main - and tags sort by
// version, highest first, with anything that is not a version after them.

import type { ForgeRef } from "./github-catalog";

type Version = { parts: number[]; pre: string };

/** `v1.2.3`, `1.2`, `release-2.0.1-rc.1` as numbers, or null when it is not one. */
export function parseVersion(name: string): Version | null {
  const m = /(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(name);
  if (!m) return null;
  return { parts: m[1]!.split(".").map(Number), pre: m[2] ?? "" };
}

/** Newest first. A prerelease comes before the release it precedes. */
export function compareVersionsDesc(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    if (va) return -1;
    if (vb) return 1;
    return b.localeCompare(a);
  }
  const length = Math.max(va.parts.length, vb.parts.length);
  for (let i = 0; i < length; i++) {
    const d = (vb.parts[i] ?? 0) - (va.parts[i] ?? 0);
    if (d !== 0) return d;
  }
  if (va.pre && !vb.pre) return 1;
  if (!va.pre && vb.pre) return -1;
  return vb.pre.localeCompare(va.pre) || b.localeCompare(a);
}

/** The picker's order: current, main, other branches by name, tags newest first. */
export function sortRefs(refs: ForgeRef[], current: string): ForgeRef[] {
  const rank = (ref: ForgeRef) =>
    ref.name === current && ref.kind === "branch" ? 0
    : ref.name === "main" && ref.kind === "branch" ? 1
    : ref.kind === "branch" ? 2
    : 3;
  return [...refs].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.kind === "tag" ? compareVersionsDesc(a.name, b.name) : a.name.localeCompare(b.name);
  });
}

/**
 * The ref a URL names. A tag and a branch may share a name, and the branch
 * wins, because that is what git itself resolves a bare name to.
 */
export function findRef(refs: ForgeRef[], name: string): ForgeRef | undefined {
  return refs.find((ref) => ref.name === name && ref.kind === "branch")
    ?? refs.find((ref) => ref.name === name);
}
