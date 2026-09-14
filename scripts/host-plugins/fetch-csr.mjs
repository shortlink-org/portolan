// fetch-csr, run by the host: a Confluent Schema Registry on one side, schema
// files committed to this repository on the other.
//
// Shaped like fetch-bsr on purpose and living by the same rules: a pinned
// version is immutable, so a fetch is byte-reproducible; the committed copy
// replays offline and in CI; a failed fetch falls back to the tree and, with
// nothing to fall back to, is an error rather than a short file list. A
// subject a fetched schema references is fetched too, pinned by the reference
// itself, so following one adds no lottery.
//
// It runs in the host (portolan.0008) because it needs a socket and a
// credential. The credential comes from the environment and is never in the
// manifest; the registry URL is a fact about the estate and is.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import optionsSchema from "./fetch-csr.options.json" with { type: "json" };

export const LOCK_NAME = "csr.lock.json";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";
export const KEY_ENV = "CONFLUENT_SCHEMA_REGISTRY_API_KEY";
export const SECRET_ENV = "CONFLUENT_SCHEMA_REGISTRY_API_SECRET";
export const SHORT_KEY_ENV = "CSR_API_KEY";
export const SHORT_SECRET_ENV = "CSR_API_SECRET";
export const TOKEN_ENV = "CSR_TOKEN";

// The registry's own media type first and plain JSON second, so the same
// client works against Confluent's registry and the API-compatible ones.
const ACCEPT = "application/vnd.schemaregistry.v1+json, application/json";
const COMPATIBILITY_LEVELS = new Set([
  "NONE",
  "BACKWARD",
  "BACKWARD_TRANSITIVE",
  "FORWARD",
  "FORWARD_TRANSITIVE",
  "FULL",
  "FULL_TRANSITIVE",
]);

export function describe() {
  return {
    name: "fetch-csr",
    summary: "Fetches pinned subject versions from a Confluent Schema Registry into the tree, with a lock beside each, so a schema published to a registry can be read without talking to it.",
    category: "sources",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv, fetch?: typeof fetch}} [io]
 */
export async function run(request, { env = process.env, fetch: fetchFn = globalThis.fetch } = {}) {
  const options = request.options ?? {};
  const registry = String(options.registry ?? "").trim();
  if (!registry) throw new Error("no registry: name the schema registry's base URL in the manifest");
  const subjects = Array.isArray(options.subjects) ? options.subjects : [];
  if (subjects.length === 0) throw new Error("no subjects to fetch: name at least one in the manifest");
  if (!options.cache) {
    throw new Error("no cache directory: set `cache` to the same path as the step's `out`, so an offline run can replay what the last online one wrote");
  }

  const out = new Builder();
  const queue = [...subjects]
    .map((want) => ({
      subject: String(want.subject ?? ""),
      version: Number(want.version ?? 0) || 0,
      history: historyDepth(want.history),
    }))
    .sort((a, b) =>
      a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0,
    );
  const client = new Client(registry, authorization(env), fetchFn);
  const skip = offline(env);

  // Two subjects that slug to the same directory would overwrite each other,
  // and one subject wanted at two versions cannot be held in a tree that
  // keeps one version per subject. Both are refused by name.
  const claimed = new Map();
  const done = new Set();

  while (queue.length) {
    const want = queue.shift();
    if (!want.subject) throw new Error("a subject entry names no subject");
    if (claimed.has(want.subject)) {
      const held = claimed.get(want.subject);
      if (held.version !== want.version) {
        throw new Error(`${want.subject} is wanted at version ${pinOf(held.version)} and at version ${pinOf(want.version)}; the tree keeps one version per subject, so pin one`);
      }
      if (held.history !== want.history) {
        throw new Error(
          `${want.subject} is wanted with history depths ${held.history} and ${want.history}; keep one request for the subject`,
        );
      }
      continue;
    }
    const dir = slugOf(want.subject);
    if (done.has(dir)) throw new Error(`${want.subject} and another subject both vendor into ${dir}; the tree cannot hold both`);
    claimed.set(want.subject, want);
    done.add(dir);
    const at = join(options.cache, dir);

    let references;
    if (skip) {
      references = emitCached(out, registry, dir, at, want, "offline");
    } else {
      try {
        references = await live(client, out, registry, dir, want);
      } catch (cause) {
        try {
          references = emitCached(out, registry, dir, at, want, cause.message);
        } catch (cacheCause) {
          throw new Error(`${want.subject} could not be fetched (${cause.message}) and there is no usable copy in the tree (${cacheCause.message})`);
        }
      }
    }

    // A referenced subject is pinned by the schema that references it, so
    // following one needs no permission from the manifest.
    const following = references
      .filter((ref) => ref.subject && !claimed.has(ref.subject))
      .map((ref) => ({
        subject: ref.subject,
        version: Number(ref.version) || 0,
        history: 1,
      }))
      .sort((a, b) =>
        a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0,
      );
    queue.push(...following);
  }

  return out.response();
}

export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

/** The Authorization value, or "" for an anonymous registry. */
export function authorization(env = process.env) {
  const read = (name) => String(env[name] ?? "").trim();
  const raw = read(TOKEN_ENV);
  if (raw) {
    // Passed through when it already names its scheme, so the same variable
    // serves "Bearer ..." and an opaque token a proxy expects bare.
    return raw.includes(" ") ? raw : `Bearer ${raw}`;
  }
  const key = read(KEY_ENV) || read(SHORT_KEY_ENV);
  const secret = read(SECRET_ENV) || read(SHORT_SECRET_ENV);
  if (!key || !secret) return "";
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

/**
 * The directory a subject vendors into. A subject name is whatever the
 * producer registered; everything outside a safe set becomes an underscore,
 * and the true subject is written in the lock beside the file.
 */
export function slugOf(subject) {
  const slug = [...String(subject)].map((char) => (/[A-Za-z0-9._-]/.test(char) ? char : "_")).join("").replace(/^\.+|\.+$/g, "");
  return slug || "_";
}

/** The empty answer is AVRO by the registry's own rule. */
export function schemaType(declared) {
  const clean = String(declared ?? "").trim();
  return clean ? clean.toUpperCase() : "AVRO";
}

export function extensionFor(kind) {
  switch (schemaType(kind)) {
    case "AVRO": return ".avsc";
    case "PROTOBUF": return ".proto";
    case "JSON": return ".json";
    default: throw new Error(`unknown schema type "${kind}"`);
  }
}

/**
 * The schema as it should be written. AVRO and JSON arrive minified onto one
 * line; they are indented without reordering or rewriting a single token, so
 * the file still says what the registry said. PROTOBUF is left as it is.
 */
export function body(kind, schema) {
  if (schemaType(kind) === "PROTOBUF") return withNewline(schema);
  try {
    JSON.parse(schema);
  } catch {
    // A registry that answered with something that is not JSON has told us
    // something, and the honest thing is to keep it so the reader can see.
    return withNewline(schema);
  }
  return withNewline(indentJson(schema));
}

/** json.Indent: re-spaced, never re-parsed - every token stays as it came. */
export function indentJson(text) {
  let out = "";
  let depth = 0;
  let index = 0;
  const skipSpace = () => { while (index < text.length && /\s/.test(text[index])) index += 1; };
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "{" || char === "[") {
      const closer = char === "{" ? "}" : "]";
      index += 1;
      skipSpace();
      if (text[index] === closer) { out += char + closer; index += 1; continue; }
      depth += 1;
      out += `${char}\n${"  ".repeat(depth)}`;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      out += `\n${"  ".repeat(depth)}${char}`;
      index += 1;
      continue;
    }
    if (char === ",") { out += `,\n${"  ".repeat(depth)}`; index += 1; continue; }
    if (char === ":") { out += ": "; index += 1; continue; }
    let end = index;
    while (end < text.length && !/[\s,\]}:]/.test(text[end])) end += 1;
    out += text.slice(index, end);
    index = end;
  }
  return out;
}

function withNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** The lock, one subject per directory, references sorted by name. */
export function encodeLock(registry, entry) {
  const record = { subject: entry.subject, version: entry.version, id: entry.id };
  if (entry.guid) record.guid = entry.guid;
  record.schemaType = entry.schemaType;
  if (entry.compatibility) record.compatibility = entry.compatibility;
  if (entry.historyDepth > 1) record.historyDepth = entry.historyDepth;
  if (entry.references?.length) {
    record.references = [...entry.references]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((ref) => ({ name: ref.name, subject: ref.subject, version: ref.version }));
  }
  if (entry.history?.length) {
    record.history = [...entry.history]
      .sort((a, b) => a.version - b.version)
      .map((version) => {
        const held = { version: version.version, id: version.id };
        if (version.guid) held.guid = version.guid;
        held.schemaType = version.schemaType;
        if (version.references?.length) {
          held.references = [...version.references]
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .map((ref) => ({
              name: ref.name,
              subject: ref.subject,
              version: ref.version,
            }));
        }
        held.files = [...version.files]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map((file) => ({
            path: file.path,
            sha256: file.sha256,
            size: file.size,
          }));
        return held;
      });
  }
  record.files = [...entry.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }));
  return `${JSON.stringify({ registry, subjects: [record] }, null, 2)}\n`;
}

function digestOf(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function pinOf(version) {
  return version === 0 ? "latest" : String(version);
}

function historyDepth(value) {
  const depth = value == null ? 1 : Number(value);
  if (!Number.isInteger(depth) || depth < 1 || depth > 50) {
    throw new Error("schema history must be an integer between 1 and 50");
  }
  return depth;
}

function schemaFile(got) {
  let extension;
  try {
    extension = extensionFor(got.schemaType);
  } catch (cause) {
    throw new Error(`version ${got.version}: ${cause.message}`);
  }
  const name = `v${got.version}${extension}`;
  const contents = body(got.schemaType, got.schema);
  return {
    name,
    contents,
    registration: {
      version: got.version,
      id: got.id ?? 0,
      guid: got.guid ?? "",
      schemaType: schemaType(got.schemaType),
      references: got.references ?? [],
      files: [
        {
          path: name,
          sha256: digestOf(contents),
          size: Buffer.byteLength(contents),
        },
      ],
    },
  };
}

async function live(client, out, registry, dir, want) {
  const got = await client.version(want.subject, want.version);
  if (want.version === 0) {
    out.warn(want.subject, `is not pinned; "latest" resolved to version ${got.version}. Pin it in portolan.json or every run is a lottery.`);
  }
  const current = schemaFile(got);
  const history = [];
  if (want.history > 1) {
    const available = await client.versions(want.subject);
    if (!available.includes(got.version)) {
      throw new Error(
        `${want.subject}: version ${got.version} disappeared while its history was being read`,
      );
    }
    const previous = available
      .filter((version) => version < got.version)
      .slice(-(want.history - 1));
    for (const version of previous) {
      const historical = schemaFile(
        await client.version(want.subject, version),
      );
      history.push(historical.registration);
      out.file(posix.join(dir, historical.name), historical.contents);
    }
  }
  let compatibility = "";
  try {
    compatibility = await client.compatibility(want.subject);
  } catch (cause) {
    // A schema registration is still useful when an API-compatible registry
    // does not expose Confluent's configuration resource. Keep the schema and
    // say which governance fact could not be read instead of failing the fetch.
    out.warn(
      want.subject,
      `its effective compatibility could not be read (${cause.message})`,
    );
  }
  const entry = {
    subject: want.subject,
    ...current.registration,
    compatibility,
    historyDepth: want.history,
    history,
  };
  out.file(posix.join(dir, current.name), current.contents);
  out.file(posix.join(dir, LOCK_NAME), encodeLock(registry, entry));
  return entry.references;
}

function emitCached(out, registry, dir, at, want, why) {
  if (want.version === 0) throw new Error(`${want.subject} is not pinned to a version, so there is nothing to replay`);
  const held = replay(at);
  if (held.lock.version !== want.version)
    throw new Error(
      `${want.subject} holds version ${held.lock.version} but the manifest pins ${want.version}; fetch it`,
    );
  if (held.lock.subject !== want.subject)
    throw new Error(
      `${want.subject} vendors into ${at.split("\\").join("/")}, which holds ${held.lock.subject}`,
    );
  if (held.registry && held.registry !== registry)
    throw new Error(
      `${want.subject} was fetched from ${held.registry} but the manifest names ${registry}; fetch it again`,
    );
  if (want.history > held.lock.historyDepth)
    throw new Error(
      `${want.subject} keeps history depth ${held.lock.historyDepth} but the manifest asks for ${want.history}; fetch it`,
    );
  for (const version of [...(held.lock.history ?? []), held.lock]) {
    for (const file of version.files)
      out.file(
        posix.join(dir, file.path),
        held.files.get(file.path).toString("utf8"),
      );
  }
  out.file(posix.join(dir, LOCK_NAME), encodeLock(registry, held.lock));
  out.warn(want.subject, `not fetched (${why}); the copy committed in this repository is used unchanged`);
  return held.lock.references ?? [];
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
  const subjects = Array.isArray(lock.subjects) ? lock.subjects : [];
  if (subjects.length !== 1) throw new Error(`${lockPath} names ${subjects.length} subjects; expected exactly one`);
  const entry = subjects[0];
  const files = new Map();
  const versions = [...(entry.history ?? []), entry];
  for (const version of versions)
    for (const want of version.files ?? []) {
      let contents;
      try {
        contents = readFileSync(join(dir, ...String(want.path).split("/")));
      } catch (cause) {
        if (cause.code === "ENOENT")
          throw new Error(`${want.path} is in the lock but not on disk`);
        throw cause;
      }
      if (digestOf(contents) !== want.sha256)
        throw new Error(
          `${want.path} does not match its digest; the vendored copy was edited by hand`,
        );
      files.set(want.path, contents);
    }
  return {
    registry: String(lock.registry ?? ""),
    lock: {
      subject: entry.subject,
      version: Number(entry.version) || 0,
      id: entry.id ?? 0,
      guid: entry.guid ?? "",
      schemaType: entry.schemaType ?? "",
      compatibility: entry.compatibility ?? "",
      references: entry.references ?? [],
      historyDepth: Number(entry.historyDepth) || 1,
      history: Array.isArray(entry.history) ? entry.history : [],
      files: entry.files ?? [],
    },
    files,
  };
}

/** The registry's REST API, and only the one call this plugin makes. */
class Client {
  constructor(base, auth, fetchFn) {
    this.base = base.replace(/\/+$/, "");
    this.auth = auth;
    this.fetch = fetchFn;
  }

  /** One registration. A zero version asks for `latest`. */
  async version(subject, version) {
    const which = version > 0 ? String(version) : "latest";
    const at = `${this.base}/subjects/${encodeURIComponent(subject)}/versions/${which}`;
    let got;
    try {
      got = await this.get(at);
    } catch (cause) {
      throw new Error(`${subject} at version ${which}: ${cause.message}`);
    }
    if (!String(got.schema ?? "").trim()) throw new Error(`${subject} at version ${which}: the registry answered with no schema`);
    if (!(Number(got.version) > 0)) throw new Error(`${subject} at version ${which}: the registry did not say which version it answered with`);
    return { ...got, version: Number(got.version) };
  }

  /** Registered, non-deleted versions, in ascending order. */
  async versions(subject) {
    const at = `${this.base}/subjects/${encodeURIComponent(subject)}/versions`;
    let got;
    try {
      got = await this.get(at);
    } catch (cause) {
      throw new Error(
        `${subject}: its versions could not be listed: ${cause.message}`,
      );
    }
    if (
      !Array.isArray(got) ||
      got.some(
        (version) => !Number.isInteger(Number(version)) || Number(version) < 1,
      )
    ) {
      throw new Error(
        `${subject}: the registry answered with an invalid version list`,
      );
    }
    return [...new Set(got.map(Number))].sort((a, b) => a - b);
  }

  /** The subject's effective compatibility, including an inherited global value. */
  async compatibility(subject) {
    const at = `${this.base}/config/${encodeURIComponent(subject)}?defaultToGlobal=true`;
    let got;
    try {
      got = await this.get(at);
    } catch (cause) {
      throw new Error(`${subject}: ${cause.message}`);
    }
    const level = String(got.compatibilityLevel ?? got.compatibility ?? "")
      .trim()
      .toUpperCase();
    if (!level)
      throw new Error(
        `${subject}: the registry did not say which compatibility level applies`,
      );
    if (!COMPATIBILITY_LEVELS.has(level))
      throw new Error(
        `${subject}: the registry answered with unknown compatibility level ${JSON.stringify(level)}`,
      );
    return level;
  }

  async get(at) {
    const headers = { Accept: ACCEPT };
    if (this.auth) headers.Authorization = this.auth;
    let response;
    try {
      response = await this.fetch(at, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (cause) {
      throw new Error(cause.cause?.message ?? cause.message);
    }
    const raw = await response.text();
    if (!response.ok) {
      try {
        const fault = JSON.parse(raw);
        if (fault?.message) throw new Error(`the registry answered ${response.status} ${response.statusText}: ${fault.message} (error_code ${fault.error_code ?? 0})`);
      } catch (cause) {
        if (cause.message.startsWith("the registry answered")) throw cause;
      }
      throw new Error(`the registry answered ${response.status} ${response.statusText}`);
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new Error(`the registry's answer is not the shape this plugin reads: ${cause.message}`);
    }
  }
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
