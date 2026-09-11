// fetch-k8s, run by the host: a live cluster on one side, a catalog fragment
// on the other. It asks `kubectl` for the workloads, Services, Ingresses,
// routes and ConfigMaps of the namespaces named, and answers with the names
// each service answers on and the in-cluster names it dials - the same two
// lists extract-k8s reads out of the manifests in a repository, from the
// cluster that actually runs them.
//
// It runs in the host (portolan.0008) because it needs a binary, a socket
// and a credential. The credential is kubectl's own, from the kubeconfig,
// and never in the manifest.
//
// Nothing the cluster says is written down but names. The objects live in
// this process for the length of one call; a Secret is never asked for; a
// value from env or a ConfigMap is reduced to a host or to nothing; and a
// warning names a namespace or a kind, never a value. What kubectl printed
// on stderr goes to the terminal and not into the build report.
//
// Offline, or when the cluster cannot be reached, the fragment committed in
// the repository is used unchanged - the same rule as fetch-git, for the
// same reason: a run that lost the cluster must not lose the catalog.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import optionsSchema from "./fetch-k8s.options.json" with { type: "json" };
import { topology } from "./k8s-topology.mjs";

export const OFFLINE_ENV = "PORTOLAN_OFFLINE";
export const DEFAULT_OUT = "k8s-cluster.json";
export const DEFAULT_LABELS = Object.freeze({
  context: "app.kubernetes.io/part-of",
  service: "app.kubernetes.io/name",
});

// What is asked for, and the whole of it. Secrets are not a kind this list
// could grow to hold: the reader has no use for one.
const KINDS = ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "services", "ingresses", "configmaps"];
const ROUTE_KINDS = ["httproutes.gateway.networking.k8s.io", "grpcroutes.gateway.networking.k8s.io"];

export function describe() {
  return {
    name: "fetch-k8s",
    summary: "Reads the workloads, Services, Ingresses and routes of a live cluster through kubectl into the names each service answers on and dials; values and secrets are never kept.",
    category: "infrastructure",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv, exec?: (args: string[]) => string, stderr?: (text: string) => void}} [io]
 */
export function run(request, { env = process.env, exec = kubectl, stderr = (text) => process.stderr.write(text) } = {}) {
  const options = request.options ?? {};
  if (!options.cache) {
    throw new Error("no cache directory: set `cache` to the same path as the step's `out`, so an offline run can replay what the last online one wrote");
  }
  const out = String(options.out ?? "").trim() || DEFAULT_OUT;
  const at = join(options.cache, out);
  const builder = new Builder();

  if (offline(env)) {
    emitCached(builder, at, out, "offline");
    return builder.response();
  }

  let objects;
  try {
    objects = read(exec, options, builder, stderr);
  } catch (cause) {
    try {
      emitCached(builder, at, out, cause.message);
    } catch (cacheCause) {
      throw new Error(`the cluster could not be read (${cause.message}) and there is no usable fragment in the tree (${cacheCause.message})`);
    }
    return builder.response();
  }

  builder.file(out, fragment(objects, options, builder));
  return builder.response();
}

/** Whether to open a socket. Explicit, and CI verifies what was committed. */
export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

/** The label keys the manifest chose, over the conventional ones. */
export function labelsOf(options) {
  const declared = options.labels ?? {};
  return {
    context: String(declared.context ?? "").trim() || DEFAULT_LABELS.context,
    service: String(declared.service ?? "").trim() || DEFAULT_LABELS.service,
  };
}

function kubectl(args) {
  return execFileSync("kubectl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
}

/**
 * One `kubectl get` per namespace, or one across all of them. The kinds a
 * Gateway API cluster serves are asked for separately, because a cluster
 * without the CRDs refuses the whole request otherwise.
 */
function read(exec, options, builder, stderr) {
  const namespaces = Array.isArray(options.namespaces) ? options.namespaces.map((ns) => String(ns).trim()).filter(Boolean).sort() : [];
  const scopes = namespaces.length ? namespaces.map((ns) => ["-n", ns]) : [["-A"]];
  const base = String(options.kubeContext ?? "").trim() ? ["--context", String(options.kubeContext).trim()] : [];
  const objects = [];
  for (const scope of scopes) {
    objects.push(...items(call(exec, [...base, "get", KINDS.join(","), ...scope, "-o", "json"], stderr)));
  }
  let routesMissing = false;
  for (const scope of scopes) {
    for (const kind of ROUTE_KINDS) {
      try {
        objects.push(...items(call(exec, [...base, "get", kind, ...scope, "-o", "json"], stderr)));
      } catch {
        routesMissing = true;
      }
    }
  }
  if (routesMissing) builder.warn("", "the cluster serves no Gateway API routes, or refused to list them; hosts of HTTPRoute and GRPCRoute were not read");
  return objects;
}

/**
 * Runs one kubectl. What kubectl says on stderr reaches the terminal, not
 * the build report: a connection error names the server, and that is a
 * fact for the person at the keyboard and not for a committed file.
 */
function call(exec, args, stderr) {
  try {
    return exec(args);
  } catch (cause) {
    const said = String(cause.stderr ?? "").trim();
    if (said) stderr(`kubectl ${args.join(" ")}:\n${said}\n`);
    const status = Number.isInteger(cause.status) ? `exit ${cause.status}` : cause.code === "ENOENT" ? "kubectl is not on PATH" : "kubectl failed";
    throw new Error(`kubectl get ${args[args.indexOf("get") + 1] ?? ""}: ${status}`);
  }
}

function items(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`kubectl's answer is not JSON: ${cause.message}`);
  }
  const list = Array.isArray(parsed?.items) ? parsed.items : parsed?.kind && parsed?.metadata ? [parsed] : [];
  return list.filter((item) => item && typeof item === "object" && item.kind !== "Secret");
}

/**
 * The fragment: every workload the labels place into a context and a
 * service, folded by service. A workload the labels do not place and the
 * namespace map does not claim is counted in a warning, not guessed at.
 */
export function fragment(objects, options, builder) {
  const labels = labelsOf(options);
  const namespaceContexts = options.namespaceContexts ?? {};
  const services = new Map();
  const unmapped = new Map();

  for (const entry of topology(objects)) {
    const meta = entry.object.metadata ?? {};
    const ns = meta.namespace ?? "";
    const all = { ...(podTemplateLabels(entry.object)), ...(meta.labels ?? {}) };
    const context = String(all[labels.context] ?? "").trim() || String(namespaceContexts[ns] ?? "").trim();
    if (!context) {
      unmapped.set(ns, (unmapped.get(ns) ?? 0) + 1);
      continue;
    }
    const slug = String(all[labels.service] ?? "").trim() || String(meta.name ?? "");
    const id = `${context}.${slug}`;
    const service = services.get(id) ?? { id, context, slug, kinds: new Set(), hosts: new Set(), dials: new Set() };
    service.kinds.add(entry.kind);
    for (const host of entry.hosts) service.hosts.add(host);
    for (const dial of entry.dials) service.dials.add(dial);
    services.set(id, service);
  }

  for (const ns of [...unmapped.keys()].sort()) {
    builder.warn(ns || "cluster", `${unmapped.get(ns)} workload(s) carry no "${labels.context}" label and the namespace is not in namespaceContexts; they were left out`);
  }

  const contexts = new Map();
  for (const id of [...services.keys()].sort()) {
    const service = services.get(id);
    const context = contexts.get(service.context) ?? { id: service.context, slug: service.context, name: "", summary: "", services: [] };
    const record = {
      id: service.id,
      slug: service.slug,
      name: "",
      repo: "",
      path: "",
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
    };
    // A service that is only jobs is a job; one with a Deployment beside
    // its CronJob is whatever its code says it is.
    if (service.kinds.size === 1 && service.kinds.has("job")) record.kind = "job";
    const dials = [...service.dials].filter((dial) => !service.hosts.has(dial)).sort();
    if (service.hosts.size) record.hosts = [...service.hosts].sort();
    if (dials.length) record.dials = dials;
    context.services.push(record);
    contexts.set(service.context, context);
  }

  const catalog = {
    contexts: [...contexts.keys()].sort().map((id) => contexts.get(id)),
    defs: {},
    flows: [],
    adrs: [],
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function podTemplateLabels(object) {
  const spec = object.spec ?? {};
  const template = object.kind === "CronJob" ? spec.jobTemplate?.spec?.template : spec.template;
  return template?.metadata?.labels ?? {};
}

function emitCached(builder, at, out, why) {
  let raw;
  try {
    raw = readFileSync(at, "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") throw new Error(`no ${out} in ${at.split("\\").join("/").slice(0, -out.length - 1) || "."}`);
    throw cause;
  }
  try {
    JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${out} is not JSON: ${cause.message}`);
  }
  builder.file(out, raw);
  builder.warn("", `the cluster was not read (${why}); the fragment committed in this repository is used unchanged`);
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
