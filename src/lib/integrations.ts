import type {
  Catalog,
  External,
  RpcCall,
  RpcMethod,
  RpcService,
  Service,
} from "../catalog";

export type IntegrationKind = "service" | "external" | "unresolved";
export type IntegrationProtocol = "SOAP" | "HTTP" | "RPC";

export interface IntegrationOperation {
  call: RpcCall;
  protocol: IntegrationProtocol;
  provided?: RpcService;
  method?: RpcMethod;
}

export interface IntegrationGroup {
  id: string;
  name: string;
  kind: IntegrationKind;
  external?: External;
  service?: Service;
  operations: IntegrationOperation[];
  documented: number;
  protocols: IntegrationProtocol[];
}

function operationIn(
  provided: RpcService[],
  id: string,
): { provided: RpcService; method: RpcMethod } | undefined {
  for (const iface of provided) {
    const method = iface.methods.find(
      (candidate) => `${iface.id}/${candidate.name}` === id,
    );
    if (method) return { provided: iface, method };
  }
  return undefined;
}

function protocolOf(
  call: RpcCall,
  method: RpcMethod | undefined,
): IntegrationProtocol {
  if (method?.soap || call.id.startsWith("soap/")) return "SOAP";
  if (method?.http || call.id.startsWith("http-client/")) return "HTTP";
  return "RPC";
}

/**
 * Every outbound call grouped by the system answering it.
 *
 * The grouping deliberately starts from `consumes`, not from `externals`: an
 * external contract with no call is inventory, while this view answers the
 * operational question "what does this component depend on?". Conversely an
 * unresolved call remains a first-class group rather than disappearing just
 * because no contract can decorate it.
 */
export function integrationsFor(
  service: Service,
  catalog: Catalog,
): IntegrationGroup[] {
  const services = new Map<string, Service>();
  for (const context of catalog.contexts) {
    for (const candidate of context.services)
      services.set(candidate.id, candidate);
  }
  const externals = new Map(
    (catalog.externals ?? []).map((external) => [external.id, external]),
  );
  const groups = new Map<string, IntegrationGroup>();

  for (const call of service.consumes) {
    const external = externals.get(call.peer);
    const internal = services.get(call.peer);
    const contract = operationIn(
      external?.provides ?? internal?.provides ?? [],
      call.id,
    );
    let group = groups.get(call.peer);
    if (!group) {
      group = {
        id: call.peer,
        name: external?.name ?? internal?.name ?? call.peer,
        kind: external ? "external" : internal ? "service" : "unresolved",
        ...(external ? { external } : {}),
        ...(internal ? { service: internal } : {}),
        operations: [],
        documented: 0,
        protocols: [],
      };
      groups.set(call.peer, group);
    }
    const protocol = protocolOf(call, contract?.method);
    group.operations.push({ call, protocol, ...contract });
    if (call.status !== "unresolved") group.documented++;
    if (!group.protocols.includes(protocol)) group.protocols.push(protocol);
  }

  const protocolOrder: IntegrationProtocol[] = ["SOAP", "HTTP", "RPC"];
  return [...groups.values()]
    .map((group) => ({
      ...group,
      operations: [...group.operations].sort((a, b) =>
        a.call.id.localeCompare(b.call.id),
      ),
      protocols: [...group.protocols].sort(
        (a, b) => protocolOrder.indexOf(a) - protocolOrder.indexOf(b),
      ),
    }))
    .sort(
      (a, b) =>
        Number(a.kind === "unresolved") - Number(b.kind === "unresolved") ||
        a.name.localeCompare(b.name),
    );
}

export function externalConsumers(
  catalog: Catalog,
  externalId: string,
): Array<{ service: Service; calls: RpcCall[] }> {
  const out: Array<{ service: Service; calls: RpcCall[] }> = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      const calls = service.consumes.filter((call) => call.peer === externalId);
      if (calls.length > 0) out.push({ service, calls });
    }
  }
  return out.sort((a, b) => a.service.name.localeCompare(b.service.name));
}
