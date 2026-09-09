// What comes back from a call, when a contract says.
//
// The catalog's source facts are hops - a call was made, an event was
// published. Composition may synthesize a response when a proven synchronous
// continuation returns, but standalone calls still need their answer read from
// the contract and shown on the request itself.
//
// Only an rpc has one. A `call` lands inside a service - a repository, a
// queryset - which no interface in the catalog describes; an event is a
// publication, and drawing a reply to it would be a lie about the bus.

import type {
  CatalogIndex,
  External,
  Flow,
  RpcMethod,
  RpcService,
  Service,
  Step,
} from "../catalog";
import { walkSteps } from "../catalog";

export interface StepRpcContract {
  id: string;
  provider: Service | External;
  provided: RpcService;
  method: RpcMethod;
}

/** The interface and method an RPC step reaches, when the catalog has them. */
export function stepRpcContract(
  index: CatalogIndex,
  step: Step,
): StepRpcContract | undefined {
  if (step.kind !== "rpc") return undefined;

  // A recorded ref is the full `<interface>/<method>` id, whether the flow
  // enters this service or calls another one.
  if (step.ref) {
    const cut = step.ref.lastIndexOf("/");
    if (cut < 0) return undefined;
    const [interfaceId, name] = [step.ref.slice(0, cut), step.ref.slice(cut + 1)];
    // A service of ours, or a system outside the estate whose vendored
    // document names the operation: what comes back is written down either way.
    const provider =
      index.rpcProviderByMethod.get(step.ref) ?? index.externalProviderByMethod.get(step.ref);
    const provided = provider?.provides.find((p) => p.id === interfaceId);
    const method = provided?.methods.find((m) => m.name === name);
    if (!provider || !provided || !method) return undefined;
    return { id: step.ref, provider, provided, method };
  }

  // Older incoming flows recorded only the operation label. Keep resolving
  // those catalogs while new extractors write the full ref above.
  const service = index.serviceById.get(step.to);
  if (!service || !step.label) return undefined;
  for (const provided of service.provides) {
    const found = provided.methods.find((m) => m.name === step.label);
    if (found) {
      return {
        id: `${provided.id}/${found.name}`,
        provider: service,
        provided,
        method: found,
      };
    }
  }
  return undefined;
}

/** What the callee hands back, as the contract names it. */
export function stepAnswer(index: CatalogIndex, step: Step): string | undefined {
  return stepRpcContract(index, step)?.method.response || undefined;
}

/** Every request without an explicit response step that has an answer. */
export function flowAnswers(index: CatalogIndex, flow: Flow): Map<string, string> {
  const out = new Map<string, string>();
  const explicit = new Set(
    walkSteps(flow.steps)
      .filter((step) => step.kind === "response" && step.replyTo)
      .map((step) => step.replyTo as string),
  );
  for (const step of walkSteps(flow.steps)) {
    if (explicit.has(step.id)) continue;
    const answer = stepAnswer(index, step);
    if (answer) out.set(step.id, answer);
  }
  return out;
}
