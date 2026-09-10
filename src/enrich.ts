// Edges the flows already know.
//
// A flow step saying `bus -> payments.ledger : OrderPlaced` is the same fact as
// a consumer entry on the event, written in the other place. The extractors
// cannot put it on the event - a service's repository knows what the service
// hears, not who else listens to what it says - so after the merge the host
// reads it out of the steps and writes it where the graph, the Problems page
// and the generators look.
//
// Three rules keep this from inventing anything:
//
//  - A derived edge inherits the step's status and never becomes `verified`
//    on its own. A step nobody observed running gives an edge nobody observed.
//  - A declared edge wins. If a source already names the consumer or the call,
//    the step adds nothing; and between two flows implying the same edge, the
//    first in catalog order is the one recorded.
//  - A derived edge says where it came from. `via` names the flow and the step,
//    so a reader can tell "the service declares this" from "a flow shows it".

import type {
  Catalog,
  EdgeVia,
  EventConsumer,
  Flow,
  FlowNode,
  RpcCall,
  HTTPDestination,
  Service,
  Status,
  Step,
} from "./catalog";
// With the extension: scripts/catalog-sources.mjs runs this file under Node
// without a bundler, and Node resolves nothing it is not told.
import { walkSteps } from "./catalog.ts";

export interface DerivedEdge {
  kind: "consumer" | "rpc";
  /** Event id for a consumer, RpcCall id for a call. */
  ref: string;
  /** The consumer of the event, or the caller of the method. */
  service: string;
  /** rpc only: the step's `to`, the service the call was made to. */
  peer?: string;
  status: Status;
  via: EdgeVia;
}

export interface Enriched {
  catalog: Catalog;
  derived: DerivedEdge[];
}

/**
 * Returns a catalog whose consumers and calls include every edge its flows
 * imply, plus the list of what was added. Pure: the input is never written to,
 * and enriching twice yields the same catalog as enriching once.
 */
export function enrichCatalog(input: Catalog): Enriched {
  // A step naming an event by the name it travels under is resolved first, so
  // everything below - and every consumer derived from it - sees the event
  // rather than the name.
  const catalog = resolveForeignKeys(
    resolveStoreAccesses(
      composeExecutionContinuations(resolveWireNames(resolveHTTPCalls(input))),
    ),
  );

  const serviceById = new Map<string, Service>();
  const eventOwner = new Map<string, string>();
  const providedMethods = new Set<string>(); // "<provider>|<interface>/<method>"
  const declaredRpcIds = new Set<string>();
  const haveConsumer = new Set<string>(); // "<event>|<service>"
  const haveCall = new Set<string>(); // "<service>|<call>"

  // A system outside the estate answers on a contract too, and a step reaching
  // it on an operation its document declares is as resolvable as one reaching
  // a service of ours. Keyed by the external's id, which is what the lane says.
  for (const external of catalog.externals ?? []) {
    for (const provided of external.provides) {
      for (const method of provided.methods) {
        providedMethods.add(`${external.id}|${provided.id}/${method.name}`);
      }
    }
  }

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceById.set(service.id, service);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          providedMethods.add(`${service.id}|${provided.id}/${method.name}`);
        }
      }
      for (const call of service.consumes) {
        declaredRpcIds.add(call.id);
        haveCall.add(`${service.id}|${call.id}`);
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          eventOwner.set(event.id, service.id);
          for (const consumer of event.consumers) {
            haveConsumer.add(`${event.id}|${consumer.service}`);
          }
        }
      }
    }
  }

  const derived: DerivedEdge[] = [];
  const consumersFor = new Map<string, EventConsumer[]>();
  const callsFor = new Map<string, RpcCall[]>();

  // Atomic source fragments are the strongest provenance for a derived edge.
  // Composed roots repeat those steps for reading, so inspect them afterwards;
  // they only become evidence when their source fragment was intentionally
  // consumed and removed from the catalog.
  const evidenceFlows = [...catalog.flows].sort(
    (left, right) =>
      Number(Boolean(left.includes)) - Number(Boolean(right.includes)),
  );
  for (const flow of evidenceFlows) {
    const lanes = new Map(flow.participants.map((p) => [p.id, p]));

    for (const step of walkSteps(flow.steps)) {
      if (!step.ref) continue;
      const via: EdgeVia = { flow: flow.slug, step: step.id };

      if (step.kind === "event") {
        if (!eventOwner.has(step.ref)) continue;
        // A self-message is in-process; a broker, a store or an actor on the
        // receiving end is a publish, a write or a notification, none of
        // which is a service listening.
        if (step.from === step.to) continue;
        const lane = lanes.get(step.to);
        if (!lane) continue;
        if (
          lane.kind === "broker" ||
          lane.kind === "store" ||
          lane.kind === "actor"
        )
          continue;

        const key = `${step.ref}|${step.to}`;
        if (haveConsumer.has(key)) continue;
        haveConsumer.add(key);

        const known = lane.kind === "service" && serviceById.has(step.to);
        const status: Status = known ? step.status : "unresolved";
        push(consumersFor, step.ref, { service: step.to, status, via });
        derived.push({
          kind: "consumer",
          ref: step.ref,
          service: step.to,
          status,
          via,
        });

        continue;
      }

      if (step.kind === "rpc") {
        // Only a service has a `consumes` list to put the call on.
        if (!serviceById.has(step.from)) continue;
        const key = `${step.from}|${step.ref}`;
        if (haveCall.has(key)) continue;

        // The call has to be resolvable before this pass. Derived calls feed
        // the validator's set of known call ids, and a call derived from a
        // step naming a method nobody provides would make that step its own
        // evidence.
        const provided = providedMethods.has(`${step.to}|${step.ref}`);
        if (!provided && !declaredRpcIds.has(step.ref)) continue;
        haveCall.add(key);

        const status: Status = provided ? step.status : "unresolved";
        push(callsFor, step.from, {
          id: step.ref,
          peer: step.to,
          status,
          source: flow.source ?? `flow:${flow.slug}`,
          via,
        });
        derived.push({
          kind: "rpc",
          ref: step.ref,
          service: step.from,
          peer: step.to,
          status,
          via,
        });
      }
    }
  }

  if (derived.length === 0) return { catalog, derived };

  const contexts = catalog.contexts.map((context) => ({
    ...context,
    services: context.services.map((service) => {
      const calls = callsFor.get(service.id);
      const touched =
        calls !== undefined ||
        service.aggregates.some((a) =>
          a.events.some((e) => consumersFor.has(e.id)),
        );
      if (!touched) return service;

      return {
        ...service,
        consumes: calls ? [...service.consumes, ...calls] : service.consumes,
        aggregates: service.aggregates.map((aggregate) => {
          if (!aggregate.events.some((e) => consumersFor.has(e.id)))
            return aggregate;

          return {
            ...aggregate,
            events: aggregate.events.map((event) => {
              const added = consumersFor.get(event.id);
              return added
                ? { ...event, consumers: [...event.consumers, ...added] }
                : event;
            }),
          };
        }),
      };
    }),
  }));

  return { catalog: { ...catalog, contexts }, derived };
}

interface HTTPProvider {
  service: string;
  context: string;
  ref: string;
  method: string;
  path: string;
  /** Set when the manifests, not the route alone, chose this provider. */
  basis?: "kubernetes-host";
}

/**
 * Resolves the protocol-neutral calls emitted by the HTTP client extractor
 * against HTTP routes contributed by server-side extractors.
 *
 * No source fragment can do this on its own: a client repository knows the
 * verb and path but not which of the estate's services answers it, while an
 * OpenAPI or framework fragment knows only what its own service provides.
 * The merged catalog is the first place both facts exist.
 *
 * Proven full paths are authoritative and never fall back to a suffix.
 * Legacy calls can still use a unique suffix because mounted
 * applications commonly see only their local route (`/get-admin-settings`)
 * while the server extractor records the mount too
 * (`/settings/get-admin-settings`). Ambiguous matches and possible self-calls
 * deliberately remain unresolved.
 */
function resolveHTTPCalls(input: Catalog): Catalog {
  const providers: HTTPProvider[] = [];
  // What the manifests said, where a tree of them was read: the names each
  // service answers on, and the names each caller is configured to dial.
  const hostsByService = new Map<string, Set<string>>();
  const dialsByService = new Map<string, string[]>();
  for (const context of input.contexts) {
    for (const service of context.services) {
      if (service.hosts?.length) {
        hostsByService.set(service.id, new Set(service.hosts));
      }
      if (service.dials?.length) dialsByService.set(service.id, service.dials);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          // A route with an empty method is mounted but its verb is unknown
          // (extract-django's `Planet.fetch`); the path alone never confirms
          // a link, so it is kept out of the candidates deliberately.
          if (!method.http || !method.http.method) continue;
          providers.push({
            service: service.id,
            context: context.id,
            ref: `${provided.id}/${method.name}`,
            method: method.http.method.toUpperCase(),
            path: method.http.path,
          });
        }
      }
    }
  }
  if (providers.length === 0) return input;

  const resolvedByCaller = new Map<string, Map<string, HTTPProvider>>();
  const resolve = (caller: string, call: RpcCall): HTTPProvider | undefined => {
    if (call.status !== "unresolved") return undefined;
    const raw = rawHTTPRoute(call.id);
    const route = call.destination?.fullPath
      ? { method: call.destination.method, path: call.destination.fullPath }
      : raw;
    if (!route) return undefined;

    const candidates = providers.filter(
      (provider) =>
        provider.service !== caller &&
        provider.method === route.method &&
        (call.destination?.fullPath
          ? sameHTTPShape(provider.path, route.path)
          : sameHTTPPath(provider.path, route.path)),
    );
    const exact = uniqueHTTPProviders(
      candidates.filter((provider) => sameHTTPShape(provider.path, route.path)),
    );
    const matches = exact.length > 0 ? exact : uniqueHTTPProviders(candidates);
    if (matches.length === 1) return matches[0];
    if (matches.length < 2) return undefined;
    // Ambiguous by route alone. The manifests may say which of them the
    // caller reaches: the host the call names, or failing that the hosts the
    // caller's workload is configured to dial. They only ever decide between
    // providers of the route; a host never conjures a provider that does not
    // have it.
    const host = callHost(call);
    const dials = dialsByService.get(caller) ?? [];
    const reachable = matches.filter((provider) => {
      const hosts = hostsByService.get(provider.service);
      if (!hosts) return false;
      return host ? hosts.has(host) : dials.some((dial) => hosts.has(dial));
    });
    return reachable.length === 1
      ? { ...reachable[0]!, basis: "kubernetes-host" }
      : undefined;
  };

  const evidence = (call: Pick<RpcCall, "id" | "source" | "destination">, provider: HTTPProvider): HTTPDestination => {
    const raw = rawHTTPRoute(call.id);
    const destination = call.destination ?? {
      callSite: call.source, endpointExpression: raw?.path ?? call.id,
      method: raw?.method ?? provider.method, localPath: raw?.path,
    };
    return { ...destination, resolution: {
      basis: provider.basis ?? (destination.fullPath ? "full-path" : sameHTTPShape(provider.path, raw?.path ?? "") ? "exact-route" : "unique-suffix"),
      provider: provider.service, route: provider.path,
    } };
  };
  let changed = false;
  const contexts = input.contexts.map((context) => ({
    ...context,
    services: context.services.map((service) => {
      const resolved = new Map<string, HTTPProvider>();
      const mapped = service.consumes.map((call) => {
        const provider = resolve(service.id, call);
        if (!provider) return call;
        changed = true;
        resolved.set(call.id, provider);
        return {
          ...call,
          id: provider.ref,
          destination: evidence(call, provider),
          peer: provider.service,
          status: "declared" as const,
        };
      });
      const consumes = [
        ...new Map(mapped.map((call) => [call.id, call])).values(),
      ];
      if (resolved.size > 0) resolvedByCaller.set(service.id, resolved);
      return resolved.size > 0 ? { ...service, consumes } : service;
    }),
  }));

  if (!changed) return input;

  const flows = input.flows.map((flow) => {
    let flowChanged = false;
    const targets = new Map<string, HTTPProvider>();
    const steps = mapSteps(flow.steps, (step) => {
      if (step.kind !== "rpc" || !step.ref) return step;
      const provider = resolvedByCaller.get(step.from)?.get(step.ref);
      if (!provider) return step;
      flowChanged = true;
      targets.set(provider.service, provider);
      return {
        ...step,
        ref: provider.ref,
        destination: evidence({ id: step.ref, source: step.line ?? "", destination: step.destination }, provider),
        to: provider.service,
        status: "declared",
      };
    });
    if (!flowChanged) return flow;

    const participants = [...flow.participants];
    const seen = new Set(participants.map((participant) => participant.id));
    for (const target of targets.values()) {
      if (seen.has(target.service)) continue;
      seen.add(target.service);
      participants.push({
        id: target.service,
        kind: "service",
        context: target.context,
      });
    }
    return { ...flow, participants, steps };
  });

  return { ...input, contexts, flows };
}

function rawHTTPRoute(
  id: string,
): { method: string; path: string } | undefined {
  // The extractor qualifies a raw call with its destination after " @ "
  // (`http-client/POST /foo @ payments.internal`) so that the same route to two
  // hosts stays two calls; the route itself is what resolves against providers.
  const match = /^http-client\/([A-Z]+)\s+(\/\S*)(?: @ .+)?$/.exec(id);
  return match ? { method: match[1]!, path: match[2]! } : undefined;
}

/**
 * The host a call names, when it names one: the service-discovery alias the
 * extractor recorded, the hostname of a literal base URL, or the destination
 * after " @ " in the id when that is a host rather than an expression. A port
 * is dropped, because a Service's name has none.
 */
function callHost(call: RpcCall): string | undefined {
  const at = /^http-client\/[A-Z]+\s+\/\S*\s@\s(.+)$/.exec(call.id)?.[1];
  for (const value of [
    call.destination?.serviceDiscoveryAlias,
    call.destination?.baseURL?.value,
    at,
  ]) {
    const host = hostOf(value);
    if (host) return host;
  }
  return undefined;
}

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname || undefined;
    } catch {
      return undefined;
    }
  }
  // Lower case by the cluster's own rule, so that `Config.SupplierURL` - an
  // expression the extractor could not evaluate - is not taken for a host.
  return /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]+)?$/.exec(trimmed)?.[1];
}

function uniqueHTTPProviders(providers: HTTPProvider[]): HTTPProvider[] {
  const unique = new Map<string, HTTPProvider>();
  for (const provider of providers) {
    unique.set(`${provider.service}\u0000${provider.ref}`, provider);
  }
  return [...unique.values()];
}

function sameHTTPPath(provided: string, called: string): boolean {
  const provider = httpSegments(provided);
  const call = httpSegments(called);
  if (call.length === 0) return provider.length === 0;
  if (call.length > provider.length) return false;
  const offset = provider.length - call.length;
  for (let index = 0; index < call.length; index += 1) {
    if (!sameHTTPSegment(provider[offset + index]!, call[index]!)) return false;
  }
  return true;
}

function sameHTTPShape(left: string, right: string): boolean {
  const a = httpSegments(left);
  const b = httpSegments(right);
  return (
    a.length === b.length &&
    a.every((segment, index) => sameHTTPSegment(segment, b[index]!))
  );
}

function httpSegments(path: string): string[] {
  const withoutQuery = path.split("?", 1)[0] ?? path;
  return withoutQuery.split("/").filter(Boolean);
}

function sameHTTPSegment(left: string, right: string): boolean {
  return left === right || (isHTTPParameter(left) && isHTTPParameter(right));
}

function isHTTPParameter(segment: string): boolean {
  return (
    segment === "%s" || /^\{[^{}]+\}$/.test(segment) || /^:[^:]+$/.test(segment)
  );
}

/**
 * Joins the use-case-side repository call emitted by extract-go to the
 * concrete Redis client call emitted independently by extract-redis. Method
 * name and store id are deliberately both required; a name such as `Get`
 * alone is far too common to be evidence. Ambiguous matches stay unresolved.
 */
function resolveStoreAccesses(input: Catalog): Catalog {
  const byMethod = new Map<
    string,
    Array<{
      operation: NonNullable<Step["storeAccess"]>["operation"];
      keyspace: string;
      source?: string;
    }>
  >();

  for (const store of input.stores ?? []) {
    for (const keyspace of store.keyspaces ?? []) {
      for (const access of keyspace.accesses ?? []) {
        if (!access.method) continue;
        const method = access.method.split(".").pop() ?? access.method;
        const key = `${store.id}\u0000${method}`;
        const matches = byMethod.get(key) ?? [];
        matches.push({
          operation: access.operation,
          keyspace: keyspace.pattern,
          ...(access.source ? { source: access.source } : {}),
        });
        byMethod.set(key, matches);
      }
    }
  }

  let changed = false;
  const mapNodes = (nodes: FlowNode[]): FlowNode[] =>
    nodes.map((node): FlowNode => {
      if (node.type === "step") {
        const storeAccess = node.storeAccess;
        if (
          !storeAccess ||
          !storeAccess.method ||
          (storeAccess.operation && storeAccess.keyspace)
        ) {
          return node;
        }
        const method =
          storeAccess.method.split(".").pop() ?? storeAccess.method;
        const matches =
          byMethod.get(`${storeAccess.store}\u0000${method}`) ?? [];
        if (matches.length !== 1) return node;
        changed = true;
        return {
          ...node,
          storeAccess: { ...storeAccess, ...matches[0] },
        };
      }
      if (node.type === "alt") {
        const branches = node.branches.map((branch) => ({
          ...branch,
          steps: mapNodes(branch.steps),
        }));
        return { ...node, branches };
      }
      if (node.type === "parallel") {
        return { ...node, branches: node.branches.map(mapNodes) };
      }
      return { ...node, steps: mapNodes(node.steps) };
    });

  const flows = input.flows.map((flow) => ({
    ...flow,
    steps: mapNodes(flow.steps),
  }));
  return changed ? { ...input, flows } : input;
}

/**
 * Composes independently extracted protocol fragments into root-oriented
 * execution flows.
 *
 * There are three deliberately exact seams: a source function entered after a
 * step, a source function proven reachable on the same path, and an
 * asynchronous handoff whose kind/channel/message tuple matches a receiving
 * flow's opening step. Display labels and ordinary domain-event refs never
 * participate. Ambiguous seams compose nothing.
 */
function composeExecutionContinuations(input: Catalog): Catalog {
  const responses = synchronousResponses(input);
  const byEntry = new Map<string, Flow | null>();
  const byHandoff = new Map<string, Flow | null>();
  for (const flow of input.flows) {
    if (flow.entrypoint) addUniqueFlow(byEntry, flow.entrypoint, flow);
    // A task extractor often keeps the locally observed enqueue before the
    // worker receive in one standalone flow. External producers must join at
    // the receive boundary, not replay that local enqueue. Top-level slicing
    // preserves everything the worker does afterwards, including branches.
    for (let index = 0; index < flow.steps.length; index += 1) {
      const opening = flow.steps[index];
      if (
        opening?.type !== "step" ||
        opening.handoff?.direction !== "receive"
      ) {
        continue;
      }
      addUniqueFlow(byHandoff, handoffKey(opening.handoff), {
        ...flow,
        steps: flow.steps.slice(index),
      });
    }
  }
  const consumed = new Set<string>();
  let any = false;
  const flows = input.flows.map((flow) => {
    const existing = new Set(flow.includes ?? []);
    const expansion = expandExecution(
      flow,
      flow.steps,
      [flow.slug],
      existing,
      byEntry,
      byHandoff,
      consumed,
      responses,
    );
    let steps = expansion.nodes;
    const opening = walkSteps(steps)[0];
    if (
      flow.trigger?.kind === "http" &&
      opening?.kind === "rpc" &&
      !hasResponseFor(steps, opening.id)
    ) {
      steps = appendResponseAtExits(
        steps,
        responseStep(
          opening,
          responses.get(opening.ref ?? "")?.label || "HTTP response",
          "HTTP handler return",
        ),
      );
    }
    steps = hydrateHTTPResponseContracts(steps, responses);
    if (expansion.includes.length === 0 && steps === expansion.nodes)
      return flow;
    any = true;

    const participants = [...flow.participants];
    const seen = new Set(participants.map((participant) => participant.id));
    for (const continuation of expansion.fragments) {
      for (const participant of continuation.participants) {
        if (seen.has(participant.id)) continue;
        seen.add(participant.id);
        participants.push(participant);
      }
    }
    return {
      ...flow,
      summary:
        flow.summary.replace(/\s*$/, "") +
        " Source-backed cross-protocol continuations are included.",
      includes: unique([...(flow.includes ?? []), ...expansion.includes]),
      participants,
      steps,
    };
  });

  if (!any) return input;
  return {
    ...input,
    flows: flows.filter(
      (flow) =>
        !consumed.has(flow.slug) ||
        (flow.trigger !== undefined && flow.trigger.kind !== "unproven"),
    ),
  };
}

interface ExecutionExpansion {
  nodes: FlowNode[];
  includes: string[];
  fragments: Flow[];
}

function expandExecution(
  root: Flow,
  nodes: FlowNode[],
  path: string[],
  existing: ReadonlySet<string>,
  byEntry: ReadonlyMap<string, Flow | null>,
  byHandoff: ReadonlyMap<string, Flow | null>,
  consumed: Set<string>,
  responses: ReadonlyMap<string, SynchronousResponse>,
): ExecutionExpansion {
  const out: FlowNode[] = [];
  const includes: string[] = [];
  const fragments: Flow[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "step": {
        out.push(node);
        if (path.length > 12) break;
        let continuationNodes: FlowNode[] = [];
        let synchronous = false;
        for (const continuationMatch of continuationsFor(
          root,
          node,
          byEntry,
          byHandoff,
        )) {
          const continuation = continuationMatch.flow;
          if (
            path.includes(continuation.slug) ||
            existing.has(continuation.slug)
          ) {
            continue;
          }
          const nestedExisting = new Set(continuation.includes ?? []);
          const nested = expandExecution(
            continuation,
            continuation.steps,
            [...path, continuation.slug],
            nestedExisting,
            byEntry,
            byHandoff,
            consumed,
            responses,
          );
          const prefix = `continuation-${continuation.slug}-${node.id}`;
          continuationNodes.push(...prefixFlowNodes(nested.nodes, prefix));
          synchronous ||= continuationMatch.synchronous;
          includes.push(
            continuation.slug,
            ...(continuation.includes ?? []),
            ...nested.includes,
          );
          fragments.push(continuation, ...nested.fragments);
          if (
            continuation.entrypoint &&
            (!continuation.trigger || continuation.trigger.kind === "unproven")
          ) {
            consumed.add(continuation.slug);
          }
        }
        const response = responses.get(node.ref ?? "");
        if (
          synchronous &&
          node.kind === "rpc" &&
          response &&
          !hasResponseFor(nodes, node.id)
        ) {
          continuationNodes = appendResponseAtExits(
            continuationNodes,
            responseStep(node, response.label, "unary gRPC return"),
          );
        }
        out.push(...continuationNodes);
        break;
      }
      case "alt":
        {
          const branches = node.branches.map((branch) => {
            const expanded = expandExecution(
              root,
              branch.steps,
              path,
              existing,
              byEntry,
              byHandoff,
              consumed,
              responses,
            );
            includes.push(...expanded.includes);
            fragments.push(...expanded.fragments);
            return { ...branch, steps: expanded.nodes };
          });
          out.push({
            ...node,
            branches,
          });
        }
        break;
      case "parallel":
        {
          const branches = node.branches.map((branch) => {
            const expanded = expandExecution(
              root,
              branch,
              path,
              existing,
              byEntry,
              byHandoff,
              consumed,
              responses,
            );
            includes.push(...expanded.includes);
            fragments.push(...expanded.fragments);
            return expanded.nodes;
          });
          out.push({
            ...node,
            branches,
          });
        }
        break;
      case "loop":
        {
          const expanded = expandExecution(
            root,
            node.steps,
            path,
            existing,
            byEntry,
            byHandoff,
            consumed,
            responses,
          );
          includes.push(...expanded.includes);
          fragments.push(...expanded.fragments);
          out.push({
            ...node,
            steps: expanded.nodes,
          });
        }
        break;
    }
  }
  return {
    nodes: out,
    includes: unique(includes),
    fragments: uniqueFlows(fragments),
  };
}

interface ContinuationMatch {
  flow: Flow;
  synchronous: boolean;
}

function continuationsFor(
  root: Flow,
  step: Step,
  byEntry: ReadonlyMap<string, Flow | null>,
  byHandoff: ReadonlyMap<string, Flow | null>,
): ContinuationMatch[] {
  const found: ContinuationMatch[] = [];
  const sourceEntries = [step.continuesAt, ...(step.reaches ?? [])].filter(
    (entry): entry is string => Boolean(entry),
  );
  for (const entry of sourceEntries) {
    const continuation = byEntry.get(entry);
    if (!continuation || continuation.owner !== root.owner) continue;
    found.push({ flow: continuation, synchronous: true });
  }
  if (step.handoff?.direction === "send") {
    const continuation = byHandoff.get(handoffKey(step.handoff));
    if (continuation) found.push({ flow: continuation, synchronous: false });
  }
  const matches = new Map<string, ContinuationMatch>();
  for (const match of found) {
    const previous = matches.get(match.flow.slug);
    if (!previous || match.synchronous) matches.set(match.flow.slug, match);
  }
  return [...matches.values()];
}

function handoffKey(handoff: NonNullable<Step["handoff"]>): string {
  return [
    handoff.kind,
    handoff.transport,
    handoff.channel,
    handoff.message ?? "",
  ].join("\u0000");
}

function addUniqueFlow(
  index: Map<string, Flow | null>,
  key: string,
  flow: Flow,
): void {
  index.set(key, index.has(key) ? null : flow);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueFlows(flows: Flow[]): Flow[] {
  const seen = new Set<string>();
  return flows.filter((flow) => {
    if (seen.has(flow.slug)) return false;
    seen.add(flow.slug);
    return true;
  });
}

function prefixFlowNodes(nodes: FlowNode[], prefix: string): FlowNode[] {
  return nodes.map((node) => {
    const id = `${prefix}-${node.id}`;
    switch (node.type) {
      case "step":
        return {
          ...node,
          id,
          ...(node.replyTo ? { replyTo: `${prefix}-${node.replyTo}` } : {}),
        };
      case "alt":
        return {
          ...node,
          id,
          branches: node.branches.map((branch) => ({
            ...branch,
            steps: prefixFlowNodes(branch.steps, prefix),
          })),
        };
      case "parallel":
        return {
          ...node,
          id,
          branches: node.branches.map((branch) =>
            prefixFlowNodes(branch, prefix),
          ),
        };
      case "loop":
        return { ...node, id, steps: prefixFlowNodes(node.steps, prefix) };
    }
  });
}

interface SynchronousResponse {
  label: string;
}

/** Resolve a source-proven serialized RPC result to its response message. */
function hydrateHTTPResponseContracts(
  nodes: FlowNode[],
  responses: ReadonlyMap<string, SynchronousResponse>,
): FlowNode[] {
  let changed = false;
  const visit = (list: FlowNode[]): FlowNode[] =>
    list.map((node): FlowNode => {
      if (node.type === "step") {
        if (node.kind !== "response" || !node.http) return node;
        const contract = node.http.bodyRef
          ? responses.get(node.http.bodyRef)
          : undefined;
        const body =
          node.http.body ||
          contract?.label ||
          node.label?.replace(/^\d{3}\s*·\s*/, "") ||
          "HTTP response";
        const label = node.http.status ? `${node.http.status} · ${body}` : body;
        if (node.http.body === body && node.label === label) return node;
        changed = true;
        return { ...node, label, http: { ...node.http, body } };
      }
      if (node.type === "alt") {
        const branches = node.branches.map((branch) => ({
          ...branch,
          steps: visit(branch.steps),
        }));
        return branches.some(
          (branch, index) => branch.steps !== node.branches[index]!.steps,
        )
          ? { ...node, branches }
          : node;
      }
      if (node.type === "parallel") {
        const branches = node.branches.map(visit);
        return branches.some((branch, index) => branch !== node.branches[index])
          ? { ...node, branches }
          : node;
      }
      const nested = visit(node.steps);
      return nested === node.steps ? node : { ...node, steps: nested };
    });

  const hydrated = visit(nodes);
  return changed ? hydrated : nodes;
}

/** Unary contract responses keyed by `<interface>/<method>`. */
function synchronousResponses(
  catalog: Catalog,
): Map<string, SynchronousResponse> {
  const out = new Map<string, SynchronousResponse>();
  const collect = (provided: Service["provides"][number]): void => {
    for (const method of provided.methods) {
      if (method.streaming || !method.response) continue;
      out.set(`${provided.id}/${method.name}`, { label: method.response });
    }
  };
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const provided of service.provides) collect(provided);
    }
  }
  for (const external of catalog.externals ?? []) {
    for (const provided of external.provides) collect(provided);
  }
  return out;
}

function responseStep(request: Step, label: string, protocol: string): Step {
  return {
    type: "step",
    id: `response-${request.id}`,
    from: request.to,
    to: request.from,
    kind: "response",
    label,
    status: request.status,
    note: `Synthesized from the proven synchronous ${protocol}.`,
    replyTo: request.id,
  };
}

function hasResponseFor(nodes: FlowNode[], requestId: string): boolean {
  return walkSteps(nodes).some(
    (step) => step.kind === "response" && step.replyTo === requestId,
  );
}

/**
 * Adds a response to every way a synchronous execution can return. A terminal
 * alt branch gets its own copy inside the branch; the normal fallthrough gets
 * the unsuffixed response after the nested fragment.
 */
function appendResponseAtExits(nodes: FlowNode[], response: Step): FlowNode[] {
  let emitted = 0;
  const nextResponse = (): Step => {
    emitted += 1;
    return emitted === 1
      ? response
      : { ...response, id: `${response.id}-exit-${emitted}` };
  };

  const visit = (
    list: FlowNode[],
    respondAtEnd: boolean,
  ): { nodes: FlowNode[]; fallsThrough: boolean } => {
    let fallsThrough = true;
    const out = list.map((node): FlowNode => {
      if (node.type === "step") return node;
      if (node.type === "parallel") {
        return {
          ...node,
          branches: node.branches.map((branch) => visit(branch, false).nodes),
        };
      }
      if (node.type === "loop") {
        return { ...node, steps: visit(node.steps, false).nodes };
      }

      const branches = node.branches.map((branch) => {
        const nested = visit(branch.steps, Boolean(branch.terminal));
        return { ...branch, steps: nested.nodes };
      });
      if (branches.length > 0 && branches.every((branch) => branch.terminal)) {
        fallsThrough = false;
      }
      return { ...node, branches };
    });
    if (respondAtEnd && fallsThrough) out.push(nextResponse());
    return { nodes: out, fallsThrough };
  };

  return visit(nodes, true).nodes;
}

/**
 * Steps that name an event by the name it travels under, resolved to the event
 * that travels under it.
 *
 * An extractor can only resolve what its own repository declares. A policy
 * reacting to somebody else's message has the wire name and nothing else —
 * `ledger.PaymentAuthorized` — so the step names it, says `unresolved`, and
 * leaves the other end to the merge. This is where it arrives, and the match is
 * the one verify-otel already makes against a trace: the event whose wire name
 * that is, or failing that the one event whose wire name ends in that segment.
 * Two candidates resolve to neither, because a guess here would put a service
 * on somebody else's event.
 *
 * A resolved step becomes `declared` and never `verified`: reading a name in
 * source is a claim that it listens, not a record of it having listened.
 */
function resolveWireNames(catalog: Catalog): Catalog {
  const byWire = new Map<string, string>();
  const bySegment = new Map<string, string | null>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const wire = event.wire?.name;
          if (!wire) continue;
          if (!byWire.has(wire)) byWire.set(wire, event.id);
          const segment = wire.slice(wire.lastIndexOf(".") + 1);
          bySegment.set(segment, bySegment.has(segment) ? null : event.id);
        }
      }
    }
  }
  if (byWire.size === 0) return catalog;

  const resolve = (step: Step): Step => {
    if (step.kind !== "event" || step.ref || step.status !== "unresolved")
      return step;
    const named = step.label;
    if (!named) return step;
    const found = byWire.get(named) ?? bySegment.get(named) ?? null;
    if (!found) return step;

    return { ...step, ref: found, status: "declared" };
  };

  let any = false;
  const flows = catalog.flows.map((flow) => {
    let changed = false;
    const steps = mapSteps(flow.steps, (step) => {
      const resolved = resolve(step);
      changed ||= resolved !== step;

      return resolved;
    });
    any ||= changed;

    return changed ? { ...flow, steps } : flow;
  });

  return any ? { ...catalog, flows } : catalog;
}

/**
 * Foreign keys naming a table this store does not have, resolved against the
 * estate's other stores.
 *
 * A migration says `REFERENCES orders (id)`, and the extractor that read it
 * knows only the store it was reading: a key into another service's table
 * keeps the raw name, because no extractor sees two schemas. The merge sees
 * all of them, and a name exactly one table in the estate answers to is that
 * table - which is what turns a dangling key into the crossing it is, on the
 * page and on Problems. Two tables of that name resolve to neither.
 */
function resolveForeignKeys(catalog: Catalog): Catalog {
  const stores = catalog.stores ?? [];
  if (stores.length === 0) return catalog;

  const known = new Set<string>();
  const byName = new Map<string, string | null>();
  for (const store of stores) {
    for (const table of store.tables) {
      known.add(table.id);
      byName.set(table.name, byName.has(table.name) ? null : table.id);
    }
  }

  let any = false;
  const resolved = stores.map((store) => {
    let touched = false;
    const tables = store.tables.map((table) => {
      let changed = false;
      const columns = table.columns.map((column) => {
        if (!column.fk || known.has(column.fk.table)) return column;
        const found = byName.get(column.fk.table);
        if (!found) return column;
        changed = true;

        return { ...column, fk: { ...column.fk, table: found } };
      });
      touched ||= changed;

      return changed ? { ...table, columns } : table;
    });
    any ||= touched;

    return touched ? { ...store, tables } : store;
  });

  return any ? { ...catalog, stores: resolved } : catalog;
}

/** The same tree, with every step handed to `resolve`. */
function mapSteps(
  nodes: FlowNode[],
  resolve: (step: Step) => Step,
): FlowNode[] {
  return nodes.map((node) => {
    switch (node.type) {
      case "step":
        return resolve(node);
      case "alt":
        return {
          ...node,
          branches: node.branches.map((branch) => ({
            ...branch,
            steps: mapSteps(branch.steps, resolve),
          })),
        };
      case "parallel":
        return {
          ...node,
          branches: node.branches.map((branch) => mapSteps(branch, resolve)),
        };
      case "loop":
        return { ...node, steps: mapSteps(node.steps, resolve) };
    }
  });
}

function push<T>(into: Map<string, T[]>, key: string, item: T): void {
  const list = into.get(key);
  if (list) list.push(item);
  else into.set(key, [item]);
}
