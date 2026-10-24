import { describe, expect, it } from "vitest";
import type { RpcMethod } from "../catalog";
import {
  HTTP_METHOD_GROUP_THRESHOLD,
  groupHttpMethods,
} from "./method-groups";

const operation = (name: string, path: string, method = "GET"): RpcMethod => ({
  name,
  http: { method, path },
});

describe("groupHttpMethods", () => {
  it("leaves a small interface flat", () => {
    const methods = [
      operation("listInvoices", "/api/v1/billing/invoices"),
      operation("getInvoice", "/api/v1/billing/invoices/{id}"),
    ];

    expect(groupHttpMethods(methods)).toEqual(
      methods.map((method) => ({ kind: "method", method })),
    );
  });

  it("groups repeated meaningful prefixes and keeps one-off routes flat", () => {
    const methods = [
      operation("listInvoices", "/api/v1/billing/invoices"),
      operation("health", "/health"),
      operation("getInvoice", "/api/v2/billing/invoices/{id}"),
      operation("listOrders", "/{tenant}/orders"),
      operation("getOrder", "/{tenant}/orders/{id}"),
      ...Array.from(
        { length: HTTP_METHOD_GROUP_THRESHOLD - 5 },
        (_, index) => operation(`single${index}`, `/single-${index}`),
      ),
    ];

    const sections = groupHttpMethods(methods);

    expect(sections.slice(0, 3)).toEqual([
      {
        kind: "group",
        key: "billing",
        label: "/billing",
        methods: [methods[0], methods[2]],
      },
      { kind: "method", method: methods[1] },
      {
        kind: "group",
        key: "orders",
        label: "/orders",
        methods: [methods[3], methods[4]],
      },
    ]);
  });

  it("groups different verbs on the same route", () => {
    const basket = [
      operation("getBasket", "/basket", "GET"),
      operation("createBasket", "/basket", "POST"),
    ];
    const methods = [
      ...basket,
      ...Array.from(
        { length: HTTP_METHOD_GROUP_THRESHOLD - basket.length },
        (_, index) => operation(`single${index}`, `/single-${index}`),
      ),
    ];

    expect(groupHttpMethods(methods)[0]).toEqual({
      kind: "group",
      key: "basket",
      label: "/basket",
      methods: basket,
    });
  });

  it("does not count non-HTTP methods toward the grouping threshold", () => {
    const methods: RpcMethod[] = [
      operation("listInvoices", "/billing/invoices"),
      operation("getInvoice", "/billing/invoices/{id}"),
      ...Array.from(
        { length: HTTP_METHOD_GROUP_THRESHOLD },
        (_, index) => ({ name: `Rpc${index}` }),
      ),
    ];

    expect(groupHttpMethods(methods).every((section) => section.kind === "method"))
      .toBe(true);
  });
});
