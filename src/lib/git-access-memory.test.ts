import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGitAccess, rememberGitAccess } from "./git-access-memory";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
const repo = "github.com/acme/shop";
const https = `https://${repo}`;
const ssh = "git@github.com:acme/shop.git";
const success = { status: "accessible" as const, message: "Read access confirmed.", checkedAt: "2026-09-14T07:00:00.000Z" };

describe("Git access observations", () => {
  it("restores result, exact check time and chosen transport after a new read", () => {
    rememberGitAccess("workspace", repo, "https", { url: https, result: success });
    expect(readGitAccess("workspace", repo)).toEqual({ transport: "https", results: { [https]: success } });
    rememberGitAccess("workspace", repo, "ssh", { url: ssh, result: { ...success, status: "unavailable", message: "Permission denied." } });
    const saved = readGitAccess("workspace", repo);
    expect(saved.transport).toBe("ssh");
    expect(saved.results[https]).toEqual(success);
    expect(saved.results[ssh]?.status).toBe("unavailable");
    rememberGitAccess("workspace", repo, "https");
    expect(readGitAccess("workspace", repo).results).toEqual(saved.results);
  });
  it("never shares results between workspaces, repositories or different URLs", () => {
    rememberGitAccess("one", repo, "https", { url: https, result: success });
    expect(readGitAccess("two", repo).results).toEqual({});
    expect(readGitAccess("one", "github.com/acme/other").results).toEqual({});
    expect(readGitAccess("one", repo).results[ssh]).toBeUndefined();
  });
  it("ignores corrupt state, invalid dates and in-progress observations", () => {
    rememberGitAccess("one", repo, "https", { url: https, result: success });
    const key = [...values.keys()][0]!;
    values.set(key, "broken JSON");
    expect(readGitAccess("one", repo).results).toEqual({});
    values.set(key, JSON.stringify({ results: { [https]: { ...success, checkedAt: "invalid" }, [ssh]: { ...success, status: "checking" } } }));
    expect(readGitAccess("one", repo).results).toEqual({});
  });
  it("continues when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } });
    expect(readGitAccess("one", repo).results).toEqual({});
    expect(() => rememberGitAccess("one", repo, "https", { url: https, result: success })).not.toThrow();
  });
});
