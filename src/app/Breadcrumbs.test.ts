// The trail under the top bar, one crumb per segment. What matters is that no
// route falls through to nothing, and that a literal in the path - "data",
// "vo" - is never mistaken for the name of a thing.

import { describe, expect, it } from "vitest";
import { crumbsFor } from "./Breadcrumbs";
import { catalog } from "../data";
import { paths, specRequirementAnchor, specScenarioAnchor } from "../routes";

describe("crumbsFor", () => {
  it("names the estate-level index pages", () => {
    expect(crumbsFor("/language")).toEqual([
      { label: "language", to: "/language" },
    ]);
    expect(crumbsFor("/plugins")).toEqual([
      { label: "plugins", to: "/plugins" },
    ]);
    expect(crumbsFor("/problems")).toEqual([
      { label: "problems", to: "/problems" },
    ]);
    expect(crumbsFor("/ownership")).toEqual([
      { label: "ownership", to: "/ownership" },
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

  it("puts a rule's page under the rules section", () => {
    expect(crumbsFor("/settings/rules/team.event-pii")).toEqual([
      { label: "settings", to: "/settings" },
      { label: "rules", to: "/settings/rules" },
      { label: "team.event-pii", to: "/settings/rules/team.event-pii" },
    ]);
    expect(crumbsFor("/settings/rules/new").at(-1)).toEqual({ label: "new rule", to: "/settings/rules/new" });
  });

  it("keeps the active settings section in the trail", () => {
    expect(crumbsFor("/settings/delivery")).toEqual([
      { label: "settings", to: "/settings" },
      { label: "delivery", to: "/settings/delivery" },
    ]);
    expect(crumbsFor("/plugins/work-items/settings")).toEqual([
      { label: "plugins", to: "/plugins" },
      { label: "work-items", to: "/plugins#plugin-work-items" },
      { label: "settings", to: "/plugins/work-items/settings" },
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

  it("names exact requirement and scenario anchors inside a specification", () => {
    const spec = (catalog.specs ?? [])[0]!;
    const requirement = spec.requirements[0]!;
    const scenario = requirement.scenarios[0]!;
    const root = paths.spec(spec.slug);
    expect(crumbsFor(root, `#${specRequirementAnchor(requirement.id)}`).map((crumb) => crumb.label)).toEqual([
      "specs", spec.title, requirement.title,
    ]);
    expect(crumbsFor(root, `#${specScenarioAnchor(requirement.id, scenario.name)}`).map((crumb) => crumb.label)).toEqual([
      "specs", spec.title, requirement.title, scenario.name,
    ]);
  });
});
