// fetch-argocd, run by the host: an Argo CD API on one side, a snapshot of
// where the estate's services run committed to this repository on the other.
//
// portolan.0011 reads the names a service answers on and dials, from the
// manifests and from the cluster, and nothing else; neither says which
// revision of which repository stands in which cluster and namespace, under
// which name. Only the thing that deploys knows that (portolan.0012). It is
// not in any tree, so it cannot be an extractor's, and it is read over a
// socket with a credential, so it is the host's (portolan.0008).
//
// The contract is the plugin's all the same: the snapshot is named, never
// written, so the host writes it, it gets a manifest entry, is compared by
// `gen:check` like any other generated file, and is removed when the step
// stops naming it. Two files land in the step's out. `argocd.apps.json` is
// a catalog fragment - the deployments, one per Application, nothing else.
// `argocd.lock.json` is for the next run of this step: the server, the
// applications and the fragment's digest, which is what lets an offline run
// replay the committed snapshot and refuse one edited by hand.
//
// There is no pin. An Application has no immutable commit the way a module
// or a repository has; the snapshot IS the fact, and it moves when a deploy
// moves it. So an online run after a deploy changes the committed snapshot,
// and that diff is the review worth having: what went where, in one pull
// request. What is kept is what a deploy changes - the revision, the images,
// the destination. What is not kept is what changes without one: health,
// sync state, the time of the last operation. A page that said "healthy"
// yesterday and was not regenerated since is a page that lies, and a build
// that reads a clock is not reproducible (portolan.0010).
//
// In CI, or with PORTOLAN_OFFLINE=1, the step replays the committed
// snapshot, checks it against its lock and emits an identical file list, so
// a fork's pull request needs no token and Argo CD being down cannot turn
// the tree red.
//
// No token in the manifest, ever: portolan.json is committed. The credential
// comes from ARGOCD_AUTH_TOKEN, the variable the argocd CLI reads, and it
// changes whether the fetch succeeds, never what the fetch says.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import optionsSchema from "./fetch-argocd.options.json" with { type: "json" };
import { webRepo } from "./fetch-git.mjs";

export const LOCK_NAME = "argocd.lock.json";
export const FRAGMENT_NAME = "argocd.apps.json";
export const TOKEN_ENV = "ARGOCD_AUTH_TOKEN";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";

/** The one call: every Application the token can list, narrowed by query. */
export const LIST_PATH = "/api/v1/applications";

/** The label that names an environment when the manifest does not say. */
export const DEFAULT_ENVIRONMENT_LABEL = "env";

/** How Argo CD names the cluster it runs in, and how the catalog does. */
const IN_CLUSTER_SERVER = "https://kubernetes.default.svc";
const IN_CLUSTER_NAME = "in-cluster";

export function describe() {
  return {
    name: "fetch-argocd",
    summary: "Reads the applications an Argo CD server manages into a snapshot of where each service runs - cluster, namespace, revision, images - with a lock beside it.",
    category: "sources",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * The step. Reads nothing out of the tree being described; its `cache` is
 * repo-relative and everything else is in the options.
 *
 * The rules are fetch-bsr's: a failed fetch falls back to the committed
 * snapshot with a warning, and a failed fetch with no snapshot is an ERROR,
 * never a short file list, because the host deletes files a step stops
 * naming.
 *
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv, fetch?: typeof fetch}} [io]
 */
export async function run(request, { env = process.env, fetch: fetchFn = globalThis.fetch } = {}) {
  const options = request.options ?? {};
  const server = String(options.server ?? "").trim();
  if (!server) throw new Error("no server: name the Argo CD API server in the manifest");
  if (!options.cache) {
    throw new Error("no cache directory: set `cache` to the same path as the step's `out`, so an offline run can replay what the last online one wrote");
  }

  const out = new Builder();
  if (offline(env)) {
    emitCached(out, options.cache, "offline");
    return out.response();
  }

  let deployments;
  try {
    deployments = await live(server, options, env, fetchFn);
  } catch (cause) {
    try {
      emitCached(out, options.cache, cause.message);
    } catch (cacheCause) {
      throw new Error(`${server} could not be read (${cause.message}) and there is no usable snapshot in the tree (${cacheCause.message})`);
    }
    return out.response();
  }
  emitFetched(out, server, deployments);
  return out.response();
}

export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

/** A credential, or "". The argocd CLI reads the same variable. */
export function token(env = process.env) {
  return String(env[TOKEN_ENV] ?? "").trim();
}

/** The server as a base URL: https unless the manifest says otherwise. */
export function baseUrl(server) {
  const value = String(server ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

/**
 * One Application, reduced to what a deploy changes.
 *
 * Everything the wire knows is looked at here and nowhere else. What comes
 * out is names and revisions: no parameter, no value, no status that moves
 * without a commit. A Helm parameter or a plugin env is a value and stays
 * behind for the reason portolan.0011 gives.
 *
 * @param {object} app an item of the list answer
 * @param {string} base the server's base URL, for the link
 * @param {string} environmentLabel
 */
export function deploymentOf(app, base, environmentLabel = DEFAULT_ENVIRONMENT_LABEL) {
  const metadata = app?.metadata ?? {};
  const spec = app?.spec ?? {};
  const status = app?.status ?? {};
  const name = String(metadata.name ?? "").trim();
  if (!name) throw new Error("an application has no name");
  const appNamespace = String(metadata.namespace ?? "argocd").trim() || "argocd";

  // A multi-source application deploys the source that carries a path (its
  // manifests) and reads values out of the others; the path is the one
  // whose revision a reader wants to follow.
  const sources = Array.isArray(spec.sources) && spec.sources.length ? spec.sources : spec.source ? [spec.source] : [];
  const sourceIndex = Math.max(0, sources.findIndex((source) => String(source?.path ?? "").trim()));
  const source = sources[sourceIndex] ?? {};
  const revisions = Array.isArray(status.sync?.revisions) ? status.sync.revisions : [];
  const revision = String(revisions[sourceIndex] ?? status.sync?.revision ?? "").trim();

  const destination = spec.destination ?? {};
  const server = String(destination.server ?? "").trim();
  const cluster = String(destination.name ?? "").trim() || (server === IN_CLUSTER_SERVER ? IN_CLUSTER_NAME : server);
  const labels = metadata.labels ?? {};
  const environment = String(labels[environmentLabel] ?? "").trim() || cluster;

  const record = {
    id: `${appNamespace}/${name}`,
    name,
    project: String(spec.project ?? "default").trim() || "default",
    environment,
    cluster,
    namespace: String(destination.namespace ?? "").trim(),
    repo: webRepo(source.repoURL ?? ""),
    path: String(source.path ?? "").trim().replace(/^\.?\/+|\/+$/g, ""),
    targetRevision: String(source.targetRevision ?? "").trim(),
    revision,
    tool: toolOf(status.sourceType ?? status.sourceTypes?.[sourceIndex], ...sources),
    url: `${base}/applications/${encodeURIComponent(appNamespace)}/${encodeURIComponent(name)}`,
  };
  const chart = String(source.chart ?? "").trim();
  if (chart) record.chart = chart;
  const images = [...new Set((status.summary?.images ?? []).map((image) => String(image).trim()).filter(Boolean))].sort();
  if (images.length) record.images = images;
  return record;
}

/**
 * `Helm`, `Kustomize`, `Directory`, `Plugin` as Argo CD says it, lowercased;
 * inferred from the sources when the status has not said yet. A multi-source
 * application says it on the chart, not on the values it reads beside it.
 */
export function toolOf(sourceType, ...sources) {
  const said = String(sourceType ?? "").trim().toLowerCase();
  if (said) return said;
  for (const source of sources) {
    if (source?.chart || source?.helm) return "helm";
    if (source?.kustomize) return "kustomize";
    if (source?.plugin) return "plugin";
    if (source?.directory) return "directory";
  }
  return "";
}

/** The fragment: a catalog holding deployments and nothing else. */
export function fragment(deployments) {
  const sorted = [...deployments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `${JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [], deployments: sorted }, null, 2)}\n`;
}

/** The lock, written the way every generated file here is written. */
export function encodeLock(entry) {
  return `${JSON.stringify({ server: entry.server, applications: [...entry.applications].sort(), sha256: entry.sha256 }, null, 2)}\n`;
}

function digestOf(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function live(server, options, env, fetchFn) {
  const base = baseUrl(server);
  const query = new URLSearchParams();
  for (const project of Array.isArray(options.projects) ? options.projects : []) query.append("projects", String(project));
  if (options.selector) query.set("selector", String(options.selector));
  const url = `${base}${LIST_PATH}${query.size ? `?${query}` : ""}`;

  const headers = { Accept: "application/json" };
  const credential = token(env);
  if (credential) headers.Authorization = `Bearer ${credential}`;
  let response;
  try {
    // A timeout rather than none: a step that hangs holds up the whole run.
    response = await fetchFn(url, { method: "GET", headers, signal: AbortSignal.timeout(60_000) });
  } catch (cause) {
    throw new Error(`${LIST_PATH}: ${cause.cause?.message ?? cause.message}`);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(`${LIST_PATH}: ${apiError(response.status, raw)}`);
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch {
    throw new Error(`${LIST_PATH}: the answer is not JSON`);
  }
  const items = Array.isArray(answer?.items) ? answer.items : [];
  if (items.length === 0) throw new Error(`${server} lists no applications; check the projects and selector in the manifest, and what the token may see`);
  const label = String(options.environmentLabel ?? "").trim() || DEFAULT_ENVIRONMENT_LABEL;
  return items.map((item) => deploymentOf(item, base, label));
}

/** The error body Argo CD sends, or the status when the body is not one. */
function apiError(status, raw) {
  try {
    const wire = JSON.parse(raw);
    if (wire?.message) return wire.message;
    if (wire?.error) return wire.error;
  } catch {
    // Not an error body.
  }
  return `http ${status}`;
}

function emitFetched(out, server, deployments) {
  const contents = fragment(deployments);
  out.file(FRAGMENT_NAME, contents);
  out.file(LOCK_NAME, encodeLock({ server, applications: deployments.map((d) => d.id), sha256: digestOf(contents) }));
}

function emitCached(out, cache, why) {
  const held = replay(cache);
  out.file(FRAGMENT_NAME, held.contents);
  out.file(LOCK_NAME, encodeLock(held.lock));
  out.warn(held.lock.server, `not fetched (${why}); the snapshot committed in this repository is used unchanged`);
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
  let contents;
  try {
    contents = readFileSync(join(dir, FRAGMENT_NAME), "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") throw new Error(`${FRAGMENT_NAME} is in the lock but not on disk`);
    throw cause;
  }
  if (digestOf(contents) !== lock.sha256) throw new Error(`${FRAGMENT_NAME} does not match its digest; the snapshot was edited by hand`);
  return {
    lock: { server: String(lock.server ?? ""), applications: Array.isArray(lock.applications) ? lock.applications : [], sha256: String(lock.sha256 ?? "") },
    contents,
  };
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
