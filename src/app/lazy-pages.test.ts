import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageRouteFor } from "./lazy-pages";

// The routes are declared twice: as JSX in CatalogApp, and as the preload
// table in lazy-pages. These keep the two from drifting apart.

const WITHOUT_CHUNK = new Set(["/", "/id/*", "/index.html", "*"]);

function declaredRoutes(): string[] {
  const source = readFileSync(new URL("./CatalogApp.tsx", import.meta.url), "utf8");
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]!);
}

describe("page preloading", () => {
  it("knows every route CatalogApp declares", () => {
    const routes = declaredRoutes().filter((path) => !WITHOUT_CHUNK.has(path));
    expect(routes.length).toBeGreaterThan(25);
    for (const path of routes) expect(pageRouteFor(path), path).toBe(path);
  });

  it("reads a literal segment before the parameter it would fill", () => {
    expect(pageRouteFor("/adrs/new")).toBe("/adrs/new");
    expect(pageRouteFor("/adrs/0007-thing")).toBe("/adrs/:adr");
    expect(pageRouteFor("/drafts/task/PORTOLAN-21")).toBe("/drafts/task/:task");
    expect(pageRouteFor("/c/shop/cart/data/carts")).toBe("/c/:context/:service/data/:store");
    expect(pageRouteFor("/c/shop/cart/cart/vo/money")).toBe("/c/:context/:service/:aggregate/vo/:block");
    expect(pageRouteFor("/c/shop/cart/cart/item-added")).toBe("/c/:context/:service/:aggregate/:event");
    expect(pageRouteFor("/settings/rules/new")).toBe("/settings/*");
  });

  it("has nothing to fetch for the overview", () => {
    expect(pageRouteFor("/")).toBeNull();
  });
});
