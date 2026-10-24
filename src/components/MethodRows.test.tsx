import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { RpcMethod, RpcService } from "../catalog";
import { HTTP_METHOD_GROUP_THRESHOLD } from "../lib/method-groups";
import { MethodRows } from "./MethodRows";

const method = (name: string, path: string): RpcMethod => ({
  name,
  http: { method: "GET", path },
});

const render = (methods: RpcMethod[]) => {
  const provided: RpcService = {
    id: "orders.v1",
    methods,
    source: "openapi.yaml",
  };

  return renderToStaticMarkup(
    <MemoryRouter>
      <MethodRows
        provided={provided}
        open={new Set()}
        onToggle={() => {}}
      />
    </MemoryRouter>,
  );
};

describe("MethodRows route families", () => {
  it("keeps small interfaces as visible method rows", () => {
    const html = render([
      method("listInvoices", "/billing/invoices"),
      method("getInvoice", "/billing/invoices/{id}"),
    ]);

    expect(html).toContain("listInvoices");
    expect(html).toContain("getInvoice");
    expect(html).not.toContain('aria-controls="method-orders.v1-group-billing"');
  });

  it("collapses repeated route families in large interfaces", () => {
    const html = render([
      method("listInvoices", "/api/v1/billing/invoices"),
      method("getInvoice", "/api/v1/billing/invoices/{id}"),
      ...Array.from(
        { length: HTTP_METHOD_GROUP_THRESHOLD - 2 },
        (_, index) => method(`single${index}`, `/single-${index}`),
      ),
    ]);

    expect(html).toContain('aria-controls="method-orders.v1-group-billing"');
    expect(html).toContain("/billing");
    expect(html).toContain("single0");
    expect(html).not.toContain("listInvoices");
  });
});
