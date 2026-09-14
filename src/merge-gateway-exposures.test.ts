import { describe, expect, it } from "vitest";
import type { BoundedContext, GatewayExposure } from "./catalog";
import { mergeCatalogs } from "./merge";

function context(exposure: GatewayExposure): BoundedContext {
  return {
    id: "shop",
    slug: "shop",
    name: "Shop",
    summary: "",
    services: [{
      id: "shop.pricing",
      slug: "pricing",
      name: "Pricing",
      repo: "",
      path: "",
      readme: "",
      provides: [],
      consumes: [],
      aggregates: [],
      gatewayExposures: [exposure],
    }],
  };
}

const exposure = (basis: GatewayExposure["basis"], over: Partial<GatewayExposure> = {}): GatewayExposure => ({
  id: "HTTPRoute/shop/pricing->Gateway/shop/shop#https->Service/shop/pricing",
  hostnames: ["api.example.com"],
  routeKind: "HTTPRoute",
  routeNamespace: "shop",
  routeName: "pricing",
  gatewayNamespace: "shop",
  gatewayName: "shop",
  listener: "https",
  protocol: "HTTPS",
  port: 443,
  backendNamespace: "shop",
  backendName: "pricing",
  basis,
  ...over,
});

describe("Gateway API exposure merge", () => {
  it("folds matching manifest and cluster evidence into one row", () => {
    const { catalog } = mergeCatalogs([
      { path: "a-manifest.json", catalog: { contexts: [context(exposure("manifest", { source: "deploy/gateway.yaml" }))], defs: {}, flows: [], adrs: [] } },
      { path: "b-api.json", catalog: { contexts: [context(exposure("api"))], defs: {}, flows: [], adrs: [] } },
    ]);
    expect(catalog.contexts[0]?.services[0]?.gatewayExposures).toEqual([
      expect.objectContaining({ basis: "both", source: "deploy/gateway.yaml" }),
    ]);
    expect(catalog.contexts[0]?.services[0]?.gatewayExposures?.[0]?.drift).toBeUndefined();
  });

  it("keeps the manifest listener values as drift under the live row", () => {
    const { catalog } = mergeCatalogs([
      { path: "a-api.json", catalog: { contexts: [context(exposure("api", { hostnames: ["current.example.com"], port: 8443 }))], defs: {}, flows: [], adrs: [] } },
      { path: "b-manifest.json", catalog: { contexts: [context(exposure("manifest", { source: "deploy/gateway.yaml" }))], defs: {}, flows: [], adrs: [] } },
    ]);
    expect(catalog.contexts[0]?.services[0]?.gatewayExposures?.[0]).toMatchObject({
      basis: "both",
      hostnames: ["current.example.com"],
      port: 8443,
      source: "deploy/gateway.yaml",
      drift: { hostnames: ["api.example.com"], port: 443 },
    });
  });
});
