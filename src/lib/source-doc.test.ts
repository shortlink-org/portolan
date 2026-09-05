import { describe, expect, it } from "vitest";
import type { Service } from "../catalog";
import { docPathOf, pickSpec, sourceDocKind, sourceLineOf } from "./source-doc";

function service(
  provides: { id: string; source: string; module?: string }[],
): Service {
  return {
    id: "shop.oms",
    slug: "oms",
    name: "oms",
    repo: "",
    path: "",
    readme: "",
    provides: provides.map((p) => ({ ...p, methods: [] })),
    consumes: [],
    aggregates: [],
  };
}

describe("docPathOf", () => {
  // The bug a naive extension check walks straight into: a proto source names
  // the line its declaration sits on, and an OpenAPI one never did.
  it("strips the line number a proto source carries", () => {
    expect(docPathOf("proto/shop/v1/orders.proto:12")).toBe(
      "proto/shop/v1/orders.proto",
    );
  });

  it("leaves a path with no line alone, and is idempotent", () => {
    const plain = "examples/auth/openapi.yaml";
    expect(docPathOf(plain)).toBe(plain);
    expect(docPathOf(docPathOf("a/b.proto:9"))).toBe("a/b.proto");
  });

  // Only a trailing `:digits` is a line number. Anything else is part of the
  // path and removing it would name a file that does not exist.
  it("does not eat a colon that is not a trailing line number", () => {
    expect(docPathOf("C:/protos/orders.proto")).toBe("C:/protos/orders.proto");
    expect(docPathOf("a:12/b.proto")).toBe("a:12/b.proto");
  });

  it("reads the line back out", () => {
    expect(sourceLineOf("proto/shop/v1/orders.proto:12")).toBe(12);
    expect(sourceLineOf("examples/auth/openapi.yaml")).toBeNull();
  });
});

describe("sourceDocKind", () => {
  it("tells the two kinds of document apart, line number and all", () => {
    expect(sourceDocKind("proto/shop/v1/orders.proto:12")).toBe("proto");
    expect(sourceDocKind("examples/auth/openapi.yaml")).toBe("openapi");
    expect(sourceDocKind("examples/auth/openapi.yml")).toBe("openapi");
    expect(sourceDocKind("examples/bff/src/schema/basket/schema.graphql")).toBe("graphql");
    expect(sourceDocKind("internal/handler.go")).toBeNull();
  });
});

describe("pickSpec", () => {
  const held = (source: string) => source.endsWith(".yaml");

  it("prefers a document this repository actually holds", () => {
    const choice = pickSpec(
      service([
        { id: "shop.v1.Orders", source: "proto/orders.proto:12", module: "m" },
        { id: "auth.v1.Users", source: "examples/auth/openapi.yaml" },
      ]),
      held,
    );

    expect(choice).toEqual({
      kind: "openapi",
      source: "examples/auth/openapi.yaml",
    });
  });

  // A schema is a document this repository holds like any other, and the tab
  // draws it as written rather than as a second copy of the provides tab.
  it("picks the graphql schema an interface was read from", () => {
    expect(
      pickSpec(
        service([{ id: "storefront.v1.Basket", source: "examples/bff/src/schema/basket/schema.graphql" }]),
        (source) => source.endsWith(".graphql"),
      ),
    ).toEqual({ kind: "graphql", source: "examples/bff/src/schema/basket/schema.graphql" });
  });

  it("falls back to the module the interfaces came from", () => {
    expect(
      pickSpec(
        service([
          {
            id: "shop.v1.Orders",
            source: "proto/orders.proto:12",
            module: "buf.build/acme/shop",
          },
        ]),
        held,
      ),
    ).toEqual({ kind: "module", moduleId: "buf.build/acme/shop" });
  });

  // A spec in another repository is the normal case for a real estate: the
  // catalog still lists what the service answers, and the tab says so.
  it("has nothing to show for an interface with neither", () => {
    expect(
      pickSpec(service([{ id: "x", source: "internal/handler.go" }]), held),
    ).toBeNull();
    expect(pickSpec(service([]), held)).toBeNull();
  });
});
