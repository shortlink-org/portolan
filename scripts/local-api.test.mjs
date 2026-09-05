import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { diffGeneratedFiles, discoverProject, inspectionRoot, planProject, writeProject } from "./local-api.mjs";

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
    expect(discovery.detections.find((item) => item.plugin === "openapi")?.options).toEqual({ spec: "api/openapi.yaml" });
    expect(discovery.detections.find((item) => item.plugin === "sql")?.options).toEqual({});
    expect(discovery.detections.find((item) => item.plugin === "adr")?.options).toEqual({ files: ["docs/adr/*.md"] });
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

  it("plans a pinned external repository through the built-in git fetcher", () => {
    const root = workspace();
    const repository = "https://github.com/acme/platform.git";
    const commit = "a".repeat(40);
    const sourcePath = "services/payments";
    const inspected = join(root, inspectionRoot(repository, commit, sourcePath));
    mkdirSync(inspected, { recursive: true });
    writeFileSync(join(inspected, "go.mod"), "module github.com/acme/platform/services/payments\n");
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "git", process: { command: "true" } });
    writeFileSync(join(root, "portolan.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const request = { source: "external", root: "", repository, ref: "main", commit, sourcePath, id: "payments", name: "Payments", context: "payments", service: "payments", plugins: ["go-domain"] };
    const plan = planProject(root, manifest, request);
    expect(plan.project.root).toBe("vendor/repos/acme/platform/services/payments");
    expect(plan.fetch).toEqual({ repo: repository, commit, paths: [sourcePath] });
    expect(plan.steps[0].options.repo).toBe("github.com/acme/platform");
    writeProject(root, request);
    const written = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(written.extract[0].plugin).toBe("git");
    expect(written.sources).toContain("vendor/repos/*/*/git.repo.json");
  });

  it("renders generated file additions and changes without touching the workspace", () => {
    const root = workspace();
    const snapshot = mkdtempSync(join(tmpdir(), "portolan-preview-snapshot-"));
    roots.push(snapshot);
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(snapshot, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/service.md"), "before\n");
    writeFileSync(join(snapshot, "docs/service.md"), "after\n");
    writeFileSync(join(snapshot, "docs/new.md"), "new\n");
    const result = diffGeneratedFiles(root, snapshot, [{ type: "step-finished", changes: [{ kind: "changed", path: "docs/service.md" }, { kind: "added", path: "docs/new.md" }] }]);
    expect(result.totalFiles).toBe(2);
    expect(result.files[0].diff).toContain("diff --git a/docs/service.md b/docs/service.md");
    expect(result.files[0].diff).toContain("-before");
    expect(result.files[0].diff).toContain("+after");
    expect(result.files[1]).toMatchObject({ path: "docs/new.md", status: "added" });
    expect(readFileSync(join(root, "docs/service.md"), "utf8")).toBe("before\n");
  });
});
