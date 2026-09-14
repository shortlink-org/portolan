import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskTrackerState, saveTaskTrackerSettings, taskTrackerFullScanTarget } from "./task-tracker-settings.mjs";
import { localApiPlugin, writeManifest } from "./local-api.mjs";
import { run } from "./host-plugins/work-items.mjs";

const roots = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const tracker = { id: "team", name: "Team YouTrack", provider: "youtrack", baseUrl: "https://tasks.example.com", projects: ["RT"], keyFormat: "{project}#{number}", urlTemplate: "{baseUrl}/tickets/{key}" };
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-tracker-settings-")); roots.push(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com"); git("remote", "add", "origin", "https://github.com/acme/shop");
  mkdirSync(join(root, "src")); writeFileSync(join(root, "src/toolbar.ts"), "toolbar"); git("add", "."); git("commit", "-qm", "RT#101: toolbar");
  const manifest = { sources: ["data/*.json"], plugins: [], projects: [{ id: "app", name: "App", root: ".", context: "app", service: "app" }, { id: "nested", name: "Nested", root: "src", context: "app", service: "nested" }], catalogs: [{ id: "app", title: "App", sources: ["data/*.json"], contexts: ["app"], projects: ["app"] }, { id: "other", title: "Other", sources: ["other/*.json"], contexts: ["other"], projects: [] }], defaultCatalog: "app", extract: [], verify: [] };
  writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest, null, 2));
  return { root, manifest };
}
const save = (root, request = {}) => saveTaskTrackerSettings(root, { revision: taskTrackerState(root).revision, step: null, input: ".", catalogs: ["app"], trackers: [tracker], maxCommits: 500, ...request }, writeManifest);

describe("persisted tracker settings", () => {
  it("reports unborn repositories and warns about shallow history without disabling it", () => {
    const { root, manifest } = workspace();
    mkdirSync(join(root, "empty"));
    execFileSync("git", ["init", "-q", join(root, "empty")]);
    execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${root}`, join(root, "shallow")]);
    manifest.projects.push({ id: "empty", name: "Empty", root: "empty", context: "app", service: "empty" }, { id: "shallow", name: "Shallow", root: "shallow", context: "app", service: "shallow" });
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    const state = taskTrackerState(root);
    expect(state.repositories.find((repo) => repo.input === ".")).toMatchObject({ available: true, shallow: false });
    expect(state.repositories.find((repo) => repo.input === "empty")).toMatchObject({ available: false, reason: expect.stringMatching(/no local commits/) });
    expect(state.repositories.find((repo) => repo.input === "shallow")).toMatchObject({ available: true, shallow: true });
    expect(() => save(root, { input: "empty" })).toThrow(/no local commits/);
  });
  it("persists every provider and the qualified-only numeric rule through schema validation", () => {
    const { root } = workspace();
    const trackers = [tracker,
      { id: "jira", provider: "jira", baseUrl: "https://team.atlassian.net", projects: ["JIRA"] },
      { id: "linear", provider: "linear", baseUrl: "https://linear.app/team", projects: ["LIN"] },
      { id: "github", provider: "github", baseUrl: "https://github.com/owner/repo", projects: [] },
      { id: "gitlab", provider: "gitlab", baseUrl: "https://gitlab.com/group/sub/repo", projects: [], matchBareNumbers: false },
    ];
    expect(save(root, { trackers }).entries[0].trackers).toEqual(trackers);
    expect(taskTrackerState(root).entries[0].trackers).toEqual(trackers);
  });
  it("full scan selects only a current saved verifier without modifying the manifest", () => {
    const { root } = workspace();
    const state = save(root);
    const before = readFileSync(join(root, "portolan.json"), "utf8");
    expect(JSON.parse(taskTrackerFullScanTarget(root, { revision: state.revision, step: 0 }))[2]).toBe("work-items.json");
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
    expect(() => taskTrackerFullScanTarget(root, { revision: "stale", step: 0 })).toThrow(/changed/);
    expect(() => taskTrackerFullScanTarget(root, { revision: state.revision, step: 9 })).toThrow(/at least one tracker/);
    const disabled = save(root, { step: 0, trackers: [] });
    expect(() => taskTrackerFullScanTarget(root, { revision: disabled.revision, step: 0 })).toThrow(/at least one tracker/);
  });
  it("registers a verifier, wires only selected catalog sources and extracts real Git keys", () => {
    const { root } = workspace();
    const before = taskTrackerState(root);
    expect(before.repositories.find((item) => item.input === "src").available).toBe(false);
    const saved = save(root);
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    const step = manifest.verify[0];
    expect(manifest.plugins).toEqual([{ name: "work-items", host: "work-items" }]);
    expect(manifest.sources).toContain(`${step.out}/work-items.json`);
    expect(manifest.catalogs[0].sources).toContain(`${step.out}/work-items.json`);
    expect(manifest.catalogs[1].sources).not.toContain(`${step.out}/work-items.json`);
    expect(saved.entries[0]).toMatchObject({ input: ".", catalogs: ["app"], managed: true, trackers: [tracker] });
    expect(saved.revision).not.toBe(before.revision);
    const catalog = { contexts: [{ services: [{ id: "app.app", repo: "github.com/acme/shop", path: "src" }] }], flows: [], adrs: [] };
    const fragment = JSON.parse(run({ input: { root }, options: step.options, catalog }).files[0].contents);
    expect(fragment.workItems[0]).toMatchObject({ key: "RT#101", url: "https://tasks.example.com/tickets/RT%23101" });
  });
  it("updates rather than duplicates; moves managed profile scope and clears disabled output", () => {
    const { root } = workspace();
    save(root);
    save(root, { step: 0, catalogs: ["other"], trackers: [] });
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(manifest.verify).toHaveLength(1);
    const source = `${manifest.verify[0].out}/work-items.json`;
    expect(manifest.catalogs[0].sources).not.toContain(source);
    expect(manifest.catalogs[1].sources).toContain(source);
    expect(JSON.parse(run({ options: manifest.verify[0].options }).files[0].contents).workItemLinks).toEqual([]);
  });
  it("rejects stale revisions, invalid patterns, inherited Git, and preserves unrelated configuration", () => {
    const { root } = workspace();
    const before = readFileSync(join(root, "portolan.json"), "utf8");
    expect(() => save(root, { revision: "stale" })).toThrow(/changed since/);
    expect(() => save(root, { input: "src" })).toThrow(/checkout root/);
    expect(() => save(root, { trackers: [{ ...tracker, keyFormat: "(a+)+$" }] })).toThrow(/separator/);
    expect(() => save(root, { catalogs: ["missing"] })).toThrow(/known catalog/);
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
    save(root);
    expect(JSON.parse(readFileSync(join(root, "portolan.json"), "utf8")).extract).toEqual([]);
    expect(() => save(root)).toThrow(/existing tracker/);
  });
  it("does not follow a project symlink to a checkout outside the workspace", () => {
    const { root, manifest } = workspace();
    const { root: external } = workspace();
    symlinkSync(external, join(root, "outside"));
    manifest.projects.push({ id: "outside", name: "Outside", root: "outside", context: "app", service: "outside" });
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(() => save(root, { input: "outside" })).toThrow(/inside this workspace/);
  });
  it("keeps manual output names and scope and rejects wildcard scope leaks", () => {
    const { root, manifest } = workspace();
    manifest.plugins = [{ name: "work-items", host: "work-items" }];
    manifest.verify = [{ plugin: "work-items", in: ".", out: "manual", options: { trackers: [tracker], out: "custom.json", repository: "https://github.com/acme/shop" } }];
    manifest.sources.push("manual/*.json"); manifest.catalogs[0].sources.push("manual/*.json");
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    const result = save(root, { step: 0 });
    expect(result.entries[0]).toMatchObject({ output: "manual", file: "custom.json", managed: false, catalogs: ["app"] });
    expect(JSON.parse(readFileSync(join(root, "portolan.json"))).verify[0].options.repository).toBe("https://github.com/acme/shop");
    expect(() => save(root, { step: 0, catalogs: ["other"] })).toThrow(/manually configured/);
    const second = workspace();
    second.manifest.catalogs[1].sources.push("**/*.json");
    writeFileSync(join(second.root, "portolan.json"), JSON.stringify(second.manifest));
    expect(() => save(second.root)).toThrow(/wildcard/);
  });
  it("serves revisioned settings and gates writes through the local JSON endpoint", async () => {
    const { root } = workspace();
    let middleware;
    localApiPlugin(root).configureServer({ config: { base: "/" }, middlewares: { use: (handler) => { middleware = handler; } } });
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/__portolan/task-trackers`;
    try {
      const state = await (await fetch(url)).json();
      expect(state.entries).toEqual([]);
      const body = JSON.stringify({ revision: state.revision, step: null, input: ".", catalogs: ["app"], trackers: [tracker], maxCommits: 100, generate: false });
      expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(405);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Portolan-Local": "1" }, body });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ run: null, entries: [{ maxCommits: 100, trackers: [tracker] }] });
      expect((await fetch(url, { headers: { Origin: "https://untrusted.example.com" } })).status).toBe(403);
      // Use a tiny CLI stand-in to verify job dispatch and the one-run env;
      // actual Git scanning is covered by the verifier tests.
      const cli = join(root, "test-cli.mjs");
      writeFileSync(cli, 'console.log("scan-target=" + process.env.PORTOLAN_WORK_ITEMS_FULL_SCAN);');
      vi.stubEnv("PORTOLAN_CLI", cli);
      const current = taskTrackerState(root);
      const scan = await fetch(`${url}/full-scan`, { method: "POST", headers: { "Content-Type": "application/json", "X-Portolan-Local": "1" }, body: JSON.stringify({ revision: current.revision, step: 0 }) });
      expect(scan.status).toBe(200);
      const { runId } = await scan.json();
      const events = await (await fetch(url.replace("/task-trackers", `/runs/${runId}/events`))).text();
      expect(events).toContain("scan-target=");
      expect(events).toContain("process-finished");
      expect(taskTrackerState(root).revision).toBe(current.revision);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
