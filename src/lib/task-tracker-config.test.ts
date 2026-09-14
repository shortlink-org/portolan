import { describe, expect, it } from "vitest";
import { detectTaskKeys, normalizeTrackers, publicTaskTrackers, taskUrl } from "./task-tracker-config.mjs";

const tracker = { id: "team", provider: "youtrack" as const, baseUrl: "https://tasks.example.com/youtrack", projects: ["RT", "CORE"] };

describe("task tracker configuration", () => {
  it.each([
    ["jira", "https://tasks.example.com/jira", "https://tasks.example.com/jira/browse/RT-101"],
    ["linear", "https://linear.app/team", "https://linear.app/team/issue/RT-101"],
  ] as const)("supports %s defaults and custom prefixed detection", (provider, baseUrl, expected) => {
    const config = normalizeTrackers([{ ...tracker, provider, baseUrl }])[0]!;
    expect(detectTaskKeys("Fix RT-101", config)).toEqual(["RT-101"]);
    expect(taskUrl(config, "RT-101")).toBe(expected);
    expect(detectTaskKeys("RT#12", { ...config, keyFormat: "{project}#{number}" })).toEqual(["RT#12"]);
  });
  it.each([
    ["github", "https://git.example.com/owner/repo", "owner/repo", "issues"],
    ["gitlab", "https://git.example.com/group/subgroup/repo", "group/subgroup/repo", "-/issues"],
  ] as const)("supports scoped numeric references for %s", (provider, baseUrl, path, issuePath) => {
    const config = normalizeTrackers([{ id: provider, provider, baseUrl, projects: [] }])[0]!;
    expect(detectTaskKeys(`Fixes #123 and ${path}#123; ${path}#456`, config)).toEqual(["#123", "#456"]);
    expect(detectTaskKeys(`Fixes #123 and ${path}#456`, { ...config, matchBareNumbers: false })).toEqual(["#456"]);
    expect(detectTaskKeys(`foreign/${path}#9 other/repo#10 !11 ##12 \\#13 #0 #123x #123456789012345678901 https://example.com/#15`, config)).toEqual([]);
    expect(taskUrl(config, "#123")).toBe(`${baseUrl}/${issuePath}/123`);
    expect(taskUrl({ ...config, urlTemplate: "{baseUrl}/custom/{key}" }, "#123")).toBe(`${baseUrl}/custom/%23123`);
  });
  it("rejects ambiguous bare references and incomplete addresses", () => {
    const github = { id: "github", provider: "github", baseUrl: "https://github.com/owner/repo", projects: [] };
    const gitlab = { id: "gitlab", provider: "gitlab", baseUrl: "https://gitlab.com/group/repo", projects: [] };
    expect(() => normalizeTrackers([github, gitlab])).toThrow(/Only one tracker/);
    expect(normalizeTrackers([github, { ...gitlab, matchBareNumbers: false }])).toHaveLength(2);
    expect(() => normalizeTrackers([{ ...github, baseUrl: "https://github.com/owner" }])).toThrow(/complete repository/);
    expect(() => normalizeTrackers([{ ...tracker, provider: "linear", baseUrl: "https://linear.app" }])).toThrow(/workspace/);
    expect(() => normalizeTrackers([{ ...github, projects: ["RT"] }])).toThrow(/without project prefixes/);
    expect(() => normalizeTrackers([{ ...github, keyFormat: "{project}-{number}" }])).toThrow();
    expect(() => normalizeTrackers([{ ...tracker, provider: "toString" }])).toThrow(/supported/);
  });
  it("uses the same bounded template for preview and extraction", () => {
    expect(detectTaskKeys("RT-101: toolbar\nCORE-42 RT-101 ART-1 xRT-2 RT-3x RT-4-more", tracker)).toEqual(["CORE-42", "RT-101"]);
    expect(detectTaskKeys("RT#101 CORE#42 RT-3", { ...tracker, keyFormat: "{project}#{number}" })).toEqual(["CORE#42", "RT#101"]);
    expect(detectTaskKeys("RT.101 RTx101", { ...tracker, keyFormat: "{project}.{number}" })).toEqual(["RT.101"]);
    expect(detectTaskKeys("RT-123456789012345678901", tracker)).toEqual([]);
  });
  it("encodes task keys and preserves a self-hosted base path", () => {
    expect(taskUrl(tracker, "RT-101")).toBe("https://tasks.example.com/youtrack/issue/RT-101");
    expect(taskUrl({ ...tracker, urlTemplate: "{baseUrl}/tickets/{key}" }, "RT#101")).toBe("https://tasks.example.com/youtrack/tickets/RT%23101");
  });
  it("rejects unsafe URLs, arbitrary regex, duplicate prefixes and unsupported tokens", () => {
    for (const baseUrl of ["javascript:alert(1)", "https://token@tasks.example.com", "https://tasks.example.com?token=secret"]) expect(() => normalizeTrackers([{ ...tracker, baseUrl }])).toThrow();
    for (const keyFormat of ["(a+)+$", "{project}{number}", "{project}-{number}-{number}"]) expect(() => normalizeTrackers([{ ...tracker, keyFormat }])).toThrow();
    for (const urlTemplate of ["https://evil.example/{key}", "{baseUrl}/../{token}", "{baseUrl}/no-key"]) expect(() => normalizeTrackers([{ ...tracker, urlTemplate }])).toThrow();
    expect(() => normalizeTrackers([tracker, { ...tracker, id: "second" }])).toThrow(/more than one tracker/);
    expect(normalizeTrackers([])).toEqual([]);
  });
  it("publishes only allowlisted configuration, never credentials or unrelated options", () => {
    const entries = publicTaskTrackers({ plugins: [{ name: "tasks", host: "work-items" }], verify: [{ plugin: "tasks", in: ".", out: "tasks", options: { token: "secret", repository: "https://secret@git.example.com", trackers: [{ ...tracker, token: "private" }] } }] });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toMatch(/secret|private|token/);
    expect(publicTaskTrackers({ plugins: {}, verify: [null] })).toEqual([]);
    expect(publicTaskTrackers(null)).toEqual([]);
  });
});
