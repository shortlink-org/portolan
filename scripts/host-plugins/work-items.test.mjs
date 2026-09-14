import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullScanRequested, historyRecords, issueKeys, run } from "./work-items.mjs";

const temporary = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const trackers = [{ id: "team", provider: "youtrack", baseUrl: "https://tasks.example.com/youtrack/", projects: ["RT"] }];

function checkout() {
  const root = mkdtempSync(join(tmpdir(), "portolan-work-items-"));
  temporary.push(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init"); git("config", "user.name", "Test Author"); git("config", "user.email", "test@example.com");
  git("remote", "add", "origin", "git@github.com:acme/shop.git");
  mkdirSync(join(root, "src"));
  const commit = (message, path = "src/toolbar.ts", content = message) => {
    writeFileSync(join(root, path), content);
    git("add", "--", path); git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const service = { id: "shop.web", repo: "github.com/acme/shop", path: "src" };
  const flow = { id: "flow.toolbar", owner: "shop", source: "src/toolbar.ts", participants: [{ kind: "service", id: service.id, context: "shop" }], steps: [{ type: "step", id: "s1", line: "src/toolbar.ts:4" }] };
  const catalog = { contexts: [{ services: [service] }], flows: [flow], adrs: [{ id: "shop.web.0001", scope: { kind: "service", service: service.id }, source: "decision.md" }] };
  return { root, git, commit, catalog, request: { input: { root }, catalog, options: { trackers } } };
}

describe("work item Git evidence", () => {
  it("full scan ignores the cap only for the selected verifier and preserves the normal limit", () => {
    const { request, root, commit } = checkout();
    commit("RT-1: old change"); commit("RT-2: recent change");
    request.options.maxCommits = 1;
    request.input.output = join(realpathSync(root), "output");
    const target = JSON.stringify([realpathSync(root), request.input.output, "work-items.json"]);
    vi.stubEnv("PORTOLAN_WORK_ITEMS_FULL_SCAN", target);
    const scanned = run(request);
    expect(JSON.parse(scanned.files[0].contents).workItems.map((item) => item.key)).toEqual(["RT-1", "RT-2"]);
    expect(scanned.warnings).toEqual([]);
    expect(request.options.maxCommits).toBe(1);
    expect(fullScanRequested({ ...request, input: { ...request.input, output: join(root, "other") } })).toBe(false);
    expect(fullScanRequested({ ...request, options: { ...request.options, out: "other.json" } })).toBe(false);
    vi.stubEnv("PORTOLAN_WORK_ITEMS_FULL_SCAN", "");
    expect(JSON.parse(run(request).files[0].contents).workItems.map((item) => item.key)).toEqual(["RT-2"]);
  });
  it("paginates through all records against a pinned HEAD and stops bounded reads at the cap", () => {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      const skip = Number(args.find((arg) => arg.startsWith("--skip=")).slice(7));
      const count = Number(args.find((arg) => arg.startsWith("-n")).slice(2));
      return ["one", "two", "three", "four", "five"].slice(skip, skip + count).map((record) => `\x1e${record}`).join("");
    };
    expect([...historyRecords(git, "pinned-sha", null, [], 2)]).toEqual(["one", "two", "three", "four", "five"]);
    expect(calls.every((args) => args[1] === "pinned-sha")).toBe(true);
    const warnings = [];
    expect([...historyRecords(git, "pinned-sha", 2, warnings, 2)]).toEqual(["one", "two"]);
    expect(warnings[0].message).toMatch(/latest 2/);
  });
  it("recognizes configured keys in a subject or body without substring matches", () => {
    expect(issueKeys("RT-101: toolbar\nFixes RT-102, RT-101; ART-1 xRT-2 RT-3x RT-4-more XX-4", ["RT"]))
      .toEqual(["RT-101", "RT-102"]);
  });

  it("joins multiple commits to exact flow/step files, directories and ADRs without inventing task titles", () => {
    const { request, commit } = checkout();
    const first = commit("RT-101: added toolbar");
    const second = commit("Refine toolbar\n\nRelated RT-101 and RT-102");
    commit("RT-101: unrelated document", "unrelated.md");
    commit("RT-104: record decision", "decision.md");
    const result = run(request);
    const fragment = JSON.parse(result.files[0].contents);
    const task = fragment.workItems.find((item) => item.key === "RT-101");
    expect(task.url).toBe("https://tasks.example.com/youtrack/issue/RT-101");
    expect(task).not.toHaveProperty("title");
    const link = fragment.workItemLinks.find((link) => link.workItem === task.id && link.target.kind === "flow");
    expect(link.basis).toBe("source-file");
    expect(link.commits.map((commit) => commit.sha)).toEqual([second, first]);
    expect(link.commits[0].paths).toEqual(["src/toolbar.ts"]);
    expect(link.commits[0].repository).toBe("https://github.com/acme/shop");
    expect(fragment.workItemLinks.some((link) => link.target.kind === "step" && link.target.flow === "flow.toolbar")).toBe(true);
    expect(fragment.workItemLinks.some((link) => link.target.kind === "service" && link.basis === "service-directory")).toBe(true);
    expect(fragment.workItemLinks.some((link) => link.target.kind === "adr" && link.workItem === "team:RT-104")).toBe(true);
    expect(run(request)).toEqual(result);
  });

  it("does not attribute a foreign repository or similarly named path to this checkout", () => {
    const { request, catalog, commit } = checkout();
    commit("RT-101: added toolbar", "src/toolbar.tsx");
    catalog.contexts[0].services[0].repo = "github.com/another/shop";
    expect(JSON.parse(run(request).files[0].contents).workItems).toEqual([]);
    catalog.contexts[0].services[0].repo = "github.com/acme/shop";
    expect(JSON.parse(run(request).files[0].contents).workItemLinks.every((link) => link.target.kind === "service")).toBe(true);
  });

  it("reports a bounded history and rejects ambiguous trackers or inherited Git roots", () => {
    const { request, root, commit } = checkout();
    commit("RT-101: first"); commit("RT-102: second");
    const result = run({ ...request, options: { trackers, maxCommits: 1 } });
    expect(result.warnings[0].message).toMatch(/latest 1/);
    expect(JSON.parse(result.files[0].contents).workItems.map((item) => item.key)).toEqual(["RT-102"]);
    expect(() => run({ ...request, options: { trackers: [...trackers, { ...trackers[0], id: "other" }] } })).toThrow(/more than one tracker/);
    expect(() => run({ ...request, input: { root: join(root, "src") } })).toThrow(/enclosing repository/);
    expect(() => run({ ...request, options: { trackers, repository: "https://secret@github.com/acme/shop" } })).toThrow(/without credentials/);
  });
});
