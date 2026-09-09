// fetch-git, run by the host: a git repository on one side, a narrowed copy of
// it committed to this repository on the other.
//
// It exists for the estate whose services live in repositories of their own.
// An extractor reads one tree, and reads it as a pure function of what is on
// disk; fetching is the step that can fail, need a credential, or come back
// with something different than it did yesterday. Keeping the two apart is
// what lets CI verify an estate it never clones.
//
// It runs in the host rather than as a plugin because it needs a socket and a
// git binary, which no sandboxed module has, and both are the host's to hold
// (portolan.0008). The contract is the plugin's all the same: the fetched
// files are named, never written, so the host writes them, they get a manifest
// entry, are compared by `gen:check` like any other generated file, and are
// removed when the step stops naming them. Paths inside the copy are the
// repository's own, so the extract step that follows points its `in` at the
// vendored service and reads it exactly as it would read the service's own
// checkout.
//
// Two files land beside each copy. `git.lock.json` is for the next run of this
// step - the commit and every file's digest, which is what makes replaying it
// equivalent to fetching again. `git.repo.json` is for the estate: a catalog
// fragment naming the repository and the commit, which is the only way that
// fact reaches a page.
//
// In CI, or with PORTOLAN_OFFLINE=1, the step replays the committed copies,
// checks them against their locks and emits an identical file list, so a
// fork's pull request needs no credential and a forge being down cannot turn
// the tree red.
//
// No credential, ever. portolan.json is committed; git reaches the forge with
// whatever it is configured with - a credential helper, a netrc entry, an ssh
// agent - and nothing here reads or passes any of it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import optionsSchema from "./fetch-git.options.json" with { type: "json" };

export const LOCK_NAME = "git.lock.json";
export const PIN_NAME = "git.repo.json";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";

export function describe() {
  return {
    name: "fetch-git",
    summary: "Fetches pinned directories of another git repository into the tree, with a lock, so extractors can read a service that lives elsewhere.",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * The step. Reads nothing out of the tree being described: its `cache` is
 * repo-relative, like every other path in the manifest, and everything else
 * it needs is in the options.
 *
 * The rules below are the design, not error handling. The one that matters
 * most is the third: a failed fetch with no cache is an ERROR, never a short
 * file list. The host deletes files a step stops naming, and dropping a
 * vendored service because a laptop went offline is worse than a red build.
 *
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv}} [io]
 * @returns {{files: {name: string, contents: string}[], warnings: {severity: string, message: string, ref?: string}[]}}
 */
export function run(request, { env = process.env } = {}) {
  const options = request.options ?? {};
  const generatedAt = String(request.input?.generatedAt ?? "");
  const repos = Array.isArray(options.repos) ? options.repos : [];
  if (repos.length === 0) throw new Error("no repositories to fetch: name at least one in the manifest");
  if (!options.cache) {
    throw new Error("no cache directory: set `cache` to the same path as the step's `out`, so an offline run can replay what the last online one wrote");
  }

  const out = new Builder();
  // Sorted, so the file list and the diagnostics come out the same way every
  // run whatever order the manifest happens to list them in.
  const wanted = [...repos].sort((a, b) => String(a.repo).localeCompare(String(b.repo)));
  const skip = offline(env);

  for (const want of wanted) {
    const { url, dir } = splitRepo(want.repo);
    const at = join(options.cache, ...dir.split("/"));

    if (skip) {
      emitCached(out, dir, at, want, "offline", generatedAt);
      continue;
    }

    let fetched;
    try {
      fetched = live(url, want, out, env);
    } catch (cause) {
      // Rule 2: the tree still holds a good copy, so the output is unchanged
      // and `--check` stays clean.
      try {
        emitCached(out, dir, at, want, cause.message, generatedAt);
      } catch (cacheCause) {
        // Rule 3: nothing to fall back to.
        throw new Error(`${want.repo} could not be fetched (${cause.message}) and there is no usable copy in the tree (${cacheCause.message})`);
      }
      continue;
    }
    emitFetched(out, dir, want, fetched.commit, fetched.files, generatedAt);
  }

  return out.response();
}

/** Whether to open a socket. Explicit, and CI verifies what was committed. */
export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

/**
 * The name the manifest uses, turned into a URL git can fetch and the
 * directory the copy lives in: owner/name, the same shape as fetch-bsr.
 */
export function splitRepo(name) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("a repo entry names no repository");
  let url;
  let where;
  if (value.startsWith("git@")) {
    url = value;
    where = value.slice(value.indexOf(":") + 1);
  } else if (value.includes("://")) {
    url = value;
    where = value.slice(value.indexOf("://") + 3);
    const slash = where.indexOf("/");
    where = slash >= 0 ? where.slice(slash + 1) : "";
  } else {
    url = `https://${value}`;
    const slash = value.indexOf("/");
    where = slash >= 0 ? value.slice(slash + 1) : "";
  }
  const segments = where.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) throw new Error(`"${value}" does not name an owner and a repository`);
  return { url, dir: `${segments.at(-2)}/${segments.at(-1)}` };
}

/**
 * The repository as `Service.repo` spells it - host/owner/name, the way go.mod
 * writes it - whatever spelling the manifest used. The lock keeps what the
 * manifest said, because a lock is about the fetch; the fragment is matched
 * against a service's `repo`, which knows nothing of ssh URLs.
 */
export function webRepo(name) {
  let value = String(name ?? "").trim();
  if (value.startsWith("git@")) {
    const rest = value.slice("git@".length);
    const colon = rest.indexOf(":");
    value = colon >= 0 ? `${rest.slice(0, colon)}/${rest.slice(colon + 1)}` : rest;
  } else if (value.includes("://")) {
    value = value.slice(value.indexOf("://") + 3);
    const at = value.indexOf("@");
    if (at >= 0) value = value.slice(at + 1);
  }
  return value.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
}

/** The fragment for one repository at one commit: a catalog with one pin. */
export function pin(repo, commit, generatedAt = "") {
  return `${JSON.stringify({ ...(generatedAt ? { generatedAt } : {}), contexts: [], defs: {}, flows: [], adrs: [], repos: [{ repo: webRepo(repo), commit }] }, null, 2)}\n`;
}

/** The lock, written the way every generated file here is written. */
export function encodeLock(entry) {
  const files = [...entry.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const record = { repo: entry.repo, commit: entry.commit };
  if (entry.paths?.length) record.paths = [...entry.paths].sort();
  record.files = files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }));
  return `${JSON.stringify({ repos: [record] }, null, 2)}\n`;
}

function digestOf(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function live(url, want, out, env) {
  let commit = String(want.commit ?? "");
  if (!commit) {
    // Pin, or every run is a lottery. Resolving a ref still works, but it is
    // said out loud, because two runs a day apart would then produce two
    // different trees from one manifest.
    commit = resolve(url, want.ref, env);
    out.warn(want.repo, `is not pinned; "${want.ref || "HEAD"}" resolved to ${commit}. Pin it in portolan.json or every run is a lottery.`);
  }
  const files = download(url, commit, want.paths ?? [], env);
  if (files.size === 0) throw new Error(`${want.repo} at ${commit} holds no files under ${(want.paths ?? []).join(", ")}`);
  return { commit, files };
}

function emitFetched(out, dir, want, commit, files, generatedAt) {
  const entry = { repo: want.repo, commit, paths: want.paths ?? [], files: [] };
  for (const path of [...files.keys()].sort()) {
    const contents = files.get(path);
    out.file(posix.join(dir, path), contents);
    entry.files.push({ path, sha256: digestOf(contents), size: contents.length });
  }
  out.file(posix.join(dir, LOCK_NAME), encodeLock(entry));
  out.file(posix.join(dir, PIN_NAME), pin(want.repo, commit, generatedAt));
}

/**
 * Re-emits the committed copy unchanged: byte-identical to what the last
 * online run wrote, so `gen:check` sees no drift and CI can verify an estate
 * whose services live in repositories it never clones.
 */
function emitCached(out, dir, at, want, why, generatedAt = "") {
  if (!want.commit) throw new Error(`${want.repo} is not pinned to a commit, so there is nothing to replay`);
  const held = replay(at);
  if (held.lock.commit !== want.commit) {
    throw new Error(`${want.repo} holds commit ${held.lock.commit} but the manifest pins ${want.commit}; fetch it`);
  }
  for (const file of held.lock.files) out.file(posix.join(dir, file.path), held.files.get(file.path));
  out.file(posix.join(dir, LOCK_NAME), encodeLock(held.lock));
  // From the LOCK's commit, not the manifest's. They are equal by the check
  // above, and taking it from the copy is what keeps the fragment describing
  // what is actually on disk rather than what was asked for.
  out.file(posix.join(dir, PIN_NAME), pin(want.repo, held.lock.commit, generatedAt));
  out.warn(want.repo, `not fetched (${why}); the copy committed in this repository is used unchanged`);
}

/**
 * A repository's committed copy, read back and checked against its lock. An
 * incomplete or edited cache is reported rather than patched over: nothing on
 * disk means there is nothing to fall back to, and bytes that no longer match
 * their digest mean somebody edited a vendored copy.
 */
function replay(dir) {
  const lockPath = join(dir, LOCK_NAME);
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") throw new Error(`no ${LOCK_NAME} in ${dir.split("\\").join("/")}`);
    throw cause;
  }
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${lockPath}: ${cause.message}`);
  }
  const repos = Array.isArray(lock.repos) ? lock.repos : [];
  if (repos.length !== 1) throw new Error(`${lockPath} names ${repos.length} repositories; expected exactly one`);
  const entry = repos[0];
  const files = new Map();
  for (const want of entry.files ?? []) {
    let contents;
    try {
      contents = readFileSync(join(dir, ...String(want.path).split("/")));
    } catch (cause) {
      if (cause.code === "ENOENT") throw new Error(`${want.path} is in the lock but not on disk`);
      throw cause;
    }
    if (digestOf(contents) !== want.sha256) throw new Error(`${want.path} does not match its digest; the vendored copy was edited by hand`);
    files.set(want.path, contents);
  }
  return { lock: { repo: entry.repo, commit: entry.commit, paths: entry.paths ?? [], files: entry.files ?? [] }, files };
}

// --- git --------------------------------------------------------------------
//
// The host already needs a git binary to stamp fragments, so this leans on
// the same one rather than on a library: whatever git is configured to do
// about credentials and hosts, it does here too. Prompts are off: a fetch
// that needs a credential git does not have is a failure to report, not a
// question to hang on.

function git(cwd, args, env, { binary = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: cwd || undefined,
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 512 * 1024 * 1024,
      ...(binary ? {} : { encoding: "utf8" }),
    });
  } catch (cause) {
    const stderr = String(cause.stderr ?? "").trim();
    throw new Error(`git ${args[0]}: ${(stderr || cause.message).split("\n")[0]}`);
  }
}

/** What the remote says a ref points at right now. */
function resolve(url, ref, env) {
  const out = git("", ["ls-remote", "--quiet", url, ref || "HEAD"], env);
  for (const line of out.trim().split("\n")) {
    const [sha] = line.trim().split(/\s+/);
    if (sha && sha.length === 40) return sha;
  }
  throw new Error(`${url} has no ref "${ref || "HEAD"}"`);
}

/**
 * One commit, fetched, and the wanted paths read out of it. The commit is
 * fetched by name where the forge allows it - GitHub and GitLab do - and by
 * its branches where it does not, which is the case for a plain file://
 * remote; either way what is read is verified to be that commit.
 *
 * @returns {Map<string, Buffer>} path → contents
 */
function download(url, commit, paths, env) {
  const tmp = mkdtempSync(join(tmpdir(), "portolan-fetch-git-"));
  try {
    git(tmp, ["init", "--quiet"], env);
    try {
      git(tmp, ["fetch", "--quiet", "--depth", "1", url, commit], env);
    } catch (cause) {
      try {
        git(tmp, ["fetch", "--quiet", "--depth", "1", url, "+refs/heads/*:refs/remotes/src/*"], env);
      } catch {
        throw cause;
      }
    }
    try {
      git(tmp, ["cat-file", "-e", `${commit}^{commit}`], env);
    } catch {
      throw new Error(`${commit} is not a commit ${url} has, or not one reachable from a branch`);
    }

    const listing = git(tmp, ["ls-tree", "-r", "-z", "--format=%(objectname) %(objecttype) %(path)", commit, "--", ...paths], env);
    const blobs = [];
    for (const line of listing.split("\0")) {
      if (!line) continue;
      const [sha, type, ...rest] = line.split(" ");
      if (type !== "blob") continue;
      blobs.push({ sha, path: posix.normalize(rest.join(" ")) });
    }
    const files = new Map();
    if (blobs.length === 0) return files;

    // One process for every blob: `cat-file --batch` answers each sha with a
    // header line and the bytes.
    const batch = execFileSync("git", ["cat-file", "--batch"], {
      cwd: tmp,
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
      input: `${blobs.map((blob) => blob.sha).join("\n")}\n`,
      maxBuffer: 512 * 1024 * 1024,
    });
    let offset = 0;
    for (const blob of blobs) {
      const newline = batch.indexOf(0x0a, offset);
      const header = batch.subarray(offset, newline).toString("utf8").split(" ");
      if (header[1] === "missing") throw new Error(`${blob.path} is missing from ${commit}`);
      const size = Number(header[2]);
      const start = newline + 1;
      files.set(blob.path, Buffer.from(batch.subarray(start, start + size)));
      offset = start + size + 1;
    }
    return files;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Accumulates a response the way plugin.Builder does. */
class Builder {
  files = [];
  warnings = [];

  file(name, contents) {
    if (!Buffer.isBuffer(contents)) {
      this.files.push({ name, contents });
      return;
    }
    const text = contents.toString("utf8");
    this.files.push(
      Buffer.from(text, "utf8").equals(contents)
        ? { name, contents: text }
        : { name, contents: contents.toString("base64"), encoding: "base64" },
    );
  }

  warn(ref, message) {
    this.warnings.push({ severity: "warning", message, ref });
  }

  response() {
    return { files: this.files, warnings: this.warnings };
  }
}
