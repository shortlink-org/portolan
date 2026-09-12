import { describe, expect, it } from "vitest";

import { projectForFlow, projectsForFlow } from "./trace-project";

const projects = [
  { id: "auth", name: "Auth", root: "examples/auth", context: "auth", service: "auth" },
  { id: "shop-cart", name: "Cart", root: "examples/shop/cart", context: "shop", service: "cart" },
  { id: "shop-oms", name: "OMS", root: "examples/shop/oms", group: "shop", component: "oms" },
];

const flow = (owner: string, ...services: string[]) => ({
  owner,
  participants: [
    { id: "client", kind: "actor" as const, context: null },
    ...services.map((id) => ({ id, kind: "service" as const, context: id.split(".")[0] ?? null })),
    { id: "bus", kind: "broker" as const, context: null },
  ],
});

describe("which project a recording of a flow belongs to", () => {
  it("is the one project in the flow's context", () => {
    expect(projectForFlow(projects, flow("auth", "auth.auth"))?.id).toBe("auth");
  });

  it("is the project whose service the flow runs through when the context has several", () => {
    expect(projectForFlow(projects, flow("shop", "shop.oms", "shop.pricing"))?.id).toBe("shop-oms");
    expect(projectsForFlow(projects, flow("shop", "shop.cart")).map((p) => p.id)).toEqual(["shop-cart", "shop-oms"]);
  });

  it("is nobody's when the context has no project, or two the flow runs through", () => {
    expect(projectForFlow(projects, flow("payments", "payments.ledger"))).toBeNull();
    expect(projectForFlow(projects, flow("shop", "shop.cart", "shop.oms"))).toBeNull();
  });
});
