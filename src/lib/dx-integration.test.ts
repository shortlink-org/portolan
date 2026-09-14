import { describe, expect, it } from "vitest";
import { dxIntegrationModel, summarizeDxPlan } from "./dx-integration";
import type { SetupInfo } from "./setup-info";

it("summarizes a generated DX plan", () => {
  expect(summarizeDxPlan({
    version: 1,
    entities: [{ identifier: "shop.cart" }, { identifier: "shop.oms" }],
    relationEdges: [{ relation_identifier: "depends", edges: { "shop.cart": ["shop.oms"] } }],
  })).toEqual({ entities: 2, edges: 1, relations: 1 });
});

describe("DX integration state", () => {
  it("keeps source and catalog-specific export independent", () => {
    const setup = {
      projects: [], plugins: [], sources: [],
      steps: [
        { phase: "extract", plugin: "dx-source", input: ".", output: "vendor/dx" },
        { phase: "generate", plugin: "dx-export", catalog: "example", output: "exports/dx" },
        { phase: "generate", plugin: "dx-export", catalog: "other", output: "exports/other-dx" },
      ],
      run: {
        mode: "write", status: "ok", startedAt: "2026-09-14T00:00:00Z", finishedAt: "2026-09-14T00:00:01Z", durationMs: 1000,
        steps: [
          { ordinal: 0, phase: "extract", plugin: "dx-source", input: ".", output: "vendor/dx", status: "up-to-date", durationMs: 1, fileCount: 2, changedCount: 0, files: [], warnings: ["not fetched (offline); the snapshot is used"], diagnostics: [] },
          { ordinal: 1, phase: "generate", plugin: "dx-export", catalog: "example", output: "exports/dx", status: "up-to-date", durationMs: 1, fileCount: 1, changedCount: 0, files: ["exports/dx/plan.json"], warnings: [], diagnostics: [] },
        ],
      },
    } satisfies SetupInfo;

    const model = dxIntegrationModel(setup, "example");
    expect(model.sourceMode).toBe("snapshot");
    expect(model.export?.output).toBe("exports/dx");
    expect(model.exportRun?.files).toEqual(["exports/dx/plan.json"]);
  });
});
