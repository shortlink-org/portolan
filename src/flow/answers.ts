// What comes back from a call, when a contract says.
//
// The catalog records hops - a call was made, an event was published - and
// never a reply: a reply is not a second thing that happened, it is the far end
// of the same one. But a reader of a sequence still wants to see what the far
// end hands over, and for an rpc the answer is already written down twice over:
// in the proto that declares the method, and in the OpenAPI document that
// declares the operation. So it is looked up rather than recorded, and a step
// whose method nobody in the catalog provides simply has no answer to draw.
//
// Only an rpc has one. A `call` lands inside a service - a repository, a
// queryset - which no interface in the catalog describes; an event is a
// publication, and drawing a reply to it would be a lie about the bus.

import type { CatalogIndex, Flow, RpcMethod, Step } from "../catalog";
import { walkSteps } from "../catalog";

/** The method a step reaches, when the catalog has it. */
function methodOf(index: CatalogIndex, step: Step): RpcMethod | undefined {
  if (step.kind !== "rpc") return undefined;

  // Outgoing: the step names the call, and the call id is `<interface>/<method>`.
  if (step.ref) {
    const cut = step.ref.lastIndexOf("/");
    if (cut < 0) return undefined;
    const [interfaceId, name] = [step.ref.slice(0, cut), step.ref.slice(cut + 1)];
    const provider = index.rpcProviderByMethod.get(step.ref);
    const provided = provider?.provides.find((p) => p.id === interfaceId);
    return provided?.methods.find((m) => m.name === name);
  }

  // Incoming: somebody called this service, and the label is the operation.
  const service = index.serviceById.get(step.to);
  if (!service || !step.label) return undefined;
  for (const provided of service.provides) {
    const found = provided.methods.find((m) => m.name === step.label);
    if (found) return found;
  }
  return undefined;
}

/** What the callee hands back, as the contract names it. */
export function stepAnswer(index: CatalogIndex, step: Step): string | undefined {
  return methodOf(index, step)?.response || undefined;
}

/** Every step of a flow that has one, by step id. */
export function flowAnswers(index: CatalogIndex, flow: Flow): Map<string, string> {
  const out = new Map<string, string>();
  for (const step of walkSteps(flow.steps)) {
    const answer = stepAnswer(index, step);
    if (answer) out.set(step.id, answer);
  }
  return out;
}
