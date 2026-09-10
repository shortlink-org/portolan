import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPlugin } from "../plugin-host.mjs";
import { LOCK_NAME, OFFLINE_ENV, encodeLock, pin, run, splitRepo, webRepo } from "./fetch-git.mjs";

const created = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

// A repository to fetch from, made on the spot: git itself is the fake, and
// what it serves is what a forge would serve.
function repository() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-git-remote-"));
  created.push(dir);
  const git = (args) => execFileSync("git", [
    "-c", "user.name=test", "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main",
    ...args,
  ], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (rel, contents) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), contents);
  };
  git(["init", "--quiet"]);
  write("services/oms/internal/domain/order/order.go", "package order\n");
  write("services/oms/README.md", "# OMS\n");
  write("proto/shop/v1/orders.proto", 'syntax = "proto3";\n');
  write("docs/example.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]));
  write("README.md", "# shop\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "the estate"]);
  // A forge lets a client fetch a commit by name; a plain file remote does
  // not unless told to, and the fallback to branches is tested separately.
  git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
  return { dir, url: `file://${dir}`, commit: git(["rev-parse", "HEAD"]), git, copyDir: `${basename(dirname(dir))}/${basename(dir)}` };
}

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-git-cache-"));
  created.push(dir);
  return dir;
}

const online = { CI: "", [OFFLINE_ENV]: "" };
const offline = { CI: "", [OFFLINE_ENV]: "1" };
const options = (remote, cacheDir, paths) => ({ cache: cacheDir, repos: [{ repo: remote.url, commit: remote.commit, ...(paths ? { paths } : {}) }] });
const fetch = (opts, env, input) => run({ options: opts, ...(input ? { input } : {}) }, { env: { ...process.env, ...env } });
const names = (response) => response.files.map((file) => file.name).sort();
const contentsOf = (response, name) => response.files.find((file) => file.name === name)?.contents ?? "";
// What the host does with a response.
const write = (dir, response) => {
  for (const file of response.files) {
    mkdirSync(dirname(join(dir, file.name)), { recursive: true });
    writeFileSync(join(dir, file.name), file.encoding === "base64" ? Buffer.from(file.contents, "base64") : file.contents);
  }
};

describe("fetch-git", () => {
  it("writes the narrowed copy, a lock and a pin", () => {
    const remote = repository();
    const generatedAt = "2026-09-09T03:00:00.000Z";
    const response = fetch(options(remote, cache(), ["services/oms", "proto"]), online, { generatedAt });
    // The directory is owner/name, read off the URL; the paths inside are
    // the repository's own, so an extractor can read the copy as a checkout.
    const dir = remote.copyDir;
    expect(names(response)).toEqual([
      `${dir}/git.lock.json`,
      `${dir}/git.repo.json`,
      `${dir}/proto/shop/v1/orders.proto`,
      `${dir}/services/oms/README.md`,
      `${dir}/services/oms/internal/domain/order/order.go`,
    ]);
    const lock = JSON.parse(contentsOf(response, `${dir}/git.lock.json`));
    expect(lock.repos[0]).toMatchObject({ repo: remote.url, commit: remote.commit, paths: ["proto", "services/oms"] });
    expect(lock.repos[0].files.map((file) => file.path)).toEqual(["proto/shop/v1/orders.proto", "services/oms/README.md", "services/oms/internal/domain/order/order.go"]);
    expect(lock.repos[0].files[0]).toMatchObject({ size: 19 });
    expect(lock.repos[0].files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(response.warnings).toEqual([]);

    // The fragment is the lock's commit said in the shape the catalog reads.
    const fragment = contentsOf(response, `${dir}/git.repo.json`);
    expect(JSON.parse(fragment)).toEqual({ generatedAt, contexts: [], defs: {}, flows: [], adrs: [], repos: [{ repo: remote.dir.slice(1), commit: remote.commit }] });
    expect(fragment.endsWith("\n")).toBe(true);
  });

  it("replays the committed copy offline, byte for byte, and says so", () => {
    const remote = repository();
    const cacheDir = cache();
    const first = fetch(options(remote, cacheDir, ["services/oms"]), online);
    write(cacheDir, first);

    const replayed = fetch(options(remote, cacheDir, ["services/oms"]), offline);
    expect(names(replayed)).toEqual(names(first));
    for (const file of first.files) expect(contentsOf(replayed, file.name)).toBe(file.contents);
    expect(replayed.warnings).toHaveLength(1);
    expect(replayed.warnings[0].message).toContain("offline");

    // CI verifies what was committed and never opens a socket.
    const inCi = fetch(options(remote, cacheDir, ["services/oms"]), { CI: "true", [OFFLINE_ENV]: "" });
    expect(inCi.warnings).toHaveLength(1);
  });

  it("skips binary blobs online and from the offline cache", () => {
    const remote = repository();
    const cacheDir = cache();
    const first = fetch(options(remote, cacheDir, ["docs/example.png"]), online);
    const name = `${remote.copyDir}/docs/example.png`;
    expect(first.files.find((file) => file.name === name)).toBeUndefined();
    expect(first.files.every((file) => file.encoding === undefined)).toBe(true);
    const lockName = `${remote.copyDir}/${LOCK_NAME}`;
    expect(JSON.parse(contentsOf(first, lockName)).repos[0].skipped).toEqual([
      { path: "docs/example.png", size: 10, reason: "known binary extension .png" },
    ]);
    expect(first.warnings[0].message).toContain("skipped 1 binary file (10 bytes)");
    write(cacheDir, first);
    expect(() => readFileSync(join(cacheDir, name))).toThrow();

    const replayed = fetch(options(remote, cacheDir, ["docs/example.png"]), offline);
    expect(replayed.files.find((file) => file.name === name)).toBeUndefined();
    expect(JSON.parse(contentsOf(replayed, lockName)).repos[0].skipped).toEqual([
      { path: "docs/example.png", size: 10, reason: "known binary extension .png" },
    ]);
  });

  it("does not read a large known binary into the plugin response and sniffs unknown binary files", () => {
    const remote = repository();
    const mmdb = "tests/integration/resources/GeoLite2-Country.mmdb";
    const unknown = "tests/integration/resources/blob.data";
    mkdirSync(dirname(join(remote.dir, mmdb)), { recursive: true });
    writeFileSync(join(remote.dir, mmdb), Buffer.alloc(10 * 1024 * 1024, 0xab));
    writeFileSync(join(remote.dir, unknown), Buffer.from([1, 0, 2]));
    remote.git(["add", "."]);
    remote.git(["commit", "--quiet", "-m", "binary fixtures"]);
    remote.commit = remote.git(["rev-parse", "HEAD"]);

    const response = fetch(options(remote, cache(), [mmdb, unknown]), online);
    expect(response.files.every((file) => file.encoding === undefined)).toBe(true);
    expect(JSON.stringify(response).length).toBeLessThan(20_000);
    const lock = JSON.parse(contentsOf(response, `${remote.copyDir}/${LOCK_NAME}`)).repos[0];
    expect(lock.files).toEqual([]);
    expect(lock.skipped).toEqual([
      { path: mmdb, size: 10 * 1024 * 1024, reason: "known binary extension .mmdb" },
      { path: unknown, size: 3, reason: "NUL byte in first 8192 bytes" },
    ]);
  });

  it("drops binary files from a cache written by an older Portolan", () => {
    const remote = repository();
    const cacheDir = cache();
    const at = join(cacheDir, remote.copyDir);
    const path = "docs/example.png";
    const contents = readFileSync(join(remote.dir, path));
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), contents);
    writeFileSync(join(at, LOCK_NAME), encodeLock({
      repo: remote.url,
      commit: remote.commit,
      paths: [path],
      files: [{ path, size: contents.length, sha256: createHash("sha256").update(contents).digest("hex") }],
    }));

    const replayed = fetch(options(remote, cacheDir, [path]), offline);
    expect(replayed.files.some((file) => file.name.endsWith(path))).toBe(false);
    expect(JSON.parse(contentsOf(replayed, `${remote.copyDir}/${LOCK_NAME}`)).repos[0]).toMatchObject({
      files: [],
      skipped: [{ path, size: contents.length, reason: "known binary extension .png" }],
    });
  });

  it("names the edited file when a vendored copy no longer matches its lock", () => {
    const remote = repository();
    const cacheDir = cache();
    const first = fetch(options(remote, cacheDir, ["services/oms"]), online);
    write(cacheDir, first);
    const edited = names(first).find((name) => name.endsWith("order.go"));
    writeFileSync(join(cacheDir, edited), "package order // edited\n");

    expect(() => fetch(options(remote, cacheDir, ["services/oms"]), offline)).toThrow(/order\.go.*edited by hand/);
  });

  it("fails rather than emitting nothing when there is no copy to fall back to", () => {
    const nowhere = { url: "file:///nowhere/acme/shop", commit: "0".repeat(40) };
    expect(() => fetch(options(nowhere, cache()), offline)).toThrow(/no git\.lock\.json/);
    const gone = { url: `file://${join(cache(), "acme", "gone")}`, commit: "0".repeat(40) };
    expect(() => fetch(options(gone, cache()), online)).toThrow(/no usable copy/);
  });

  it("falls back to the committed copy when the forge is gone", () => {
    const remote = repository();
    const cacheDir = cache();
    const first = fetch(options(remote, cacheDir, ["proto"]), online);
    write(cacheDir, first);
    rmSync(remote.dir, { recursive: true, force: true });

    const fallback = fetch(options(remote, cacheDir, ["proto"]), online);
    expect(names(fallback)).toEqual(names(first));
    expect(fallback.warnings).toHaveLength(1);
    expect(fallback.warnings[0].message).toContain("not fetched");
  });

  it("resolves an unpinned repository online with a warning, and refuses it offline", () => {
    const remote = repository();
    const opts = { cache: cache(), repos: [{ repo: remote.url, ref: "main", paths: ["proto"] }] };
    const response = fetch(opts, online);
    expect(response.warnings).toHaveLength(1);
    expect(response.warnings[0].message).toContain("not pinned");
    expect(response.warnings[0].message).toContain(remote.commit);

    expect(() => fetch(opts, offline)).toThrow(/not pinned/);
  });

  it("reaches a commit through its branch when the remote refuses it by name", () => {
    const remote = repository();
    remote.git(["config", "--unset", "uploadpack.allowAnySHA1InWant"]);
    const response = fetch(options(remote, cache(), ["README.md"]), online);
    // The file, the lock, and the fragment naming the commit.
    expect(names(response)).toHaveLength(3);
  });

  it("runs through the host like any plugin, warnings kept beside the files", async () => {
    const remote = repository();
    const cacheDir = cache();
    write(cacheDir, fetch(options(remote, cacheDir, ["proto"]), online));
    const saved = { CI: process.env.CI, [OFFLINE_ENV]: process.env[OFFLINE_ENV] };
    process.env.CI = "";
    process.env[OFFLINE_ENV] = "1";
    try {
      const result = await runPlugin({ name: "git", host: "fetch-git" }, { portolanVersion: "0.1.0", options: options(remote, cacheDir, ["proto"]) });
      expect(result.files.map((file) => file.name)).toHaveLength(3);
      expect(result.warnings).toEqual([`${remote.url}: not fetched (offline); the copy committed in this repository is used unchanged`]);
      const described = await runPlugin({ name: "git", host: "fetch-git" }, { portolanVersion: "0.1.0", kind: "describe" });
      expect(described.describe).toMatchObject({ name: "fetch-git", phases: ["extract"] });
      expect(described.describe.options.required).toEqual(["repos", "cache"]);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    await expect(runPlugin({ name: "x", host: "../etc" }, {})).rejects.toThrow("no plugin named");
  });
});

describe("names", () => {
  it("splits what the manifest wrote into a URL and a copy directory", () => {
    const cases = {
      "github.com/acme/shop": ["https://github.com/acme/shop", "acme/shop"],
      "https://gitlab.com/acme/shop.git": ["https://gitlab.com/acme/shop.git", "acme/shop"],
      "git@github.com:acme/shop.git": ["git@github.com:acme/shop.git", "acme/shop"],
      "ssh://git@github.com/acme/shop": ["ssh://git@github.com/acme/shop", "acme/shop"],
      "https://gitlab.com/org/group/shop": ["https://gitlab.com/org/group/shop", "group/shop"],
    };
    for (const [name, [url, dir]] of Object.entries(cases)) expect(splitRepo(name)).toEqual({ url, dir });
    expect(() => splitRepo("shop")).toThrow("owner and a repository");
  });

  it("spells a pin the way go.mod spells the repository", () => {
    for (const spelling of [
      "github.com/acme/shop", "github.com/acme/shop/", "github.com/acme/shop.git",
      "https://github.com/acme/shop", "https://github.com/acme/shop.git",
      "ssh://git@github.com/acme/shop.git", "git@github.com:acme/shop.git", "  github.com/acme/shop  ",
    ]) expect(webRepo(spelling)).toBe("github.com/acme/shop");
  });

  it("writes a pin and a lock the way every generated file is written", () => {
    const fragment = pin("git@github.com:acme/shop.git", "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0");
    expect(fragment).toBe(`${JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [], repos: [{ repo: "github.com/acme/shop", commit: "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0" }] }, null, 2)}\n`);
    expect(pin("github.com/acme/shop", "c1d2e3f")).toBe(pin("github.com/acme/shop", "c1d2e3f"));
    expect(JSON.parse(pin("github.com/acme/shop", "c1d2e3f", "2026-09-09T03:00:00.000Z"))).toMatchObject({
      generatedAt: "2026-09-09T03:00:00.000Z",
      repos: [{ repo: "github.com/acme/shop", commit: "c1d2e3f" }],
    });

    const lock = encodeLock({ repo: "github.com/acme/shop", commit: "abc", paths: ["services/oms", "proto"], files: [{ path: "b", sha256: "2", size: 1 }, { path: "a", sha256: "1", size: 1 }], skipped: [{ path: "z.png", size: 2, reason: "known binary extension .png" }] });
    expect(JSON.parse(lock)).toEqual({ repos: [{ repo: "github.com/acme/shop", commit: "abc", paths: ["proto", "services/oms"], files: [{ path: "a", sha256: "1", size: 1 }, { path: "b", sha256: "2", size: 1 }], skipped: [{ path: "z.png", size: 2, reason: "known binary extension .png" }] }] });
    expect(JSON.parse(encodeLock({ repo: "r", commit: "c", paths: [], files: [] })).repos[0]).not.toHaveProperty("paths");
  });
});
