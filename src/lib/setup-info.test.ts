import { describe, expect, it } from "vitest";
import { publicSetupFrom } from "./setup-info";

describe("publicSetupFrom", () => {
  it("publishes project usage without leaking commands or options", () => {
    const setup = publicSetupFrom({
      projects: [
        { id: "shop", name: "Shop", root: "services/shop/" },
        { id: "cart", name: "Cart", root: "services/shop/cart" },
      ],
      sources: ["services/*/portolan/*.json"],
      plugins: [
        {
          name: "domain",
          process: { command: "secret-command", args: ["--token"] },
        },
        { name: "docs", wasm: { url: "https://example.com/docs.wasm" } },
        { name: "unused", process: { command: "unused" } },
      ],
      extract: [
        {
          plugin: "domain",
          in: "services/shop/cart",
          out: "generated/cart",
          options: { token: "secret" },
        },
      ],
      generate: [{ plugin: "docs", out: "docs", options: { secret: true } }],
    });

    expect(setup.projects[1]?.root).toBe("services/shop/cart");
    expect(setup.steps[0]).toEqual({
      phase: "extract",
      plugin: "domain",
      input: "services/shop/cart",
      output: "generated/cart",
      projectId: "cart",
    });
    expect(setup.plugins).toEqual([
      {
        name: "domain",
        runtime: "process",
        phases: ["extract"],
        stepCount: 1,
        projectIds: ["cart"],
      },
      {
        name: "docs",
        runtime: "wasm",
        phases: ["generate"],
        stepCount: 1,
        projectIds: [],
      },
      {
        name: "unused",
        runtime: "process",
        phases: [],
        stepCount: 0,
        projectIds: [],
      },
    ]);
    expect(JSON.stringify(setup)).not.toContain("secret");
    expect(JSON.stringify(setup)).not.toContain("command");
  });

  it("turns malformed optional collections into an empty snapshot", () => {
    expect(publicSetupFrom({ projects: null, plugins: "no" })).toEqual({
      projects: [],
      plugins: [],
      steps: [],
      sources: [],
    });
  });
});
