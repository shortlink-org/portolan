// The part of reading Kubernetes objects that does not care where they came
// from: which names a workload answers on, and which in-cluster names it is
// configured to dial. fetch-k8s hands it what `kubectl get -o json` said;
// the same rules, in Go, read the manifests in a repository (extract-k8s),
// and the two are held together by the same table of cases in their tests.
//
// Nothing here writes a value. A value is looked at once, for one question -
// does it name a host inside the cluster - and the host alone survives.

export const WORKLOAD_KINDS = {
  Deployment: "",
  StatefulSet: "",
  DaemonSet: "",
  ReplicaSet: "",
  Job: "job",
  CronJob: "job",
};

/** Every DNS form the cluster answers for one Service. */
export function hostForms(name, namespace) {
  const ns = namespace || "default";
  return [name, `${name}.${ns}`, `${name}.${ns}.svc`, `${name}.${ns}.svc.cluster.local`];
}

const BARE_HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$/;
// A name only a cluster's DNS answers for, which is what lets a name from
// another namespace's Service through: nothing else looks like `pricing.shop.svc`.
const SVC_FORM = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z0-9]([a-z0-9-]*[a-z0-9])?\.svc(\.cluster\.local)?$/;

/**
 * The in-cluster host a configured value names, or undefined. A URL gives up
 * its hostname and keeps nothing else - not the scheme, port, path, query,
 * nor the user and password in front of the host. A bare `host[:port]`
 * gives up the port. What is left qualifies when the tree's own Services
 * answer to it, or when it has the `<name>.<namespace>.svc` shape. A
 * password, a token, a level, a flag: none is a host, and none passes.
 *
 * @param {string} value
 * @param {Set<string>} known
 */
export function hostOnly(value, known) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return undefined;
  let host;
  if (trimmed.includes("://")) {
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  } else {
    const lower = trimmed.toLowerCase();
    if (!BARE_HOST.test(lower)) return undefined;
    host = lower.replace(/:[0-9]+$/, "");
  }
  if (!host) return undefined;
  return known.has(host) || SVC_FORM.test(host) ? host : undefined;
}

/** Whether a Service's selector matches a pod's labels: every key, with its value. */
export function selects(selector, podLabels) {
  const keys = Object.keys(selector ?? {});
  if (keys.length === 0) return false;
  return keys.every((key) => (podLabels ?? {})[key] === selector[key]);
}

export function podTemplate(object) {
  const spec = object.spec ?? {};
  if (object.kind === "CronJob") return spec.jobTemplate?.spec?.template ?? {};
  return spec.template ?? {};
}

/**
 * Every configured value of one container this reader may look at: a literal
 * `value`, a `configMapKeyRef` followed into the ConfigMaps read, and what an
 * `envFrom.configMapRef` brings in. A `secretKeyRef` or `secretRef` is not
 * followed, by rule.
 */
export function containerValues(container, namespace, configMaps) {
  const out = [];
  for (const env of container.env ?? []) {
    if (typeof env.value === "string" && env.value.trim()) {
      out.push(env.value);
      continue;
    }
    const ref = env.valueFrom?.configMapKeyRef;
    if (!ref) continue;
    const data = configMaps.get(`${namespace}/${ref.name ?? ""}`);
    if (data && Object.hasOwn(data, ref.key ?? "")) out.push(String(data[ref.key]));
  }
  for (const from of container.envFrom ?? []) {
    const ref = from.configMapRef;
    if (!ref) continue;
    const data = configMaps.get(`${namespace}/${ref.name ?? ""}`) ?? {};
    for (const key of Object.keys(data).sort()) out.push(String(data[key]));
  }
  return out;
}

/** The hosts an Ingress or a Gateway API route answers on for the named Services. */
export function frontingHosts(objects, backends) {
  const out = [];
  for (const object of objects) {
    const spec = object.spec ?? {};
    if (object.kind === "Ingress") {
      const rules = Array.isArray(spec.rules) ? spec.rules : [];
      if (backends.has(spec.defaultBackend?.service?.name ?? "")) {
        for (const rule of rules) if (rule.host) out.push(rule.host);
      }
      for (const rule of rules) {
        if (!rule.host) continue;
        const paths = Array.isArray(rule.http?.paths) ? rule.http.paths : [];
        if (paths.some((path) => backends.has(path.backend?.service?.name ?? ""))) out.push(rule.host);
      }
    } else if (["HTTPRoute", "GRPCRoute", "TLSRoute"].includes(object.kind)) {
      const hostnames = Array.isArray(spec.hostnames) ? spec.hostnames : [];
      if (hostnames.length === 0) continue;
      const rules = Array.isArray(spec.rules) ? spec.rules : [];
      if (rules.some((rule) => (rule.backendRefs ?? []).some((ref) => backends.has(ref.name ?? "")))) out.push(...hostnames);
    }
  }
  return out;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * Every workload among the objects, with the names it answers on and the
 * names it dials. Objects are what the API returned: `kind`, `metadata`,
 * `spec`, and for a ConfigMap `data`. A Secret is never among them, because
 * it is never asked for.
 *
 * @returns {{object: object, kind: string, hosts: string[], dials: string[]}[]}
 */
export function topology(objects) {
  const configMaps = new Map();
  const services = [];
  const known = new Set();
  for (const object of objects) {
    const ns = object.metadata?.namespace ?? "";
    const name = object.metadata?.name ?? "";
    if (!name) continue;
    if (object.kind === "ConfigMap") {
      const data = configMaps.get(`${ns}/${name}`) ?? {};
      for (const [key, value] of Object.entries(object.data ?? {})) data[key] = value;
      configMaps.set(`${ns}/${name}`, data);
    } else if (object.kind === "Service") {
      services.push({ name, namespace: ns, selector: object.spec?.selector ?? {} });
      for (const form of hostForms(name, ns)) known.add(form);
    }
  }

  const out = [];
  for (const object of objects) {
    if (!Object.hasOwn(WORKLOAD_KINDS, object.kind ?? "")) continue;
    const ns = object.metadata?.namespace ?? "";
    if (!object.metadata?.name) continue;
    const template = podTemplate(object);
    const podLabels = template.metadata?.labels ?? {};
    const backends = new Set();
    const hosts = [];
    for (const service of services) {
      if (service.namespace === ns && selects(service.selector, podLabels)) {
        hosts.push(...hostForms(service.name, service.namespace));
        backends.add(service.name);
      }
    }
    hosts.push(...frontingHosts(objects.filter((o) => (o.metadata?.namespace ?? "") === ns), backends));
    const own = new Set(hosts);
    const dials = [];
    const spec = template.spec ?? {};
    for (const container of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
      for (const value of containerValues(container, ns, configMaps)) {
        const host = hostOnly(value, known);
        if (host && !own.has(host)) dials.push(host);
      }
    }
    out.push({ object, kind: WORKLOAD_KINDS[object.kind], hosts: sortedUnique(hosts), dials: sortedUnique(dials) });
  }
  return out;
}
