import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "./local-discovery.mjs";
import { projectRequestPlan } from "./local-api/projects.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-sdd-discovery-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "# Example\n");
  return root;
}

describe("SDD project discovery", () => {
  it("selects a standard OpenSpec layout without redundant options", () => {
    const root = workspace();
    const change = join(root, "openspec", "changes", "add-rate-limits");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, ".openspec.yaml"), "schema: spec-driven\n");

    const sdd = discoverProject(root, ".").detections.find(
      (item) => item.plugin === "sdd",
    );

    expect(sdd).toMatchObject({
      plugin: "sdd",
      confidence: "high",
      selected: true,
      evidence: "openspec/changes",
      options: {},
    });
    expect(sdd?.candidates).toEqual([
      "openspec/changes/add-rate-limits/.openspec.yaml",
    ]);
  });

  it("adds the selected SDD extractor to a project plan without user options", () => {
    const root = workspace();
    const change = join(root, "openspec", "changes", "add-rate-limits");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, ".openspec.yaml"), "schema: spec-driven\n");

    const { plan } = projectRequestPlan(
      root,
      { sources: ["portolan/*.json"], projects: [], extract: [] },
      {
        root: ".",
        id: "example",
        name: "Example",
        group: "example",
        component: "example",
        plugins: ["project"],
      },
    );

    expect(plan.steps.map((step) => step.plugin)).toEqual(["project", "sdd"]);
    expect(plan.steps[1]).toEqual({
      plugin: "sdd",
      in: ".",
      out: "portolan",
      options: { out: "sdd.json" },
    });
  });

  it("keeps an explicit SDD step instead of planning an implicit duplicate", () => {
    const root = workspace();
    const change = join(root, "openspec", "changes", "add-rate-limits");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, ".openspec.yaml"), "schema: spec-driven\n");
    const explicit = {
      plugin: "sdd",
      in: ".",
      out: "custom",
      options: { root: "openspec", out: "changes.json" },
    };

    const { plan } = projectRequestPlan(
      root,
      {
        sources: ["portolan/*.json"],
        projects: [],
        extract: [explicit],
      },
      {
        root: ".",
        id: "example",
        name: "Example",
        group: "example",
        component: "example",
        plugins: ["project"],
      },
    );

    expect(plan.steps.map((step) => step.plugin)).toEqual(["project"]);
  });

  it("does not detect an empty or malformed OpenSpec layout", () => {
    const empty = workspace();
    mkdirSync(join(empty, "openspec", "changes"), { recursive: true });
    expect(
      discoverProject(empty, ".").detections.some((item) => item.plugin === "sdd"),
    ).toBe(false);

    const malformed = workspace();
    const change = join(malformed, "openspec", "changes", "not-openspec");
    mkdirSync(change, { recursive: true });
    writeFileSync(join(change, ".openspec.yaml"), "schema: something-else\n");
    expect(
      discoverProject(malformed, ".").detections.some(
        (item) => item.plugin === "sdd",
      ),
    ).toBe(false);
  });
});
