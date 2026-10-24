import { describe, expect, it } from "vitest";
import type { ConfigurationBinding } from "./catalog";
import { mergeCatalogs } from "./merge";
import type { CatalogSource } from "./merge";

function source(path: string, configurationBindings: ConfigurationBinding[]): CatalogSource {
  return {
    path,
    catalog: {
      generatedAt: "",
      commit: "",
      contexts: [],
      defs: {},
      flows: [],
      adrs: [],
      configurationBindings,
    },
  };
}

const binding = (over: Partial<ConfigurationBinding> = {}): ConfigurationBinding => ({
  service: "avia.aviacore",
  environment: "prod",
  variable: "AVIASUPP_ADDR",
  value: "http://aviasupp.srv.team",
  source: ".helm-ovh/configmap.prod.yaml:2",
  ...over,
});

describe("configuration bindings merge as environment-scoped facts", () => {
  it("collapses identical facts and keeps distinct environments", () => {
    const { catalog, conflicts } = mergeCatalogs([
      source("a.json", [binding()]),
      source("b.json", [binding(), binding({ environment: "dev", value: "http://aviasupp.dev.srv.team" })]),
    ]);

    expect(conflicts).toEqual([]);
    expect(catalog.configurationBindings).toEqual([
      binding({ environment: "dev", value: "http://aviasupp.dev.srv.team" }),
      binding(),
    ]);
  });

  it("reports two different values for the same service, environment and variable", () => {
    const { catalog, conflicts } = mergeCatalogs([
      source("a.json", [binding()]),
      source("b.json", [binding({ value: "http://other.srv.team", source: "values.prod.yaml:8" })]),
    ]);

    expect(catalog.configurationBindings).toEqual([binding()]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      path: "b.json",
      where: "avia.aviacore/prod/AVIASUPP_ADDR",
    });
  });
});
