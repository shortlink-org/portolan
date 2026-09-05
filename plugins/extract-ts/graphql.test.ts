// A service whose way in is a graph.
//
// The fixture beside this has no domain, no store and no use case: a schema,
// resolvers under it, ports of their own, and assembly. What is worth pinning
// is that the reader still finds the way through - the field a client asks
// for, the port the resolver holds, the adapter assembly bound to it, and the
// peer at the end.
import { describe, expect, it } from "vitest";
import type { Flow, Step } from "../../src/catalog.ts";
import { extract } from "./extract.ts";

const ROOT = "plugins/extract-ts/testdata/storefront";
const options = { context: "storefront", service: "bff", graphql: "src/schema", peers: { "auth.v1": "auth.auth" } };

function run() {
  return extract({ root: ROOT, commit: "abc1234", generatedAt: "2026-09-05T00:00:00Z" }, options);
}

function fragment() {
  return JSON.parse(run().files[0]!.contents) as {
    contexts: { services: { consumes: { id: string; peer: string }[]; aggregates: unknown[] }[] }[];
    flows: Flow[];
  };
}

function flow(slug: string): Flow {
  const found = fragment().flows.find((f) => f.slug === slug);
  if (!found) throw new Error(`no flow ${slug} in ${fragment().flows.map((f) => f.slug).join(", ")}`);

  return found;
}

describe("a service read through its resolvers", () => {
  // The field is what the client asks for, and it is named the way
  // extract-graphql names the method it read out of the schema - `Query.viewer`
  // - so the two meet in the merge.
  it("opens a flow on the field", () => {
    const [first] = flow("bff-query-viewer").steps as Step[];

    expect(first).toMatchObject({ from: "client", to: "storefront.bff", kind: "rpc", label: "Query.viewer" });
  });

  // `ctx.sessions.current(...)` is to a resolver what `this.sessions.validate(...)`
  // is to a use case: the port is held, and what fills it is assembly's word.
  it("follows the port on the context to the peer behind it", () => {
    const [, second] = flow("bff-query-viewer").steps as Step[];

    expect(second).toMatchObject({ from: "storefront.bff", to: "auth.auth", ref: "auth.v1.Sessions/validateSession" });
  });

  it("names the call among what the service consumes", () => {
    const { consumes } = fragment().contexts[0]!.services[0]!;

    expect(consumes).toEqual([{ id: "auth.v1.Sessions/validateSession", peer: "auth.auth", status: "declared", source: `${ROOT}/src/infrastructure/auth/gen/openapi.yaml` }]);
  });

  // A resolver that answers out of its arguments reaches nothing, and the flow
  // says so by having nothing after the ask.
  it("draws one step for a field that reaches nothing", () => {
    expect(flow("bff-mutation-add-item").steps).toHaveLength(1);
  });

  it("takes the summary from the resolver's doc comment", () => {
    expect(flow("bff-query-viewer").summary).toBe("Who the request belongs to.");
  });

  // A BFF has no model, and saying so every run would be a warning nobody can
  // act on. The option that names the schema is what says to expect none.
  it("does not report the missing domain", () => {
    expect(fragment().contexts[0]!.services[0]!.aggregates).toEqual([]);
    expect(run().warnings).toEqual([]);
  });
});
