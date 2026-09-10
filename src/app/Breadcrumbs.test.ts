// The trail under the top bar, one crumb per segment. What matters is that no
// route falls through to nothing, and that a literal in the path - "data",
// "vo" - is never mistaken for the name of a thing.

import { describe, expect, it } from "vitest";
import { crumbsFor } from "./Breadcrumbs";

describe("crumbsFor", () => {
  it("names the four index pages that used to have no trail", () => {
    expect(crumbsFor("/language")).toEqual([
      { label: "language", to: "/language" },
    ]);
    expect(crumbsFor("/problems")).toEqual([
      { label: "problems", to: "/problems" },
    ]);
    expect(crumbsFor("/registry")).toEqual([
      { label: "registry", to: "/registry" },
    ]);
    expect(crumbsFor("/registry/no-such-module").map((c) => c.to)).toEqual([
      "/registry",
      "/registry/no-such-module",
    ]);
  });

  it("calls the decisions what the tree calls them", () => {
    expect(crumbsFor("/adrs")[0]).toEqual({ label: "decisions", to: "/adrs" });
  });

  it("keeps the active settings section in the trail", () => {
    expect(crumbsFor("/settings/delivery")).toEqual([
      { label: "settings", to: "/settings" },
      { label: "delivery", to: "/settings/delivery" },
    ]);
    expect(crumbsFor("/settings/integrations")).toEqual([
      { label: "settings", to: "/settings" },
      { label: "integrations", to: "/settings/integrations" },
    ]);
  });

  it("reads 'data' as a literal, not as an aggregate", () => {
    const crumbs = crumbsFor("/c/ctx/svc/data/pg");
    expect(crumbs.map((c) => c.to)).toEqual([
      "/c/ctx",
      "/c/ctx/svc",
      "/c/ctx/svc/data/pg",
    ]);
    expect(crumbs.some((c) => c.label === "data")).toBe(false);
  });
});
