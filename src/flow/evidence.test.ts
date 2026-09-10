import { expect, it } from "vitest";
import { buildIndex, type Catalog, type Step } from "../catalog";
import { stepRelationEvidence } from "./evidence";

const index = buildIndex({ generatedAt: "", commit: "", contexts: [], defs: {}, flows: [], adrs: [] } as Catalog);
it("gives legacy call, event, RPC and response steps an honest source explanation", () => {
  for (const kind of ["call", "event", "rpc", "response"] as const) {
    const step: Step = { type: "step", id: "s1", from: "a", to: "b", kind, status: "declared", line: "handler.go:8" };
    expect(stepRelationEvidence(index, step)).toEqual([{ kind: "call-site", rule: "source-expression", source: "handler.go:8", symbol: undefined }]);
  }
});
it("keeps unresolved status and deduplicates recorded evidence", () => {
  const evidence = { kind: "call-site" as const, rule: "source-expression", source: "handler.go:8" };
  const step: Step = { type: "step", id: "s1", from: "a", to: "b", kind: "call", status: "unresolved", line: evidence.source, evidence: [evidence, evidence] };
  expect(stepRelationEvidence(index, step).map((item) => item.kind)).toEqual(["call-site", "unresolved"]);
});
