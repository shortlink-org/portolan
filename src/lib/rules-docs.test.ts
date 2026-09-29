// What the documentation rules find: a service that records no stack, and one
// with no README. Both are read off the service row alone.

import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { buildIndex } from "../catalog";
import type { Catalog, Service } from "../catalog";
import { builtinProblems } from "./problem-rules";

const RULES = ["service-stack-unknown", "service-undescribed"];

/** The catalog with every service described and built with something, then `change` applied. */
function estate(change: (service: Service) => Service = (service) => service): Catalog {
  return {
    ...catalog,
    contexts: catalog.contexts.map((context) => ({
      ...context,
      services: context.services.map((service) =>
        change({ ...service, technologies: ["Go"], readme: `# ${service.name}\n\nDoes one thing.` }),
      ),
    })),
  };
}

const found = (of: Catalog) =>
  builtinProblems(of, buildIndex(of), RULES).map((problem) => `${problem.rule} ${problem.id}`);

describe("documentation rules", () => {
  const first = catalog.contexts[0]!.services[0]!;

  it("say nothing about services that record a stack and a README", () => {
    expect(found(estate())).toEqual([]);
  });

  it("name the service that records no language or runtime", () => {
    const of = estate((service) => (service.id === first.id ? { ...service, technologies: [] } : service));
    expect(found(of)).toEqual([`service-stack-unknown ${first.id}`]);
  });

  it("name the service whose README is missing or blank", () => {
    const of = estate((service) => (service.id === first.id ? { ...service, readme: " \n" } : service));
    expect(found(of)).toEqual([`service-undescribed ${first.id}`]);
  });
});
