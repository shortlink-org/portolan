import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { discoverProject, planProject, writeProject } from "./local-api.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-local-api-"));
  roots.push(root);
  mkdirSync(join(root, "services/billing/docs/adr"), { recursive: true });
  mkdirSync(join(root, "services/billing/api"), { recursive: true });
  mkdirSync(join(root, "services/billing/migrations"), { recursive: true });
  writeFileSync(join(root, "services/billing/go.mod"), "module example.com/billing\n");
  writeFileSync(join(root, "services/billing/api/openapi.yaml"), "openapi: 3.1.0\n");
  writeFileSync(join(root, "services/billing/migrations/001.sql"), "create table invoices(id bigint);\n");
  writeFileSync(join(root, "services/billing/docs/adr/0001.md"), "# Store invoices\n");
  writeFileSync(join(root, "portolan.json"), `${JSON.stringify({
    sources: ["data/*.json"],
    projects: [],
    plugins: ["go-domain", "openapi", "sql", "adr"].map((name) => ({ name, process: { command: "true" } })),
    extract: [],
  }, null, 2)}\n`);
  return root;
}

describe("local project setup", () => {
  it("detects project technologies without executing the project", () => {
    const root = workspace();
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.defaults).toEqual({ id: "billing", name: "Billing", context: "billing", service: "billing" });
    expect(discovery.detections.map((item) => item.plugin)).toEqual(["go-domain", "openapi", "sql", "adr"]);
  });

  it("refuses paths that escape through a symlink", () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "portolan-outside-"));
    roots.push(outside);
    symlinkSync(outside, join(root, "services/external"));
    expect(() => discoverProject(root, "services/external")).toThrow(/outside this repository/);
  });

  it("only plans detected plugins declared by the manifest", () => {
    const root = workspace();
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", context: "finance", service: "billing", repository: "", plugins: ["go-domain", "openapi", "proto"],
    });
    expect(plan.plugins).toEqual(["go-domain", "openapi"]);
    expect(plan.source).toBe("services/billing/portolan/*.json");
    expect(plan.steps).toHaveLength(2);
  });

  it("writes a validated manifest and rejects duplicate roots", () => {
    const root = workspace();
    const request = { root: "services/billing", id: "billing", name: "Billing", context: "finance", service: "billing", repository: "", plugins: ["go-domain", "openapi"] };
    writeProject(root, request);
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(manifest.projects[0].id).toBe("billing");
    expect(manifest.sources).toContain("services/billing/portolan/*.json");
    expect(manifest.extract.map((step) => step.plugin)).toEqual(["go-domain", "openapi"]);
    expect(() => writeProject(root, { ...request, id: "another" })).toThrow(/already exists/);
  });
});
