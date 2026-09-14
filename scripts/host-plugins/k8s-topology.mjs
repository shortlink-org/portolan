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

const GATEWAY_API_GROUP = "gateway.networking.k8s.io";
const ROUTE_PROTOCOLS = {
  HTTPRoute: new Set(["HTTP", "HTTPS"]),
  GRPCRoute: new Set(["HTTP", "HTTPS"]),
  TLSRoute: new Set(["TLS"]),
};

const objectNamespace = (namespace) => String(namespace ?? "").trim() || "default";
const namespacedName = (namespace, name) => `${objectNamespace(namespace)}/${name ?? ""}`;

/** The concrete hosts an Ingress or an attached Gateway API Route answers on. */
export function frontingHosts(objects, backends) {
  const out = [];
  for (const object of objects) {
    const spec = object.spec ?? {};
    if (object.kind === "Ingress") {
      const backend = (name) => backends.has(namespacedName(object.metadata?.namespace, name));
      const rules = Array.isArray(spec.rules) ? spec.rules : [];
      if (backend(spec.defaultBackend?.service?.name ?? "")) {
        for (const rule of rules) if (rule.host) out.push(rule.host);
      }
      for (const rule of rules) {
        if (!rule.host) continue;
        const paths = Array.isArray(rule.http?.paths) ? rule.http.paths : [];
        if (paths.some((path) => backend(path.backend?.service?.name ?? ""))) out.push(rule.host);
      }
    }
  }
  out.push(...gatewayHosts(objects, backends));
  return sortedUnique(out);
}

/** Resolve Route -> Gateway listener -> Service before accepting a hostname. */
export function gatewayHosts(objects, backends) {
  return sortedUnique(gatewayExposures(objects, backends).flatMap((exposure) => exposure.hostnames));
}

/** Keep the Route, listener and backend evidence behind each accepted host. */
export function gatewayExposures(objects, backends, basis = "api") {
  const gateways = new Map();
  const namespaces = namespaceLabelIndex(objects);
  for (const object of objects) {
    if (object.kind === "Gateway" && String(object.apiVersion ?? "").startsWith(`${GATEWAY_API_GROUP}/`)) {
      gateways.set(namespacedName(object.metadata?.namespace, object.metadata?.name), object);
    }
  }

  const byID = new Map();
  for (const route of objects) {
    if (!ROUTE_PROTOCOLS[route.kind] || !String(route.apiVersion ?? "").startsWith(`${GATEWAY_API_GROUP}/`)) continue;
    const spec = route.spec ?? {};
    const targets = routeBackends(route, spec, objects, backends);
    if (targets.length === 0) continue;
    for (const parent of spec.parentRefs ?? []) {
      const group = String(parent.group ?? "").trim() || GATEWAY_API_GROUP;
      const kind = String(parent.kind ?? "").trim() || "Gateway";
      if (group !== GATEWAY_API_GROUP || kind !== "Gateway") continue;
      const parentNamespace = String(parent.namespace ?? "").trim() || objectNamespace(route.metadata?.namespace);
      const gateway = gateways.get(namespacedName(parentNamespace, parent.name));
      if (!gateway) continue;
      for (const listener of gateway.spec?.listeners ?? []) {
        if (!listenerAcceptsRoute(listener, gateway, route, parent, namespaces)) continue;
        const listenerName = String(listener.name ?? "").trim();
        for (const target of targets) {
          const [backendNamespace, backendName] = target.split("/", 2);
          const id = `${route.kind}/${namespacedName(route.metadata?.namespace, route.metadata?.name)}->Gateway/${namespacedName(gateway.metadata?.namespace, gateway.metadata?.name)}#${listenerName}->Service/${target}`;
          byID.set(id, {
            id,
            hostnames: intersectHostnames(listener.hostname, spec.hostnames),
            routeKind: route.kind,
            routeNamespace: objectNamespace(route.metadata?.namespace),
            routeName: String(route.metadata?.name ?? ""),
            gatewayNamespace: objectNamespace(gateway.metadata?.namespace),
            gatewayName: String(gateway.metadata?.name ?? ""),
            listener: listenerName,
            protocol: String(listener.protocol ?? "").toUpperCase(),
            port: Number(listener.port ?? 0),
            backendNamespace,
            backendName,
            basis,
            ...(route.source ? { source: String(route.source) } : {}),
          });
        }
      }
    }
  }
  return [...byID.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function routeBackends(route, spec, objects, backends) {
  const targets = new Set();
  for (const rule of spec.rules ?? []) {
    for (const ref of rule.backendRefs ?? []) {
      const group = String(ref.group ?? "").trim();
      const kind = String(ref.kind ?? "").trim();
      if (group || (kind && kind !== "Service")) continue;
      const namespace = String(ref.namespace ?? "").trim() || objectNamespace(route.metadata?.namespace);
      const name = String(ref.name ?? "").trim();
      if (!backends.has(namespacedName(namespace, name))) continue;
      if (namespace === objectNamespace(route.metadata?.namespace) || referenceGranted(objects, route, namespace, name)) {
        targets.add(namespacedName(namespace, name));
      }
    }
  }
  return [...targets].sort();
}

function referenceGranted(objects, route, targetNamespace, targetName) {
  return objects.some((grant) => {
    if (grant.kind !== "ReferenceGrant"
      || objectNamespace(grant.metadata?.namespace) !== targetNamespace
      || !String(grant.apiVersion ?? "").startsWith(`${GATEWAY_API_GROUP}/`)) return false;
    const fromMatches = (grant.spec?.from ?? []).some((from) => from.group === GATEWAY_API_GROUP
      && from.kind === route.kind
      && from.namespace === objectNamespace(route.metadata?.namespace));
    if (!fromMatches) return false;
    return (grant.spec?.to ?? []).some((to) => String(to.group ?? "").trim() === ""
      && to.kind === "Service"
      && (!to.name || to.name === targetName));
  });
}

function listenerAcceptsRoute(listener, gateway, route, parent, namespaces) {
  if (parent.sectionName && parent.sectionName !== listener.name) return false;
  if (parent.port !== undefined && String(parent.port) !== String(listener.port)) return false;
  if (!ROUTE_PROTOCOLS[route.kind].has(String(listener.protocol ?? "").toUpperCase())) return false;

  const allowed = listener.allowedRoutes ?? {};
  if (Array.isArray(allowed.kinds) && allowed.kinds.length > 0) {
    const kindMatches = allowed.kinds.some((candidate) => (String(candidate.group ?? "").trim() || GATEWAY_API_GROUP) === GATEWAY_API_GROUP
      && candidate.kind === route.kind);
    if (!kindMatches) return false;
  }

  const from = String(allowed.namespaces?.from ?? "").trim() || "Same";
  if (from === "All") return true;
  if (from === "Same") return objectNamespace(gateway.metadata?.namespace) === objectNamespace(route.metadata?.namespace);
  if (from === "Selector") {
    const labels = namespaces.get(objectNamespace(route.metadata?.namespace));
    return Boolean(labels) && labelSelectorMatches(labels, allowed.namespaces?.selector ?? {});
  }
  return false;
}

function namespaceLabelIndex(objects) {
  const out = new Map();
  for (const object of objects) {
    if (object.kind !== "Namespace" || !object.metadata?.name) continue;
    out.set(object.metadata.name, { "kubernetes.io/metadata.name": object.metadata.name, ...(object.metadata.labels ?? {}) });
  }
  return out;
}

function labelSelectorMatches(labels, selector) {
  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[key] !== value) return false;
  }
  for (const expression of selector.matchExpressions ?? []) {
    const exists = Object.hasOwn(labels, expression.key);
    const contains = (expression.values ?? []).includes(labels[expression.key]);
    if (expression.operator === "In" && (!exists || !contains)) return false;
    if (expression.operator === "NotIn" && exists && contains) return false;
    if (expression.operator === "Exists" && !exists) return false;
    if (expression.operator === "DoesNotExist" && exists) return false;
    if (!["In", "NotIn", "Exists", "DoesNotExist"].includes(expression.operator)) return false;
  }
  return true;
}

function intersectHostnames(listenerHostname, routeHostnames) {
  const listener = String(listenerHostname ?? "").trim().toLowerCase();
  const routes = Array.isArray(routeHostnames) ? routeHostnames.map((host) => String(host).trim().toLowerCase()).filter(Boolean) : [];
  if (routes.length === 0) return listener ? [listener] : [];
  if (!listener) return sortedUnique(routes);
  return sortedUnique(routes.map((route) => hostnameIntersection(listener, route)).filter(Boolean));
}

function hostnameIntersection(a, b) {
  if (a === b) return a;
  if (wildcardMatches(a, b)) return b;
  if (wildcardMatches(b, a)) return a;
  if (a.startsWith("*.") && b.startsWith("*.")) {
    const as = a.slice(1);
    const bs = b.slice(1);
    if (as.endsWith(bs)) return a;
    if (bs.endsWith(as)) return b;
  }
  return undefined;
}

function wildcardMatches(pattern, hostname) {
  if (!pattern.startsWith("*.") || hostname.startsWith("*.")) return false;
  const suffix = pattern.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
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
 * @returns {{object: object, kind: string, hosts: string[], dials: string[], gatewayExposures: object[]}[]}
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
        backends.add(namespacedName(service.namespace, service.name));
      }
    }
    const exposures = gatewayExposures(objects, backends);
    hosts.push(...frontingHosts(objects, backends));
    const own = new Set(hosts);
    const dials = [];
    const spec = template.spec ?? {};
    for (const container of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
      for (const value of containerValues(container, ns, configMaps)) {
        const host = hostOnly(value, known);
        if (host && !own.has(host)) dials.push(host);
      }
    }
    out.push({ object, kind: WORKLOAD_KINDS[object.kind], hosts: sortedUnique(hosts), dials: sortedUnique(dials), gatewayExposures: exposures });
  }
  return out;
}
