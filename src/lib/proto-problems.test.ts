import { describe, expect, it } from "vitest";
import { buildIndex, type Catalog, type Service } from "../catalog";
import { protoProblems } from "./proto-problems";

function service(id: string, overrides: Partial<Service> = {}): Service {
  const slug = id.slice(id.indexOf(".") + 1);

  return {
    id,
    slug,
    name: slug,
    repo: "",
    path: "",
    readme: "",
    provides: [],
    consumes: [],
    aggregates: [],
    ...overrides,
  };
}

function catalogWith(services: Service[]): Catalog {
  return {
    generatedAt: "2024-01-01T00:00:00Z",
    commit: "abc1234",
    contexts: [
      {
        id: "shop",
        slug: "shop",
        name: "Shop",
        summary: "",
        services,
      },
    ],
    defs: {},
    flows: [],
    adrs: [],
  };
}

const pricing = () =>
  service("shop.pricing", {
    provides: [
      {
        id: "pricing.v1.Pricing",
        methods: [{ name: "GetQuote" }],
        source: "proto/pricing/v1/pricing.proto:7",
      },
    ],
  });

const calling = (id: string, status: "declared" | "unresolved" = "declared") =>
  service("shop.oms", {
    consumes: [
      {
        id,
        peer: "shop.pricing",
        status,
        source: "internal/infrastructure/pricing/pricing.proto:10",
      },
    ],
  });

function found(catalog: Catalog) {
  return protoProblems(catalog, buildIndex(catalog));
}

describe("protoProblems", () => {
  it("reports a call whose provider answers on no such method", () => {
    const problems = found(
      catalogWith([pricing(), calling("pricing.v1.Pricing/ListPriceLists")]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("proto-missing");
    expect(problems[0]?.severity).toBe("error");
    // The near end is the CALLER: that is the copy to go and look at.
    expect(problems[0]?.service).toBe("shop.oms");
    expect(problems[0]?.id).toBe("pricing.v1.Pricing/ListPriceLists");
  });

  it("says nothing about a call the provider does declare", () => {
    expect(
      found(catalogWith([pricing(), calling("pricing.v1.Pricing/GetQuote")])),
    ).toEqual([]);
  });

  // An unresolved call already has a problem of its own from problems(), and
  // one edge under two headings makes the page look worse than the estate is.
  it("leaves an unresolved call to the report that already covers it", () => {
    expect(
      found(
        catalogWith([
          pricing(),
          calling("pricing.v1.Pricing/ListPriceLists", "unresolved"),
        ]),
      ),
    ).toEqual([]);
  });

  // A call to something outside the estate is a fact, not a defect - and it is
  // the `rpc` problem's business, not this one's.
  it("says nothing when the peer is not in the catalog at all", () => {
    const outside = service("shop.oms", {
      consumes: [
        {
          id: "psp.v2.Charges/Create",
          peer: "psp",
          status: "declared",
          source: "internal/infrastructure/psp/psp.proto:9",
        },
      ],
    });

    expect(found(catalogWith([outside]))).toEqual([]);
  });

  it("finds nothing in a catalog where nobody calls anybody", () => {
    expect(found(catalogWith([pricing()]))).toEqual([]);
  });
});
