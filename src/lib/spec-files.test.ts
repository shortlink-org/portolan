import { describe, expect, it } from "vitest";
import { loaderFor } from "./spec-files";

const load = async () => "openapi: 3.0.3";

describe("loaderFor", () => {
  it("matches a catalog source against a glob key", () => {
    const specs = { "../../examples/auth/openapi.yaml": load };

    expect(loaderFor(specs, "examples/auth/openapi.yaml")).toBe(load);
  });

  it("answers nothing for a document this repository does not hold", () => {
    const specs = { "../../examples/auth/openapi.yaml": load };

    expect(loaderFor(specs, "examples/billing/openapi.yaml")).toBeNull();
  });

  // A document in another repository is the normal case for a real estate, and
  // an empty glob is what that looks like here.
  it("answers nothing when the repository holds none at all", () => {
    expect(loaderFor({}, "examples/auth/openapi.yaml")).toBeNull();
  });
});
