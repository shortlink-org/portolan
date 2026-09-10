import type { CatalogIndex, RelationEvidence, Step } from "../catalog";
import { stepRpcContract } from "./answers";

/** Adapt older fragments to the same explanation without inventing a path. */
export function stepRelationEvidence(index: CatalogIndex, step: Step): RelationEvidence[] {
  const items = [...(step.evidence ?? [])];
  if (step.line && !items.some((item) => item.kind === "call-site" && item.source === step.line)) {
    items.push({ kind: "call-site", rule: "source-expression", source: step.line, symbol: step.label });
  }
  const contract = stepRpcContract(index, step);
  if (contract) items.push({ kind: "contract", rule: "catalog-contract", source: contract.provided.source, symbol: contract.id });
  if (step.kind === "event" && step.ref) {
    const event = index.eventById.get(step.ref);
    const version = event?.versions.at(-1);
    if (version) items.push({ kind: "contract", rule: "event-declaration", source: version.source, symbol: step.ref });
  }
  if (step.storeAccess?.source) items.push({ kind: "binding", rule: "repository-sql-call", source: step.storeAccess.source, symbol: step.storeAccess.method });
  if (step.destination?.resolution) {
    const resolution = step.destination.resolution;
    items.push({ kind: "resolution", rule: resolution.basis, symbol: `${resolution.provider} ${resolution.route}` });
  }
  if (step.continuesAt) items.push({ kind: "resolution", rule: "continuation-entrypoint", symbol: step.continuesAt });
  if (step.kind === "response" && step.replyTo) items.push({ kind: "resolution", rule: "response-to-request", symbol: step.replyTo });
  if (step.status === "unresolved" && !items.some((item) => item.kind === "unresolved")) {
    items.push({ kind: "unresolved", rule: "unresolved-target", symbol: step.ref ?? step.label });
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
