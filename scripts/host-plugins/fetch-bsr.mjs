// fetch-bsr, run by the host: a schema registry on one side, .proto files
// committed to this repository on the other.
//
// It is split off from extract-proto because it opens a socket. Extraction
// stays a pure function of the tree; fetching is the step that can fail, need
// a credential, or come back with something different than it did yesterday.
// Keeping them apart is what lets CI verify an estate whose schemas live in a
// registry it never talks to.
//
// It runs in the host (portolan.0008) because a socket and a secret are the
// host's to hold. The contract is the plugin's: the fetched protos are named,
// never written, so the host writes them, they get a manifest entry, are
// compared by `gen:check` like any other generated file, and are removed
// when the step stops naming them. Refreshing a pin then produces ONE pull
// request holding the pin bump, the proto diff, the lock diff and the
// fragment diff - which is the review worth having.
//
// In CI, or with PORTOLAN_OFFLINE=1, the step replays the committed copies,
// checks them against their locks and emits an identical file list, so a
// fork's pull request needs no secret and the registry being down cannot
// turn the tree red.
//
// No token in the manifest, ever: portolan.json is committed. The credential
// comes from BUF_TOKEN or the netrc `buf registry login` writes, and it
// changes whether the fetch succeeds, never what the fetch says.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

import optionsSchema from "./fetch-bsr.options.json" with { type: "json" };

export const LOCK_NAME = "bsr.lock.json";
export const TOKEN_ENV = "BUF_TOKEN";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";

// The BSR's public API is Connect, and a Connect unary call is an ordinary
// HTTP POST carrying the request message as JSON. The message shapes are
// buf/registry/module/v1 with protojson's names: lowerCamelCase, bytes as
// base64. Everything the wire knows is in this file on purpose.
export const DOWNLOAD_METHOD = "/buf.registry.module.v1.DownloadService/Download";
export const COMMITS_METHOD = "/buf.registry.module.v1.CommitService/GetCommits";

export function describe() {
  return {
    name: "fetch-bsr",
    summary: "Fetches pinned modules from a Buf Schema Registry into the tree, with a lock beside each, so the proto extractor can read a published contract.",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * The step. Reads nothing out of the tree being described; its `cache` is
 * repo-relative and everything else is in the options.
 *
 * The rules below are the design, not error handling. The one that matters
 * most is the third: a failed fetch with no cache is an ERROR, never a short
 * file list, because the host deletes files a step stops naming.
 *
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv, fetch?: typeof fetch}} [io]
 */
export async function run(request, { env = process.env, fetch: fetchFn = globalThis.fetch } = {}) {
  const options = request.options ?? {};
  const modules = Array.isArray(options.modules) ? options.modules : [];
  if (modules.length === 0) throw new Error("no modules to fetch: name at least one in the manifest");
  if (!options.cache) {
    throw new Error("no cache directory: set `cache` to the same path as the step's `out`, so an offline run can replay what the last online one wrote");
  }

  const out = new Builder();
  const wanted = [...modules].sort((a, b) => String(a.module).localeCompare(String(b.module)));
  const skip = offline(env);

  for (const want of wanted) {
    const parts = splitModule(want.module);
    const registry = options.registry || parts.registry;
    // Every module lives in its own directory with its own lock, so a
    // vendored module is self-describing and extract-proto finds the lock
    // by looking beside the files it is already reading.
    const dir = `${parts.owner}/${parts.module}`;
    const at = join(options.cache, parts.owner, parts.module);

    if (skip) {
      emitCached(out, dir, at, want, "offline");
      continue;
    }

    let fetched;
    try {
      fetched = await live(registry, parts, want, out, env, fetchFn);
    } catch (cause) {
      // Rule 2: the tree still holds a good copy, so the output is unchanged
      // and `--check` stays clean.
      try {
        emitCached(out, dir, at, want, cause.message);
      } catch (cacheCause) {
        // Rule 3: nothing to fall back to.
        throw new Error(`${want.module} could not be fetched (${cause.message}) and there is no usable copy in the tree (${cacheCause.message})`);
      }
      continue;
    }
    emitFetched(out, dir, want.module, fetched.commit, fetched.files);
  }

  return out.response();
}

export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

/** `buf.build/acme/shop` in its three parts. */
export function splitModule(name) {
  const parts = String(name ?? "").trim().split("/");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error(`"${String(name ?? "").trim()}" is not a module name; expected <registry>/<owner>/<module>`);
  }
  return { registry: parts[0], owner: parts[1], module: parts[2] };
}

/**
 * A credential for a registry, or "". None is a normal outcome: public
 * modules download anonymously. The environment wins over the netrc
 * `buf registry login` wrote.
 */
export function token(registry, env = process.env) {
  const fromEnv = String(env[TOKEN_ENV] ?? "").trim();
  if (fromEnv) return fromEnv;
  const home = env.HOME || homedir();
  for (const name of [".netrc", "_netrc"]) {
    let text;
    try {
      text = readFileSync(join(home, name), "utf8");
    } catch {
      continue;
    }
    const found = netrcPassword(text, registry);
    if (found) return found;
  }
  return "";
}

/** The password belonging to one machine in a netrc: a stream of words. */
export function netrcPassword(text, machine) {
  const words = text.split(/\s+/).filter(Boolean);
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    switch (words[index]) {
      case "machine":
        index += 1;
        if (index >= words.length) return "";
        current = words[index];
        break;
      case "default":
        current = machine;
        break;
      case "password":
        index += 1;
        if (index >= words.length) return "";
        if (current === machine) return words[index];
        break;
      case "login":
      case "account":
        index += 1;
        break;
      default:
        break;
    }
  }
  return "";
}

/** A digest the way buf writes one: `b5:<hex>`. */
export function displayDigest(digest) {
  const value = digest?.value ? Buffer.from(String(digest.value), "base64") : Buffer.alloc(0);
  if (value.length === 0) return "";
  let kind = String(digest.type ?? "").replace(/^DIGEST_TYPE_/, "").toLowerCase();
  if (!kind || kind === "unspecified") kind = "b5";
  return `${kind}:${value.toString("hex")}`;
}

/** The lock, written the way every generated file here is written. */
export function encodeLock(entry) {
  const record = { module: entry.module, commit: entry.commit };
  if (entry.digest) record.digest = entry.digest;
  if (entry.deps?.length) record.deps = [...entry.deps].sort();
  record.files = [...entry.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }));
  return `${JSON.stringify({ modules: [record] }, null, 2)}\n`;
}

function digestOf(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function live(registry, parts, want, out, env, fetchFn) {
  const client = new Client(registry, token(registry, env), fetchFn);
  let ref = String(want.commit ?? "");
  if (!ref) {
    // Pin, or every run is a lottery. Resolving a label still works, but it
    // is said out loud.
    const label = want.ref || "main";
    const resolved = await client.resolve(parts.owner, parts.module, label);
    out.warn(want.module, `is not pinned; "${label}" resolved to ${resolved.id}. Pin it in portolan.json or every run is a lottery.`);
    ref = resolved.id;
  }
  const { commit, files } = await client.download(parts.owner, parts.module, ref, want.paths ?? []);
  if (files.size === 0) throw new Error(`${want.module} at ${ref} holds no .proto files`);
  return { commit, files };
}

function emitFetched(out, dir, name, commit, files) {
  const entry = { module: name, commit: commit.id, digest: displayDigest(commit.digest), files: [] };
  for (const path of [...files.keys()].sort()) {
    const contents = files.get(path);
    out.file(posix.join(dir, path), contents.toString("utf8"));
    entry.files.push({ path, sha256: digestOf(contents), size: contents.length });
  }
  out.file(posix.join(dir, LOCK_NAME), encodeLock(entry));
}

function emitCached(out, dir, at, want, why) {
  if (!want.commit) throw new Error(`${want.module} is not pinned to a commit, so there is nothing to replay`);
  const held = replay(at);
  if (held.lock.commit !== want.commit) {
    throw new Error(`${want.module} holds commit ${held.lock.commit} but the manifest pins ${want.commit}; fetch it`);
  }
  for (const file of held.lock.files) out.file(posix.join(dir, file.path), held.files.get(file.path).toString("utf8"));
  out.file(posix.join(dir, LOCK_NAME), encodeLock(held.lock));
  out.warn(want.module, `not fetched (${why}); the copy committed in this repository is used unchanged`);
}

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
  const modules = Array.isArray(lock.modules) ? lock.modules : [];
  if (modules.length !== 1) throw new Error(`${lockPath} names ${modules.length} modules; expected exactly one`);
  const entry = modules[0];
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
  return {
    lock: { module: entry.module, commit: entry.commit, digest: entry.digest ?? "", deps: entry.deps ?? [], files: entry.files ?? [] },
    files,
  };
}

/** One registry, spoken to over Connect. */
class Client {
  constructor(registry, credential, fetchFn) {
    // buf.build is https and needs no help; a self-hosted BSR behind a plain
    // http address, or a test server, says so with a scheme.
    this.base = /^https?:\/\//.test(registry) ? registry.replace(/\/$/, "") : `https://${registry}`;
    this.credential = credential;
    this.fetch = fetchFn;
  }

  async download(owner, module, ref, paths) {
    const body = {
      values: [{
        resourceRef: { name: { owner, module, ref } },
        // Only .proto: the docs and licence a module also carries are not
        // something portolan reads.
        fileTypes: ["FILE_TYPE_PROTO"],
        ...(paths.length ? { paths, pathsAllowNotExist: true } : {}),
      }],
    };
    const answer = await this.call(DOWNLOAD_METHOD, body);
    const content = answer.contents?.[0];
    if (!content) throw new Error(`${owner}/${module}: the registry returned no content`);
    const files = new Map();
    for (const file of content.files ?? []) files.set(file.path, Buffer.from(String(file.content ?? ""), "base64"));
    return { commit: content.commit ?? {}, files };
  }

  async resolve(owner, module, ref) {
    const answer = await this.call(COMMITS_METHOD, { resourceRefs: [{ name: { owner, module, ref } }] });
    const commit = answer.commits?.[0];
    if (!commit) throw new Error(`${owner}/${module}: no commit for "${ref}"`);
    return commit;
  }

  async call(method, body) {
    const headers = { "Content-Type": "application/json", "Connect-Protocol-Version": "1" };
    if (this.credential) headers.Authorization = `Bearer ${this.credential}`;
    let response;
    try {
      // A timeout rather than none: a step that hangs holds up the whole run.
      response = await this.fetch(`${this.base}${method}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch (cause) {
      throw new Error(`${method}: ${cause.cause?.message ?? cause.message}`);
    }
    const raw = await response.text();
    if (!response.ok) throw new Error(`${method}: ${connectError(response.status, raw)}`);
    return JSON.parse(raw);
  }
}

/** The error body Connect sends, or the status when the body is not one. */
function connectError(status, raw) {
  try {
    const wire = JSON.parse(raw);
    if (wire?.message) return wire.code ? `${wire.code}: ${wire.message}` : wire.message;
  } catch {
    // Not a Connect error body.
  }
  return `http ${status}`;
}

class Builder {
  files = [];
  warnings = [];

  file(name, contents) {
    this.files.push({ name, contents });
  }

  warn(ref, message) {
    this.warnings.push({ severity: "warning", message, ref });
  }

  response() {
    return { files: this.files, warnings: this.warnings };
  }
}
