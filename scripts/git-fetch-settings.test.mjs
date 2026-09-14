import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { gitFetchState, saveGitFetchSettings, checkGitAccess } from "./git-fetch-settings.mjs";
import { normalizeGitRepos, gitRepoDirectory, mergeGitRepositories, gitRepositoryAddress } from "../src/lib/git-fetch-config.mjs";
import { localApiPlugin, writeManifest } from "./local-api.mjs";

const roots = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const repo = { repo: "https://github.com/acme/shop", commit: "a".repeat(40) };
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-git-settings-")); roots.push(root);
  const manifest = { sources: ["data/*.json"], plugins: [], extract: [], verify: [], catalogs: [{ id: "app", title: "App", sources: ["data/*.json"], contexts: ["app"], projects: [] }, { id: "other", title: "Other", sources: ["other/*.json"], contexts: ["other"], projects: [] }] };
  writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
  return { root, manifest };
}
const request = (root, patch = {}) => ({ revision: gitFetchState(root).revision, step: null, output: "vendor/repos/git-test", repos: [repo], catalog: "app", generate: false, ...patch });
const save = (root, patch) => saveGitFetchSettings(root, request(root, patch), writeManifest);

describe("Git fetch settings", () => {
  it("discovers repositories across catalog profiles, including sources outside the union", () => {
    const { root, manifest } = workspace();
    mkdirSync(join(root, "data")); mkdirSync(join(root, "other"));
    writeFileSync(join(root, "data/app.json"), JSON.stringify({ contexts: [{ id: "app", services: [{ repo: "github.com/acme/main" }] }, { id: "excluded", services: [{ repo: "github.com/acme/excluded" }] }] }));
    writeFileSync(join(root, "other/pin.json"), JSON.stringify({ repos: [{ repo: "github.com/bagisto/bagisto" }, { repo: "https://secret@github.com/acme/private" }] }));
    const state = gitFetchState(root);
    expect(state.catalogRepositories).toEqual(expect.arrayContaining([
      { repo: "github.com/acme/main", source: "Catalog · App", catalogs: ["app"] },
      { repo: "github.com/bagisto/bagisto", source: "Catalog · Other", catalogs: ["other"] },
    ]));
    expect(state.catalogRepositories).toHaveLength(2);
    expect(JSON.stringify(state.catalogRepositories)).not.toMatch(/excluded|secret/);
    expect(state.discoveryWarnings).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, "portolan.json")))).toEqual(manifest);
  });
  it("reports unreadable catalog sources without exposing external files", () => {
    const { root } = workspace();
    const external = workspace().root;
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data/broken.json"), "invalid");
    writeFileSync(join(external, "outside.json"), JSON.stringify({ repos: [{ repo: "github.com/private/outside" }] }));
    symlinkSync(join(external, "outside.json"), join(root, "data/link.json"));
    const state = gitFetchState(root);
    expect(state.catalogRepositories).toEqual([]);
    expect(state.discoveryWarnings).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("private/outside");
  });
  it("merges catalog and remote identities while preserving nested paths and explicit ports", () => {
    const rows = mergeGitRepositories([
      { repo: "github.com/acme/shop", source: "Catalog" },
      { repo: "git@github.com:acme/shop.git", source: "Git remote" },
      { repo: "https://secret@github.com/acme/private", source: "Unsafe" },
      { repo: "/local/repo", source: "Local" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ identity: "github.com/acme/shop", sources: ["Catalog", "Git remote"], urls: { https: "https://github.com/acme/shop", ssh: "git@github.com:acme/shop.git" } });
    expect(gitRepositoryAddress("ssh://git@gitlab.example:2222/group/sub/app.git").urls).toEqual({ ssh: "ssh://git@gitlab.example:2222/group/sub/app.git" });
    expect(gitRepositoryAddress("https://gitlab.example/group/sub/app.git").identity).toBe("gitlab.example/group/sub/app");
  });
  it("discovers only explicit checkout remotes without exposing credentials", () => {
    const { root } = workspace();
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init");
    git("remote", "add", "origin", "git@github.com:acme/shop.git");
    git("remote", "add", "secret", "https://token@github.com/acme/secret");
    git("remote", "add", "local", "/tmp/local-repo");
    const state = gitFetchState(root);
    expect(state.remotes).toEqual([{ repo: "git@github.com:acme/shop.git", source: "Git remote · . · origin", catalogs: [] }]);
    expect(state.entries).toEqual([]);
  });
  it("checks read access without cloning, interactive prompts or unsafe URLs", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "" });
    expect(await checkGitAccess("github.com/acme/shop", { run })).toMatchObject({ status: "accessible" });
    expect(run.mock.calls[0][1]).toEqual(["-c", "credential.interactive=false", "ls-remote", "--quiet", "--", "https://github.com/acme/shop", "HEAD"]);
    expect(run.mock.calls[0][2].env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" });
    expect(run.mock.calls[0][2].env.GIT_SSH_COMMAND).toContain("StrictHostKeyChecking=yes");
    run.mockRejectedValue({ stderr: "Permission denied secret-token" });
    const denied = await checkGitAccess("git@github.com:acme/shop", { run });
    expect(denied.status).toBe("unavailable");
    expect(denied.message).not.toContain("secret-token");
    await expect(checkGitAccess("ext::danger", { run })).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
    run.mockRejectedValue({ code: "ETIMEDOUT" });
    expect(await checkGitAccess("github.com/acme/shop", { run })).toMatchObject({ message: expect.stringContaining("timed out") });
  });
  it("saves a schema-valid fetch step and selected repository metadata sources", () => {
    const { root } = workspace();
    const state = save(root);
    expect(state.entries[0]).toMatchObject({ step: 0, plugin: "git", output: "vendor/repos/git-test", repos: [repo], catalogs: ["app"] });
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json")));
    expect(manifest.extract[0].options.cache).toBe(manifest.extract[0].out);
    expect(manifest.sources).toContain("vendor/repos/git-test/acme/shop/git.repo.json");
    expect(manifest.catalogs[1].sources).toEqual(["other/*.json"]);
    save(root, { step: 0, repos: [{ repo: "git@gitlab.example:group/app.git", ref: "main" }] });
    const updated = JSON.parse(readFileSync(join(root, "portolan.json")));
    expect(updated.extract).toHaveLength(1);
    expect(updated.sources).not.toContain("vendor/repos/git-test/acme/shop/git.repo.json");
    expect(updated.sources).toContain("vendor/repos/git-test/group/app/git.repo.json");
  });
  it("rejects unsafe addresses, refs and duplicate output identities", () => {
    for (const address of ["https://token@github.com/acme/shop", "https://github.com/acme/shop?token=secret", "file:///tmp/repo", "ext::command", "https://host/a/../b", "https://host/%2e%2e/a/b"]) expect(() => normalizeGitRepos([{ repo: address }])).toThrow();
    for (const ref of ["--upload-pack=bad", "a..b", "a.lock", "a/.hidden", "a//b"]) expect(() => normalizeGitRepos([{ repo: repo.repo, ref }])).toThrow();
    expect(() => normalizeGitRepos([{ ...repo, commit: "" }])).toThrow(/SHA/);
    expect(() => normalizeGitRepos([repo, { ...repo, repo: "https://elsewhere.test/acme/shop" }])).toThrow(/same owner/);
    expect(gitRepoDirectory("git@gitlab.com:group/sub/app.git")).toBe("sub/app");
    expect(normalizeGitRepos([{ repo: "ssh://git@gitlab.example/group/app.git", ref: "refs/heads/main" }])).toHaveLength(1);
  });
  it("rejects stale writes, occupied outputs, symlinks and moving existing outputs", () => {
    const { root } = workspace();
    const before = readFileSync(join(root, "portolan.json"), "utf8");
    expect(() => save(root, { revision: "old" })).toThrow(/changed/);
    expect(() => save(root, { output: "src" })).toThrow(/vendor\/repos/);
    mkdirSync(join(root, "vendor/repos/occupied"), { recursive: true }); writeFileSync(join(root, "vendor/repos/occupied/keep"), "user");
    expect(() => save(root, { output: "vendor/repos/occupied" })).toThrow(/empty/);
    symlinkSync(join(root, "missing"), join(root, "vendor/repos/link"));
    expect(() => save(root, { output: "vendor/repos/link/sub" })).toThrow(/symlinks/);
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
    save(root);
    expect(() => save(root, { step: 0, output: "vendor/repos/moved" })).toThrow(/cannot be moved/);
    expect(readFileSync(join(root, "vendor/repos/occupied/keep"), "utf8")).toBe("user");
  });
  it("preserves step ordering and unrelated options; prevents output and scope collisions", () => {
    const { root, manifest } = workspace();
    manifest.plugins = [{ name: "git", host: "fetch-git" }];
    manifest.extract = [{ plugin: "git", in: ".", out: "vendor/repos/existing", options: { repos: [repo], cache: "vendor/repos/existing" } }];
    manifest.catalogs[1].sources.push("vendor/repos/**/git.repo.json");
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(() => save(root, { output: "vendor/repos/existing/sub" })).toThrow(/overlaps/);
    expect(() => save(root)).toThrow(/wildcard/);
    const saved = save(root, { catalog: "other" });
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries[0].output).toBe("vendor/repos/existing");
    expect(saved.entries[1].plugin).toBe("git");
  });
  it("isolates connections for the same monorepo across projects", () => {
    const { root } = workspace();
    save(root);
    save(root, { catalog: "other", output: "vendor/repos/other", repos: [{ repo: repo.repo, ref: "develop" }] });
    save(root, { step: 0, repos: [{ repo: repo.repo, ref: "release" }] });
    const state = gitFetchState(root);
    expect(state.entries[0]).toMatchObject({ catalogs: ["app"], repos: [{ ref: "release" }] });
    expect(state.entries[1]).toMatchObject({ catalogs: ["other"], repos: [{ ref: "develop" }] });
    const before = readFileSync(join(root, "portolan.json"), "utf8");
    expect(() => save(root, { step: 0, catalog: "other" })).toThrow(/does not belong/);
    expect(() => save(root, { catalog: "missing" })).toThrow(/known project/);
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
  });
  it("separates a shared step without changing another project's sources or options", () => {
    const { root } = workspace();
    save(root);
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.catalogs[1].sources.push("vendor/repos/git-test/acme/shop/git.repo.json");
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(() => save(root, { step: 0, repos: [{ repo: repo.repo, ref: "develop" }] })).toThrow(/separate output/);
    save(root, { step: 0, output: "vendor/repos/app-copy", repos: [{ repo: repo.repo, ref: "develop" }] });
    const updated = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(updated.extract[0]).toEqual(manifest.extract[0]);
    expect(updated.catalogs[1]).toEqual(manifest.catalogs[1]);
    expect(updated.catalogs[0].sources).not.toContain("vendor/repos/git-test/acme/shop/git.repo.json");
    expect(updated.catalogs[0].sources).toContain("vendor/repos/app-copy/acme/shop/git.repo.json");
    expect(gitFetchState(root).entries.map((entry) => entry.catalogs)).toEqual([["other"], ["app"]]);
  });
  it("associates checkout remotes only with projects that use that root", () => {
    const { root, manifest } = workspace();
    manifest.projects = [{ id: "local", name: "Local", root: ".", context: "app", service: "api" }];
    manifest.catalogs[0].projects = ["local"];
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    execFileSync("git", ["-C", root, "init"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "remote", "add", "origin", repo.repo], { stdio: "pipe" });
    expect(gitFetchState(root).remotes[0].catalogs).toEqual(["app"]);
  });
  it("supports a workspace without catalog profiles", () => {
    const { root, manifest } = workspace();
    delete manifest.catalogs;
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(save(root, { catalog: null }).entries[0].catalogs).toEqual([]);
  });
  it("refuses to separate a wildcard-linked shared snapshot without changing the manifest", () => {
    const { root } = workspace();
    save(root);
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.catalogs[0].sources.push("vendor/repos/git-test/**/git.repo.json");
    manifest.catalogs[1].sources.push("vendor/repos/git-test/acme/shop/git.repo.json");
    const before = JSON.stringify(manifest);
    writeFileSync(join(root, "portolan.json"), before);
    expect(() => save(root, { step: 0, output: "vendor/repos/app-copy" })).toThrow(/wildcard/);
    expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(before);
  });
  it("redacts unsupported credential-bearing manual configs instead of exposing or overwriting them", () => {
    const { root, manifest } = workspace();
    manifest.plugins = [{ name: "git", host: "fetch-git" }];
    manifest.extract = [{ plugin: "git", in: ".", out: "vendor/repos/manual", options: { repos: [{ repo: "https://secret@github.com/acme/shop" }], cache: "vendor/repos/manual" } }];
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(JSON.stringify(gitFetchState(root))).not.toContain("secret");
    expect(() => save(root, { step: 0 })).toThrow(/unsupported or unsafe/);
  });
  it("serves guarded local settings and dispatches an explicitly requested rebuild", async () => {
    const { root } = workspace();
    let handler;
    localApiPlugin(root).configureServer({ config: { base: "/" }, middlewares: { use: (value) => { handler = value; } } });
    const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/__portolan/git-fetch`;
    try {
      expect((await (await fetch(url)).json()).entries).toEqual([]);
      expect((await fetch(url, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
      const body = JSON.stringify(request(root));
      expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(405);
      const headers = { "Content-Type": "application/json", "X-Portolan-Local": "1" };
      expect((await fetch(`${url}/refs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: repo.repo }) })).status).toBe(405);
      expect((await fetch(`${url}/refs`, { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: JSON.stringify({ repository: repo.repo }) })).status).toBe(403);
      expect((await fetch(`${url}/refs`, { method: "POST", headers, body: JSON.stringify({ repository: "file:///tmp/unsafe" }) })).status).toBe(400);
      expect((await fetch(`${url}/check-access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: repo.repo }) })).status).toBe(405);
      expect((await fetch(`${url}/check-access`, { method: "POST", headers, body: JSON.stringify({ repository: "file:///tmp/unsafe" }) })).status).toBe(400);
      expect((await fetch(url, { method: "POST", headers, body })).status).toBe(200);
      const cli = join(root, "fake-cli.mjs"); writeFileSync(cli, 'console.log("git-settings-dispatch");'); vi.stubEnv("PORTOLAN_CLI", cli);
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request(root, { step: 0, generate: true })) });
      expect(response.status).toBe(200);
      const { run } = await response.json();
      expect(run.runId).toBeTruthy();
      const events = await (await fetch(url.replace("/git-fetch", `/runs/${run.runId}/events`))).text();
      expect(events).toContain("git-settings-dispatch");
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
