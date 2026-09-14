import { describe, expect, it } from "vitest";
import { detectTaskKeys, normalizeTrackers, publicTaskTrackers, taskUrl } from "./task-tracker-config.mjs";

const tracker = { id: "team", provider: "youtrack" as const, baseUrl: "https://tasks.example.com/youtrack", projects: ["RT", "CORE"] };

describe("task tracker configuration", () => {
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
