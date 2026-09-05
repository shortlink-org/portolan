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

  it("claims the sandbox only for a plugin that declares a module", () => {
    const setup = publicSetupFrom({
      plugins: [
        { name: "real", wasm: { url: "file://gen.wasm" } },
        { name: "null", wasm: null },
        { name: "bare", wasm: true },
        { name: "half", wasm: {} },
      ],
    });

    expect(setup.plugins.map((plugin) => plugin.runtime)).toEqual([
      "wasm",
      "process",
      "process",
      "process",
    ]);
  });

  it("publishes a repository only as a page a browser can open", () => {
    const setup = publicSetupFrom({
      projects: [
        { id: "a", name: "A", root: "a", repository: "git@github.com:org/a.git" },
        { id: "b", name: "B", root: "b", repository: "https://example.com/b/" },
        { id: "c", name: "C", root: "c", repository: "javascript:alert(1)" },
        { id: "d", name: "D", root: "d" },
      ],
    });

    expect(setup.projects.map((project) => project.repository)).toEqual([
      "https://github.com/org/a",
      "https://example.com/b",
      undefined,
      undefined,
    ]);
  });

  it("turns malformed optional collections into an empty snapshot", () => {
    expect(publicSetupFrom({ projects: null, plugins: "no" })).toEqual({
      projects: [],
      plugins: [],
      steps: [],
      sources: [],
    });
  });

  it("publishes a matching build report without plugin error details", () => {
    const setup = publicSetupFrom(
      {
        projects: [{ id: "shop", name: "Shop", root: "services/shop" }],
        plugins: [{ name: "domain", process: { command: "private" } }],
        extract: [
          { plugin: "domain", in: "services/shop", out: "data/shop" },
        ],
      },
      {
        version: 1,
        manifestSha256: "current",
        mode: "check",
        status: "failed",
        startedAt: "2026-09-05T00:00:00.000Z",
        finishedAt: "2026-09-05T00:00:01.000Z",
        durationMs: 1000,
        error: "secret token",
        steps: [
          {
            ordinal: 0,
            phase: "extract",
            plugin: "domain",
            input: "services/shop",
            output: "data/shop",
            status: "failed",
            durationMs: 12,
            fileCount: 0,
            changedCount: 0,
            files: ["data/shop/catalog.json", "../../private-key"],
            error: "secret token",
          },
        ],
      },
      "current",
    );

    expect(setup.run?.steps[0]).toMatchObject({
      projectId: "shop",
      plugin: "domain",
      status: "failed",
      files: ["data/shop/catalog.json"],
    });
    expect(JSON.stringify(setup)).not.toContain("secret token");
    expect(JSON.stringify(setup)).not.toContain("private-key");
  });

  it("marks a report for another manifest as stale", () => {
    const setup = publicSetupFrom(
      {},
      {
        version: 1,
        manifestSha256: "old",
        mode: "write",
        status: "ok",
        startedAt: "2026-09-05T00:00:00.000Z",
        finishedAt: "2026-09-05T00:00:01.000Z",
        durationMs: 1000,
        steps: [],
      },
      "current",
    );

    expect(setup.run).toBeUndefined();
    expect(setup.reportStale).toBe(true);
  });
});
