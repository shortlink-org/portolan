import { describe, expect, it } from "vitest";
import type { Catalog, Service } from "../catalog";
import { externalConsumers, integrationsFor } from "./integrations";

const consumer: Service = {
  id: "travel.booking",
  slug: "booking",
  name: "Booking",
  repo: "",
  path: "",
  readme: "",
  provides: [],
  consumes: [
    {
      id: "carrier.soap.v1/Cancel",
      peer: "carrier",
      status: "declared",
      source: "cancel.go:12",
    },
    {
      id: "soap/urn:carrier:Search",
      peer: "carrier-legacy",
      status: "unresolved",
      source: "search.go:8",
    },
    {
      id: "billing.v1/Charge",
      peer: "payments.billing",
      status: "verified",
      source: "pay.go:4",
    },
  ],
  aggregates: [],
};

const catalog: Catalog = {
  generatedAt: "",
  commit: "",
  contexts: [
    {
      id: "travel",
      slug: "travel",
      name: "Travel",
      summary: "",
      services: [consumer],
    },
    {
      id: "payments",
      slug: "payments",
      name: "Payments",
      summary: "",
      services: [
        {
          id: "payments.billing",
          slug: "billing",
          name: "Billing",
          repo: "",
          path: "",
          readme: "",
          provides: [
            {
              id: "billing.v1",
              source: "billing.proto",
              methods: [{ name: "Charge" }],
            },
          ],
          consumes: [],
          aggregates: [],
        },
      ],
    },
  ],
  defs: {},
  flows: [],
  adrs: [],
  externals: [
    {
      id: "carrier",
      slug: "carrier",
      name: "Carrier API",
      summary: "",
      provides: [
        {
          id: "carrier.soap.v1",
          source: "carrier.wsdl",
          methods: [
            { name: "Cancel", soap: { version: "1.2", action: "cancel" } },
          ],
        },
      ],
    },
  ],
};

describe("integrationsFor", () => {
  it("groups contracted, internal and unresolved calls without hiding holes", () => {
    const groups = integrationsFor(consumer, catalog);

    expect(groups.map((group) => [group.name, group.kind])).toEqual([
      ["Billing", "service"],
      ["Carrier API", "external"],
      ["carrier-legacy", "unresolved"],
    ]);
    expect(groups[1]).toMatchObject({ documented: 1, protocols: ["SOAP"] });
    expect(groups[1]?.operations[0]).toMatchObject({
      protocol: "SOAP",
      method: { name: "Cancel" },
    });
    expect(groups[2]).toMatchObject({ documented: 0, protocols: ["SOAP"] });
  });
});

describe("externalConsumers", () => {
  it("finds the services and concrete calls using an external contract", () => {
    expect(externalConsumers(catalog, "carrier")).toEqual([
      { service: consumer, calls: [consumer.consumes[0]] },
    ]);
  });
});
