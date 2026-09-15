import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { builtinPlugin } from "./builtin-plugins.mjs";
import { run } from "./host-plugins/work-items.mjs";
import { readWorkItems, requestWorkItemsFullScan, fullScanTarget, forgetWorkItems } from "./work-items-history.mjs";

const roots = [];
afterEach(() => {
  forgetWorkItems();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const tracker = { id: "team", provider: "linear", baseUrl: "https://linear.app/team", projects: ["SHO"] };
const output = "portolan-work-items/repo";

/**
 * A checkout of this repository's own catalog - its services are portolan's,
 * rooted where portolan's code is - with a history of its own.
 */
function workspace({ maxCommits = 500, plugins = [{ name: "work-items", host: "work-items" }] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "portolan-work-items-history-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  cpSync(join(import.meta.dirname, "../portolan"), join(root, "portolan"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "portolan.json"), JSON.stringify({
    sources: ["portolan/*.json", "portolan-work-items/**/*.json"],
    catalogs: [
      { id: "portolan", title: "Portolan", sources: ["portolan/*.json", `${output}/work-items.json`], contexts: ["portolan"], projects: [] },
      { id: "other", title: "Other", sources: ["other/*.json"], contexts: ["other"], projects: [] },
    ],
    ...(plugins ? { plugins } : {}),
    extract: [],
    verify: [{ plugin: "work-items", in: ".", out: output, options: { trackers: [tracker], maxCommits, out: "work-items.json" } }],
  }, null, 2));
  git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  git("remote", "add", "origin", "https://github.com/shortlink-org/portolan");
  git("add", "."); git("commit", "-qm", "the catalog");
  const commit = (message, content = message) => {
    writeFileSync(join(root, "src/app.ts"), content);
    git("add", "src/app.ts"); git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  return { root, git, commit };
}

describe("task links read from the history", { timeout: 30_000 }, () => {
  it("generation writes nothing, so a commit carrying its change never goes stale", () => {
    expect(run({ input: { root: "." }, catalog: {}, options: { trackers: [tracker] } })).toEqual({ files: [], warnings: [] });
  });

  it("links the commit just made, scoped to the catalogs that name the verifier's path", async () => {
    const { root, commit } = workspace();
    const sha = commit("feat(site): a change (SHO-7)");
    const { sources, warnings } = await readWorkItems(root);
    expect(warnings).toEqual([]);
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe(`${output}/work-items.json`);
    expect(sources[0].catalogs).toEqual(["portolan"]);
    expect(sources[0].fragment.workItems).toEqual([
      { id: "team:SHO-7", tracker: "team", provider: "linear", key: "SHO-7", url: "https://linear.app/team/issue/SHO-7" },
    ]);
    const link = sources[0].fragment.workItemLinks.find((candidate) => candidate.target.kind === "service");
    expect(link).toMatchObject({ workItem: "team:SHO-7", target: { kind: "service", id: "portolan.site" }, basis: "service-directory" });
    expect(link.commits.map((entry) => entry.sha)).toEqual([sha]);

    // The next commit to name the task is simply the next link: nothing on
    // disk had to be regenerated to know it.
    const next = commit("fix(site): again (SHO-7)");
    forgetWorkItems();
    const again = await readWorkItems(root);
    expect(again.sources[0].fragment.workItemLinks.find((candidate) => candidate.target.kind === "service").commits.map((entry) => entry.sha)).toEqual([next, sha]);
  });

  it("reads a verifier naming the built-in without a plugins declaration, as gen runs it", async () => {
    // The name the shared helper takes for granted is the one the package ships.
    expect(builtinPlugin("work-items")).toMatchObject({ name: "work-items", host: "work-items" });
    for (const declared of [undefined, []]) {
      const { root, commit } = workspace({ plugins: declared });
      commit("feat(site): a change (SHO-7)");
      const { sources, warnings } = await readWorkItems(root);
      expect(warnings).toEqual([]);
      expect(sources.map((source) => source.fragment.workItems.map((item) => item.key))).toEqual([["SHO-7"]]);
      forgetWorkItems();
    }
  });

  it("reads nothing where the manifest declares another plugin under the built-in name", async () => {
    const taken = workspace({ plugins: [{ name: "work-items", process: { command: "true" } }] });
    taken.commit("feat(site): a change (SHO-7)");
    expect(await readWorkItems(taken.root)).toEqual({ sources: [], warnings: [] });
  });

  it("a full scan lifts the commit limit for the verifier it names", async () => {
    const { root, commit } = workspace({ maxCommits: 1 });
    commit("feat(site): old (SHO-1)");
    commit("feat(site): new (SHO-2)");
    const limited = await readWorkItems(root);
    expect(limited.sources[0].fragment.workItems.map((item) => item.key)).toEqual(["SHO-2"]);
    // The configured bound is expected, not a problem: no build warning.
    expect(limited.warnings).toEqual([]);
    requestWorkItemsFullScan(fullScanTarget({ input: { root, output: join(realpathSync(root), output) }, options: { out: "work-items.json" } }));
    const scanned = await readWorkItems(root);
    expect(scanned.sources[0].fragment.workItems.map((item) => item.key)).toEqual(["SHO-1", "SHO-2"]);
  });

  it("reads nothing where no work-items verifier is declared", async () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-work-items-none-"));
    roots.push(root);
    writeFileSync(join(root, "portolan.json"), JSON.stringify({ sources: ["portolan/*.json"], projects: [], extract: [], verify: [] }));
    expect(await readWorkItems(root)).toEqual({ sources: [], warnings: [] });
  });
});
