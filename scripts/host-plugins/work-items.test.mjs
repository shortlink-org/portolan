import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullScanRequested, fullScanTarget, historyRecords, issueKeys, run, scanWorkItems } from "./work-items.mjs";

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

describe("work item Git evidence", { timeout: 30_000 }, () => {
  it("extracts all five providers together with correct URLs and commit evidence", () => {
    const { request, commit } = checkout();
    const sha = commit("RT-1 JIRA-2 LIN-3: toolbar\n\nFixes #4 and group/sub/repo#5; ignores other/repo#6 and !7");
    request.options.trackers = [
      ...trackers,
      { id: "jira", provider: "jira", baseUrl: "https://jira.example.com", projects: ["JIRA"] },
      { id: "linear", provider: "linear", baseUrl: "https://linear.app/team", projects: ["LIN"] },
      { id: "github", provider: "github", baseUrl: "https://github.com/acme/shop", projects: [] },
      { id: "gitlab", provider: "gitlab", baseUrl: "https://gitlab.com/group/sub/repo", projects: [], matchBareNumbers: false },
    ];
    const fragment = scanWorkItems(request).fragment;
    expect(fragment.workItems.map(({ provider, key, url }) => ({ provider, key, url }))).toEqual(expect.arrayContaining([
      { provider: "youtrack", key: "RT-1", url: "https://tasks.example.com/youtrack/issue/RT-1" },
      { provider: "jira", key: "JIRA-2", url: "https://jira.example.com/browse/JIRA-2" },
      { provider: "linear", key: "LIN-3", url: "https://linear.app/team/issue/LIN-3" },
      { provider: "github", key: "#4", url: "https://github.com/acme/shop/issues/4" },
      { provider: "gitlab", key: "#5", url: "https://gitlab.com/group/sub/repo/-/issues/5" },
    ]));
    expect(fragment.workItems).toHaveLength(5);
    expect(fragment.workItemLinks.every((link) => link.commits[0].sha === sha)).toBe(true);
  });
  it("full scan ignores the cap only for the selected verifier and preserves the normal limit", () => {
    const { request, root, commit } = checkout();
    commit("RT-1: old change"); commit("RT-2: recent change");
    request.options.maxCommits = 1;
    request.input.output = join(realpathSync(root), "output");
    const target = JSON.stringify([realpathSync(root), request.input.output, "work-items.json"]);
    expect(fullScanTarget(request)).toBe(target);
    const scanned = scanWorkItems(request, { fullScan: [target] });
    expect(scanned.fragment.workItems.map((item) => item.key)).toEqual(["RT-1", "RT-2"]);
    expect(scanned.warnings).toEqual([]);
    expect(request.options.maxCommits).toBe(1);
    expect(fullScanRequested({ ...request, input: { ...request.input, output: join(root, "other") } }, [target])).toBe(false);
    expect(fullScanRequested({ ...request, options: { ...request.options, out: "other.json" } }, [target])).toBe(false);
    expect(scanWorkItems(request).fragment.workItems.map((item) => item.key)).toEqual(["RT-2"]);
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
    const reading = {};
    expect([...historyRecords(git, "pinned-sha", 2, reading, 2)]).toEqual(["one", "two"]);
    expect(reading).toEqual({ truncated: true });
    const whole = {};
    expect([...historyRecords(git, "pinned-sha", 5, whole, 2)]).toHaveLength(5);
    expect(whole).toEqual({});
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
    const result = scanWorkItems(request);
    const fragment = result.fragment;
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
    expect(scanWorkItems(request)).toEqual(result);
  });

  it("does not attribute a foreign repository or similarly named path to this checkout", () => {
    const { request, catalog, commit } = checkout();
    commit("RT-101: added toolbar", "src/toolbar.tsx");
    catalog.contexts[0].services[0].repo = "github.com/another/shop";
    expect(scanWorkItems(request).fragment.workItems).toEqual([]);
    catalog.contexts[0].services[0].repo = "github.com/acme/shop";
    expect(scanWorkItems(request).fragment.workItemLinks.every((link) => link.target.kind === "service")).toBe(true);
  });

  it("reads a vendored snapshot's workspace paths against the checkout it was fetched from", () => {
    const { request, catalog, commit } = checkout();
    const vendored = "vendor/repos/acme/shop";
    catalog.contexts[0].services[0].path = vendored;
    catalog.flows[0].source = `${vendored}/src/toolbar.ts`;
    catalog.flows[0].steps[0].line = `${vendored}/src/toolbar.ts:4`;
    commit("RT-101: added toolbar");
    const links = scanWorkItems(request).fragment.workItemLinks;
    expect(links.find((link) => link.target.kind === "service")?.basis).toBe("service-directory");
    expect(links.find((link) => link.target.kind === "flow")?.commits[0].paths).toEqual(["src/toolbar.ts"]);
    expect(links.some((link) => link.target.kind === "step")).toBe(true);
    catalog.contexts[0].services[0].path = "vendor/repos/another/shop";
    catalog.flows[0].source = "vendor/repos/another/shop/src/toolbar.ts";
    catalog.flows[0].steps = [];
    expect(scanWorkItems(request).fragment.workItemLinks).toEqual([]);
  });

  it("matches a service spelled over ssh and reads an old spelling under the directory its pin names", () => {
    const { request, catalog, commit } = checkout();
    catalog.contexts[0].services[0].repo = "git@github.com:acme/shop.git";
    catalog.repos = [{ repo: "github.com/acme/shop", commit: "c1d2e3f", path: "third_party/shop" }];
    catalog.flows[0].source = "third_party/shop/src/toolbar.ts";
    catalog.flows[0].steps[0].line = "src/toolbar.ts:4";
    commit("RT-101: added toolbar");
    const links = scanWorkItems(request).fragment.workItemLinks;
    expect(links.find((link) => link.target.kind === "flow")?.commits[0].paths).toEqual(["src/toolbar.ts"]);
    expect(links.some((link) => link.target.kind === "step")).toBe(true);
  });

  it("attributes an org-scoped RFC to the repository that owns its file", () => {
    const { request, catalog, root, commit } = checkout();
    mkdirSync(join(root, "docs", "rfcs"), { recursive: true });
    catalog.rfcs = [{
      id: "org.rfc.12", scope: { kind: "org" }, sourceKind: "file",
      repository: "github.com/acme/shop", source: "docs/rfcs/0012-streaming.md",
    }];
    commit("RT-12: propose streaming", "docs/rfcs/0012-streaming.md", "proposal");
    const local = scanWorkItems(request).fragment;
    expect(local.workItemLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ workItem: "team:RT-12", target: { kind: "rfc", id: "org.rfc.12" } }),
    ]));

    catalog.rfcs[0].repository = "github.com/acme/architecture";
    expect(scanWorkItems(request).fragment.workItems).toEqual([]);
  });

  it("marks a bounded history without warning and rejects ambiguous trackers or inherited Git roots", () => {
    const { request, root, commit } = checkout();
    commit("RT-101: first"); commit("RT-102: second");
    const result = scanWorkItems({ ...request, options: { trackers, maxCommits: 1 } });
    expect(result.warnings).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(scanWorkItems({ ...request, options: { trackers, maxCommits: 100 } }).truncated).toBe(false);
    expect(result.fragment.workItems.map((item) => item.key)).toEqual(["RT-102"]);
    expect(() => scanWorkItems({ ...request, options: { trackers: [...trackers, { ...trackers[0], id: "other" }] } })).toThrow(/more than one tracker/);
    expect(() => scanWorkItems({ ...request, input: { root: join(root, "src") } })).toThrow(/enclosing repository/);
    expect(() => scanWorkItems({ ...request, options: { trackers, repository: "https://secret@github.com/acme/shop" } })).toThrow(/without credentials/);
  });
});
