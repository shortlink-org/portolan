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

  it("takes an in-process call onto the other module's operation as its contract", () => {
    const flow = (ref: string): Flow => ({
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
      steps: [{ type: "step", id: "validate", from: "shop.cart", to: "auth.auth", kind: "call", ref, status: "declared", seen: { traces: 1 } }],
    });
    const withOperation = (catalog: Catalog): Catalog => {
      catalog.contexts[1]!.services[0]!.aggregates = [
        {
          id: "auth.auth.sessions",
          slug: "sessions",
          name: "Session",
          root: "Session",
          entities: [],
          valueObjects: [],
          enums: [],
          operations: [{ id: "validate-session", name: "ValidateSession", kind: "query" }],
          events: [],
        } as unknown as Catalog["contexts"][number]["services"][number]["aggregates"][number],
      ];
      return catalog;
    };
    const answered = withOperation(catalogWith(flow("auth.auth.sessions/validate-session")));
    expect(builtinProblems(answered, buildIndex(answered), FLOW_RULES)).toEqual([]);
    // A ref the other side does not answer is still no contract.
    const unanswered = withOperation(catalogWith(flow("auth.auth.sessions/revoke-session")));
    expect(
      builtinProblems(unanswered, buildIndex(unanswered), FLOW_RULES).map((problem) => problem.rule),
    ).toEqual(["flow-crossing-uncontracted"]);
  });
});
