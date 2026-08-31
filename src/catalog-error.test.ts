// The failure path is a feature, so it is tested like one: a bad catalog must
// fail with a message a reader can act on AND a path that names where to look.

import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.json";
import { CatalogError, validateCatalog } from "./catalog";
import type { Catalog } from "./catalog";

const clone = (): Catalog =>
  JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog;

/** Runs the validator and returns the error, failing the test if there is none. */
function failureOf(catalog: Catalog): CatalogError {
  try {
    validateCatalog(catalog);
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return e as CatalogError;
  }
  throw new Error("expected the catalog to fail validation");
}

describe("CatalogError.path", () => {
  it("names the flow and the step for a step that points at a missing lane", () => {
    const bad = clone();
    const flow = bad.flows[0];
    if (!flow) throw new Error("fixture has no flows");
    const step = flow.steps.find((n) => n.type === "step");
    if (!step || step.type !== "step")
      throw new Error("fixture flow has no plain step");
    step.to = "nobody.at.all";

    const error = failureOf(bad);
    expect(error.message).toContain(step.id);
    expect(error.path).toBe(`flow ${flow.id} / step ${step.id}`);
  });

  it("names the aggregate for a root that is not one of its entities", () => {
    const bad = clone();
    const aggregate = bad.contexts[0]?.services[0]?.aggregates[0];
    if (!aggregate) throw new Error("fixture has no aggregates");
    aggregate.root = "NotAnEntity";

    const error = failureOf(bad);
    expect(error.path).toBe(`aggregate ${aggregate.id}`);
  });

  it("names the event and version for a field pointing at a missing def", () => {
    const bad = clone();
    const event = bad.contexts
      .flatMap((c) => c.services)
      .flatMap((s) => s.aggregates)
      .flatMap((a) => a.events)
      .find((e) => (e.versions[0]?.fields.length ?? 0) > 0);
    const version = event?.versions[0];
    const field = version?.fields[0];
    if (!event || !version || !field)
      throw new Error("fixture has no event fields");
    field.ref = "no.such.def";

    const error = failureOf(bad);
    expect(error.path).toBe(
      `event ${event.id}@${version.version} / field ${field.name}`,
    );
  });

  it("leaves the message untouched - the page prints it verbatim", () => {
    const bad = clone();
    bad.commit = "";
    const error = failureOf(bad);
    expect(error.message).toBe("catalog.commit is missing");
    expect(error.path).toBe("catalog");
  });

  it("passes the real catalog, path and all", () => {
    expect(() => validateCatalog(clone())).not.toThrow();
  });
});
