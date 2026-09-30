import { describe, expect, it } from "vitest";
import { STALE_AFTER_DAYS, arrangeBranches, byRecency, defaultBranch, isStale, matchesBranch } from "./branch-picker";
import type { BranchChoice } from "./model";

const NOW = new Date("2026-09-30T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const branch = (name: string, days: number | null, subject?: string): BranchChoice => ({
  project: "auth",
  branch: name,
  tip: `${name.length}abcdef`.slice(0, 7),
  ahead: 1,
  ...(days === null ? {} : { date: daysAgo(days) }),
  ...(subject ? { subject } : {}),
});

const fresh = branch("ASUP-976-refund", 2, "Void the refund when the bridge says so");
const recent = branch("demo/passkeys", 10, "Add passkeys to login");
const edge = branch("chore/ci", STALE_AFTER_DAYS - 1, "Cache the Go modules");
const old = branch("a3f9c21e", 200, "wip");
const older = branch("feature/old-checkout", 400, "Checkout v1");
const undated = branch("from-an-old-dev-server", null);
const all = [old, undated, recent, older, fresh, edge];

describe("stale branches", () => {
  it("calls a branch stale once its last commit is older than the threshold", () => {
    expect(isStale(edge, NOW)).toBe(false);
    expect(isStale(branch("x", STALE_AFTER_DAYS + 1), NOW)).toBe(true);
    expect(isStale(old, NOW)).toBe(true);
  });

  it("does not call a branch stale when nothing says how old it is", () => {
    expect(isStale(undated, NOW)).toBe(false);
  });
});

describe("ordering", () => {
  it("puts the newest last commit first, undated branches last, then by name", () => {
    expect([...all].sort(byRecency).map((choice) => choice.branch)).toEqual([
      "ASUP-976-refund",
      "demo/passkeys",
      "chore/ci",
      "a3f9c21e",
      "feature/old-checkout",
      "from-an-old-dev-server",
    ]);
  });
});

describe("search", () => {
  it("matches every word against the name, the last commit's subject and the tip", () => {
    expect(matchesBranch(recent, "passkeys")).toBe(true);
    expect(matchesBranch(recent, "LOGIN add")).toBe(true);
    expect(matchesBranch(recent, "login refund")).toBe(false);
    expect(matchesBranch(fresh, "bridge")).toBe(true);
    expect(matchesBranch(fresh, fresh.tip)).toBe(true);
    expect(matchesBranch(fresh, "   ")).toBe(true);
  });
});

describe("arrangeBranches", () => {
  it("leaves stale branches out by default and says how many", () => {
    const list = arrangeBranches(all, { query: "", now: NOW, showStale: false });
    expect(list.shown.map((choice) => choice.branch)).toEqual(["ASUP-976-refund", "demo/passkeys", "chore/ci", "from-an-old-dev-server"]);
    expect(list.hidden).toBe(2);
    expect(list.stale).toBe(2);
  });

  it("shows every branch, newest first, when asked", () => {
    const list = arrangeBranches(all, { query: "", now: NOW, showStale: true });
    expect(list.shown).toHaveLength(all.length);
    expect(list.shown[3]).toBe(old);
    expect(list.hidden).toBe(0);
  });

  it("searches stale branches too: a name typed is a branch asked for", () => {
    const list = arrangeBranches(all, { query: "checkout", now: NOW, showStale: false });
    expect(list.shown).toEqual([older]);
    expect(list.hidden).toBe(0);
  });

  it("finds nothing when nothing matches", () => {
    expect(arrangeBranches(all, { query: "no-such-branch", now: NOW, showStale: false }).shown).toEqual([]);
  });
});

describe("defaultBranch", () => {
  it("starts on the newest branch that is not stale", () => {
    expect(defaultBranch(all, NOW)).toBe(fresh);
  });

  it("falls back to the newest of all when every branch is stale", () => {
    expect(defaultBranch([older, old], NOW)).toBe(old);
    expect(defaultBranch([], NOW)).toBeUndefined();
  });
});
