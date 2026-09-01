// One comparator per column type.
//
// Every one of these returns an ASCENDING comparison and nothing else: the
// table reverses the result itself when a column is sorted descending, so a
// comparator that flips its own sign flips it twice. Empty cells never reach
// here — an empty cell is `undefined`, and the table places undefined last in
// both directions before it asks anyone to compare anything.

import type { Status } from "../catalog";
import type { Kind } from "../lib/kinds";
import type { CellValue, ColumnType } from "./types";

/** Ascending status order. The strongest claim about reality comes first. */
const STATUS_RANK: Record<Status, number> = {
  verified: 0,
  declared: 1,
  unresolved: 2,
};

/**
 * Ascending kind order: the five building blocks in the order the spec names
 * them, then everything else in tree order, so a `kind` column of mixed rows
 * still has one answer rather than an alphabetical accident.
 */
const KIND_RANK: Record<Kind, number> = {
  event: 0,
  command: 1,
  query: 2,
  entity: 3,
  vo: 4,
  def: 5,
  aggregate: 6,
  service: 7,
  context: 8,
  flow: 9,
  adr: 10,
};

/** Case-insensitive, then case-sensitive, so the order is never arbitrary. */
export function compareText(a: string, b: string): number {
  const folded = a.localeCompare(b, undefined, { sensitivity: "base" });
  if (folded !== 0) return folded;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareNumber(a: number, b: number): number {
  return a - b;
}

const VERSION_RE = /^[vV]?\d+(\.\d+)*([-+].*)?$/;

/** Splits "v1.2.3-rc.1" into [1, 2, 3] and "rc.1". */
function parseVersion(
  raw: string,
): { release: number[]; pre: string[] } | null {
  if (!VERSION_RE.test(raw)) return null;
  // Build metadata is not part of precedence; a "+build" suffix is dropped.
  const body = raw.replace(/^[vV]/, "").split("+")[0] ?? "";
  // Split at the FIRST hyphen only: "1.0.0-rc-2" has one prerelease, not two.
  const dash = body.indexOf("-");
  const core = dash === -1 ? body : body.slice(0, dash);
  const prerelease = dash === -1 ? "" : body.slice(dash + 1);
  return {
    release: core.split(".").map((part) => Number(part)),
    pre: prerelease === "" ? [] : prerelease.split("."),
  };
}

/**
 * Semver precedence, and the reason this file exists: 2 before 10, every time.
 * Anything that is not shaped like a version falls back to text, so a column
 * that turns out to hold "latest" still has a defined order.
 */
export function compareVersion(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    // A version always precedes a word: "1.0" is a release, "latest" is a wish.
    if (va) return -1;
    if (vb) return 1;
    return compareText(a, b);
  }

  const depth = Math.max(va.release.length, vb.release.length);
  for (let i = 0; i < depth; i++) {
    // A missing segment is zero: 1.2 and 1.2.0 are the same version.
    const diff = (va.release[i] ?? 0) - (vb.release[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // A prerelease precedes the release it leads to; 1.0.0-rc.1 < 1.0.0.
  if (va.pre.length === 0 && vb.pre.length === 0) return 0;
  if (va.pre.length === 0) return 1;
  if (vb.pre.length === 0) return -1;

  const parts = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < parts; i++) {
    const pa = va.pre[i];
    const pb = vb.pre[i];
    // The shorter prerelease wins when everything before it matched.
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = /^\d+$/.test(pa) ? Number(pa) : null;
    const nb = /^\d+$/.test(pb) ? Number(pb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
      continue;
    }
    // Numeric identifiers rank below alphanumeric ones.
    if (na !== null) return -1;
    if (nb !== null) return 1;
    const text = compareText(pa, pb);
    if (text !== 0) return text;
  }
  return 0;
}

/** Oldest first. An unparseable date compares as the text it is. */
export function compareDate(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  const okA = Number.isFinite(ta);
  const okB = Number.isFinite(tb);
  if (!okA || !okB) {
    if (okA) return -1;
    if (okB) return 1;
    return compareText(a, b);
  }
  return ta - tb;
}

export function compareStatus(a: string, b: string): number {
  const ra = STATUS_RANK[a as Status];
  const rb = STATUS_RANK[b as Status];
  // A value outside the vocabulary sorts after every value inside it.
  if (ra === undefined || rb === undefined) {
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareText(a, b);
  }
  return ra - rb;
}

export function compareKind(a: string, b: string): number {
  const ra = KIND_RANK[a as Kind];
  const rb = KIND_RANK[b as Kind];
  if (ra === undefined || rb === undefined) {
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareText(a, b);
  }
  return ra - rb;
}

/** The comparator a column of this type sorts by. */
export function comparatorFor(
  type: ColumnType,
): (a: CellValue, b: CellValue) => number {
  return (a, b) => {
    // Defensive only: the table filters undefined out before it gets here.
    if (a === undefined || b === undefined) {
      if (a === b) return 0;
      return a === undefined ? 1 : -1;
    }
    switch (type) {
      case "number":
      case "count":
        return compareNumber(Number(a), Number(b));
      case "version":
        return compareVersion(String(a), String(b));
      case "date":
        return compareDate(String(a), String(b));
      case "status":
        return compareStatus(String(a), String(b));
      case "kind":
        return compareKind(String(a), String(b));
      case "text":
      case "mono":
        return compareText(String(a), String(b));
    }
  };
}
