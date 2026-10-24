import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog";
import { messagingClaims } from "./messaging";

const catalog = {
  generatedAt: "",
  commit: "",
  defs: {},
  flows: [],
  adrs: [],
  contexts: [
    {
      id: "sales",
      slug: "sales",
      name: "Sales",
      summary: "",
      services: [
        {
          id: "sales.checkout",
          slug: "checkout",
          name: "Checkout",
          repo: "example",
          path: "checkout",
          readme: "",
          aggregates: [
            {
              id: "sales.checkout.order",
              slug: "order",
              name: "Order",
              readme: "",
              root: "Order",
              entities: [],
              valueObjects: [],
              operations: [],
              events: [
                {
                  id: "sales.checkout.order.Imported",
                  slug: "imported",
                  name: "Imported",
                  versions: [],
                  consumers: [],
                  wire: { name: "Imported", channel: "imports" },
                },
              ],
            },
          ],
          consumes: [],
          provides: [],
          channels: [
            {
              address: "orders",
              protocol: "kafka",
              messages: [{ name: "Placed", direction: "send" }],
            },
            { address: "commands", messages: [] },
          ],
        },
        {
          id: "sales.fulfilment",
          slug: "fulfilment",
          name: "Fulfilment",
          repo: "example",
          path: "fulfilment",
          readme: "",
          aggregates: [],
          consumes: [],
          provides: [],
          channels: [
            {
              address: "orders",
              protocol: "kafka",
              messages: [
                { name: "Placed", direction: "receive" },
                { name: "Missing", direction: "receive" },
                { name: "Imported", direction: "receive" },
              ],
            },
          ],
        },
      ],
    },
  ],
} satisfies Catalog;

describe("messagingClaims", () => {
  it("keeps matching addresses as separate service-scoped claims", () => {
    const claims = messagingClaims(catalog);
    const orders = claims.channels.filter((claim) => claim.address === "orders");
    expect(orders).toHaveLength(2);
    expect(new Set(orders.map((claim) => claim.id)).size).toBe(2);
    expect(orders.map((claim) => claim.serviceId)).toEqual([
      "sales.checkout",
      "sales.fulfilment",
    ]);
  });

  it("surfaces missing operations and subscribers without publishers", () => {
    const claims = messagingClaims(catalog);
    expect(claims.channels.find((claim) => claim.address === "commands")?.issue).toBe(
      "no operation",
    );
    expect(claims.messages.find((claim) => claim.name === "Placed")?.issue).toBe(
      "clear",
    );
    expect(claims.messages.find((claim) => claim.name === "Missing")?.issue).toBe(
      "no publisher",
    );
  });

  it("uses a domain event wire as publisher evidence", () => {
    const withImportedChannel: Catalog = {
      ...catalog,
      contexts: catalog.contexts.map((context) => ({
        ...context,
        services: context.services.map((service) =>
          service.id === "sales.fulfilment"
            ? {
                ...service,
                channels: [
                  {
                    address: "imports",
                    messages: [{ name: "Imported", direction: "receive" }],
                  },
                ],
              }
            : service,
        ),
      })),
    };
    expect(
      messagingClaims(withImportedChannel).messages.find(
        (claim) => claim.name === "Imported",
      )?.issue,
    ).toBe("clear");
  });

  it("matches publishers and consumers by deployment environment", () => {
    const configuredCatalog: Catalog = {
      ...catalog,
      contexts: catalog.contexts.map((context) => ({
        ...context,
        services: context.services.map((service) => ({
          ...service,
          aggregates: [],
          channels:
            service.id === "sales.checkout"
              ? [
                  {
                    address: "checkout-source-default",
                    configuredAddresses: [
                      { environment: "dev", address: "orders-dev", source: "configmap.dev.yaml:1" },
                      { environment: "prod", address: "orders-prod", source: "configmap.prod.yaml:1" },
                    ],
                    messages: [{ name: "Placed", direction: "send" }],
                  },
                ]
              : [
                  {
                    address: "fulfilment-source-default",
                    configuredAddresses: [
                      { environment: "dev", address: "orders-dev", source: "configmap.dev.yaml:1" },
                      { environment: "prod", address: "orders-prod", source: "configmap.prod.yaml:1" },
                    ],
                    messages: [{ name: "Placed", direction: "receive" }],
                  },
                ],
        })),
      })),
    };

    const consumer = messagingClaims(configuredCatalog).messages.find(
      (claim) => claim.serviceId === "sales.fulfilment" && claim.name === "Placed",
    );
    expect(consumer?.issue).toBe("clear");
  });

  it("does not match the same configured address across different environments", () => {
    const configuredCatalog: Catalog = {
      ...catalog,
      contexts: catalog.contexts.map((context) => ({
        ...context,
        services: context.services.map((service) => ({
          ...service,
          aggregates: [],
          channels:
            service.id === "sales.checkout"
              ? [
                  {
                    address: "same-source-default",
                    configuredAddresses: [
                      { environment: "dev", address: "orders-dev", source: "configmap.dev.yaml:1" },
                      { environment: "prod", address: "orders-prod", source: "configmap.prod.yaml:1" },
                    ],
                    messages: [{ name: "Placed", direction: "send" }],
                  },
                ]
              : [
                  {
                    address: "same-source-default",
                    configuredAddresses: [
                      { environment: "dev", address: "orders-prod", source: "configmap.dev.yaml:1" },
                      { environment: "prod", address: "orders-dev", source: "configmap.prod.yaml:1" },
                    ],
                    messages: [{ name: "Placed", direction: "receive" }],
                  },
                ],
        })),
      })),
    };

    const consumer = messagingClaims(configuredCatalog).messages.find(
      (claim) => claim.serviceId === "sales.fulfilment" && claim.name === "Placed",
    );
    expect(consumer?.issue).toBe("no publisher");
  });
});
