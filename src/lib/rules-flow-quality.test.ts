import { describe, expect, it } from "vitest";
import type { Catalog, Flow } from "../catalog";
import { buildIndex } from "../catalog";
import { builtinProblems } from "./problem-rules";

const FLOW_RULES = [
  "flow-trigger-missing",
  "flow-summary-empty",
  "flow-step-unresolved",
  "flow-crossing-uncontracted",
  "flow-observed-coverage-low",
];

function catalogWith(flow: Flow): Catalog {
  const service = (context: string, slug: string) => ({
    id: `${context}.${slug}`,
    slug,
    name: slug,
    repo: "",
    path: "",
    readme: "",
    provides: [],
    consumes: [],
    aggregates: [],
  });
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    commit: "0",
    contexts: [
      { id: "shop", slug: "shop", name: "Shop", summary: "", services: [service("shop", "cart")] },
      { id: "auth", slug: "auth", name: "Auth", summary: "", services: [service("auth", "auth")] },
    ],
    defs: {},
    flows: [flow],
    adrs: [],
  };
}

describe("flow quality rules", () => {
  it("reports missing documentation, resolution, contract and observation", () => {
    const catalog = catalogWith({
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "",
      owner: "shop",
      participants: [
        { id: "shop.cart", kind: "service", context: "shop" },
        { id: "auth.auth", kind: "service", context: "auth" },
      ],
      steps: [{ type: "step", id: "validate", from: "shop.cart", to: "auth.auth", kind: "rpc", status: "unresolved" }],
    });
    expect(
      builtinProblems(catalog, buildIndex(catalog), FLOW_RULES).map((problem) => problem.rule).sort(),
    ).toEqual([...FLOW_RULES].sort());
  });

  it("stays quiet for a documented, resolved and observed flow", () => {
    const catalog = catalogWith({
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "Checks the session before checkout.",
      owner: "shop",
      trigger: { kind: "http", label: "POST /checkout", confidence: "high" },
      participants: [
        { id: "shop.cart", kind: "service", context: "shop" },
        { id: "auth.auth", kind: "service", context: "auth" },
      ],
      steps: [{ type: "step", id: "validate", from: "shop.cart", to: "auth.auth", kind: "rpc", ref: "auth.v1.Auth/Validate", status: "verified", seen: { traces: 1 } }],
    });
    expect(builtinProblems(catalog, buildIndex(catalog), FLOW_RULES)).toEqual([]);
  });

  it("treats an internal call across contexts as a missing contract", () => {
    const catalog = catalogWith({
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "Checks the session before checkout.",
      owner: "shop",
      trigger: { kind: "http", confidence: "high" },
      participants: [
        { id: "shop.cart", kind: "service", context: "shop" },
        { id: "auth.auth", kind: "service", context: "auth" },
      ],
      steps: [
        {
          type: "step",
          id: "validate",
          from: "shop.cart",
          to: "auth.auth",
          kind: "call",
          status: "verified",
          seen: { traces: 1 },
        },
      ],
    });
    expect(
      builtinProblems(catalog, buildIndex(catalog), FLOW_RULES).map(
        (problem) => problem.rule,
      ),
    ).toEqual(["flow-crossing-uncontracted"]);
  });
});
