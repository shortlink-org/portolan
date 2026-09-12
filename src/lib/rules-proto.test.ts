import { describe, expect, it } from "vitest";
import { buildIndex } from "../catalog";
import type { Catalog, Service } from "../catalog";
import { builtinProblems } from "./problem-rules";

const PROTO = ["proto-missing", "proto-drift"];

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
        methods: [
          {
            name: "GetQuote",
            request: "GetQuoteRequest",
            response: "Quote",
          },
        ],
        source: "proto/pricing/v1/pricing.proto:7",
        messages: [
          {
            name: "GetQuoteRequest",
            fields: [
              { name: "sku", type: "string", number: 1, doc: "" },
              { name: "locale", type: "string", number: 2, doc: "" },
            ],
          },
          {
            name: "Quote",
            fields: [
              { name: "amount", type: "int64", number: 1, doc: "" },
              { name: "status", type: "QuoteStatus", number: 2, doc: "" },
            ],
          },
        ],
        enums: [
          {
            name: "QuoteStatus",
            values: [
              { name: "QUOTE_STATUS_UNSPECIFIED", number: 0 },
              { name: "QUOTE_STATUS_READY", number: 1 },
            ],
          },
        ],
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

const copiedPricing = (overrides = {}) =>
  service("shop.oms", {
    consumes: [
      {
        id: "pricing.v1.Pricing/GetQuote",
        peer: "shop.pricing",
        status: "declared",
        source: "internal/infrastructure/pricing/pricing.proto:8",
      },
    ],
    copies: [
      {
        id: "pricing.v1.Pricing",
        methods: [
          {
            name: "GetQuote",
            request: "GetQuoteRequest",
            response: "Quote",
          },
        ],
        source: "internal/infrastructure/pricing/pricing.proto:7",
        messages: [
          {
            name: "GetQuoteRequest",
            fields: [{ name: "sku", type: "string", number: 1, doc: "" }],
          },
          {
            name: "Quote",
            fields: [
              { name: "amount", type: "int64", number: 1, doc: "" },
              { name: "status", type: "QuoteStatus", number: 2, doc: "" },
            ],
          },
        ],
        enums: [
          {
            name: "QuoteStatus",
            values: [
              { name: "QUOTE_STATUS_UNSPECIFIED", number: 0 },
              { name: "QUOTE_STATUS_READY", number: 1 },
            ],
          },
        ],
        ...overrides,
      },
    ],
  });

function found(catalog: Catalog) {
  return builtinProblems(catalog, buildIndex(catalog), PROTO);
}

describe("the proto rules", () => {
  it("reports a call whose provider answers on no such method", () => {
    const problems = found(
      catalogWith([pricing(), calling("pricing.v1.Pricing/ListPriceLists")]),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("proto-missing");
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

  it("accepts a narrowed copy whose retained fields and enum agree", () => {
    expect(found(catalogWith([pricing(), copiedPricing()]))).toEqual([]);
  });

  it("reports copied fields whose type, number, or existence drifted", () => {
    const caller = copiedPricing({
      messages: [
        {
          name: "GetQuoteRequest",
          fields: [
            { name: "sku", type: "bytes", number: 3, doc: "" },
            { name: "currency", type: "string", number: 4, doc: "" },
          ],
        },
      ],
    });

    const problems = found(catalogWith([pricing(), caller]));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: "proto-drift",
      severity: "warning",
      service: "shop.oms",
      id: "pricing.v1.Pricing",
      peer: "shop.pricing",
    });
    expect(problems[0]?.note).toContain("GetQuoteRequest.sku is bytes");
    expect(problems[0]?.note).toContain("GetQuoteRequest.sku is field 3");
    expect(problems[0]?.note).toContain(
      "GetQuoteRequest.currency is absent from the provider",
    );
  });

  it("reports enum values added, removed, or renumbered", () => {
    const caller = copiedPricing({
      enums: [
        {
          name: "QuoteStatus",
          values: [
            { name: "QUOTE_STATUS_UNSPECIFIED", number: 0 },
            { name: "QUOTE_STATUS_READY", number: 7 },
            { name: "QUOTE_STATUS_OLD", number: 1 },
          ],
        },
      ],
    });

    const [problem] = found(catalogWith([pricing(), caller]));

    expect(problem?.note).toContain("QUOTE_STATUS_READY is 7, provider has 1");
    expect(problem?.note).toContain("QUOTE_STATUS_OLD is absent from the provider");
  });

  it("reports an enum value present only in the provider", () => {
    const caller = copiedPricing({
      enums: [
        {
          name: "QuoteStatus",
          values: [{ name: "QUOTE_STATUS_UNSPECIFIED", number: 0 }],
        },
      ],
    });

    const [problem] = found(catalogWith([pricing(), caller]));

    expect(problem?.note).toContain("QUOTE_STATUS_READY is missing from the copy");
  });
});
