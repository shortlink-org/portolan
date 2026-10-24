import { describe, expect, it } from "vitest";
import type { Catalog, Service } from "../catalog";
import { ownershipIndex } from "./ownership";

const service = (id: string, owners?: string[]): Service =>
  ({
    id,
    slug: id.split(".").at(-1)!,
    name: id,
    repo: "repo",
    path: id,
    readme: "",
    provides: [],
    consumes: [],
    aggregates: [],
    owners,
  }) as Service;

const catalog = {
  generatedAt: "2026-01-01T00:00:00Z",
  commit: "abc123",
  defs: {},
  flows: [],
  adrs: [],
  contexts: [
    {
      id: "shop",
      slug: "shop",
      name: "Shop",
      summary: "",
      services: [
        service("shop.oms", ["@platform", "@shop"]),
        service("shop.web", ["@shop"]),
        service("shop.jobs"),
      ],
    },
  ],
} as Catalog;

describe("ownershipIndex", () => {
  it("groups a shared service under every declared handle but counts it once", () => {
    const result = ownershipIndex(catalog);

    expect(result.assigned).toBe(2);
    expect(result.unassigned.map(({ service }) => service.id)).toEqual([
      "shop.jobs",
    ]);
    expect(result.owners.map(({ handle }) => handle)).toEqual([
      "@shop",
      "@platform",
    ]);
    expect(result.owners[0]?.services.map(({ service }) => service.id)).toEqual([
      "shop.oms",
      "shop.web",
    ]);
    expect(result.owners[1]?.services.map(({ service }) => service.id)).toEqual([
      "shop.oms",
    ]);
  });
});
