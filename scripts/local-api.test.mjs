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
    plugins: ["project", "go-domain", "openapi", "sql", "adr"].map((name) => ({ name, process: { command: "true" } })),
    extract: [],
  }, null, 2)}\n`);
  return root;
}

describe("local project setup", () => {
  it("detects project technologies without executing the project", () => {
    const root = workspace();
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.defaults).toEqual({ id: "billing", name: "Billing", group: "billing", component: "billing", context: "billing", service: "billing" });
    expect(discovery.detections.map((item) => item.plugin)).toEqual(["project", "openapi", "sql", "adr"]);
    expect(discovery.detections.find((item) => item.plugin === "openapi")?.options).toEqual({ spec: "api/openapi.yaml" });
    expect(discovery.detections.find((item) => item.plugin === "sql")?.options).toEqual({});
    expect(discovery.detections.find((item) => item.plugin === "adr")?.options).toEqual({});
    expect(discovery.detections.find((item) => item.plugin === "adr")?.selected).toBe(false);
  });

  it("only offers the Go domain extractor when the layout contains an aggregate root", () => {
    const root = workspace();
    mkdirSync(join(root, "services/billing/internal/domain/invoice"), { recursive: true });
    writeFileSync(join(root, "services/billing/internal/domain/invoice/invoice.go"), "package invoice\n\ntype Invoice struct{}\n");
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.map((item) => item.plugin)).toContain("go-domain");
    expect(discovery.detections.find((item) => item.plugin === "go-domain")?.evidence).toBe("internal/domain/invoice/invoice.go");
  });

  it("offers the River extractor when the Go module uses River", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/go.mod"), "module example.com/billing\nrequire github.com/riverqueue/river v0.26.0\n");
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "river", process: { command: "true" } });
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.find((item) => item.plugin === "river")).toMatchObject({ confidence: "high", evidence: "go.mod · github.com/riverqueue/river" });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "river"],
    });
    expect(plan.steps[1]).toMatchObject({ plugin: "river", options: { context: "finance", service: "billing", out: "river.json" } });
  });

  it("offers the Watermill extractor when the Go module uses Watermill", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/go.mod"), "module example.com/billing\nrequire github.com/ThreeDotsLabs/watermill v1.5.1\n");
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "watermill", process: { command: "true" } });
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.find((item) => item.plugin === "watermill")).toMatchObject({ confidence: "high", evidence: "go.mod · github.com/ThreeDotsLabs/watermill" });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "watermill"],
    });
    expect(plan.steps[1]).toMatchObject({ plugin: "watermill", options: { context: "finance", service: "billing", out: "watermill.json" } });
  });

  it("offers the HTTP client extractor when Go source makes outbound calls", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/client.go"), 'package billing\nimport "net/http"\nfunc call() { _, _ = http.Get("https://billing.example/health") }\n');
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "http-clients", process: { command: "true" } });
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.find((item) => item.plugin === "http-clients")).toMatchObject({
      confidence: "high",
      evidence: "client.go",
    });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "http-clients"],
    });
    expect(plan.steps[1]).toMatchObject({
      plugin: "http-clients",
      options: { context: "finance", service: "billing", out: "http-clients.json" },
    });
  });

  it("offers WSDL as an external contract when the project contains a SOAP client", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/client.go"), 'package billing\nimport soap "github.com/hooklift/gowsdl/soap"\nvar _ *soap.Client\n');
    writeFileSync(join(root, "services/billing/api/billing.wsdl"), '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"/>\n');
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "wsdl", process: { command: "true" } });
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.find((item) => item.plugin === "wsdl")).toMatchObject({
      confidence: "high",
      evidence: "api/billing.wsdl",
      options: { spec: "api/billing.wsdl", mode: "external" },
    });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "wsdl"],
    });
    expect(plan.steps[1]).toMatchObject({
      plugin: "wsdl",
      options: { context: "finance", service: "billing", spec: "api/billing.wsdl", mode: "external", out: "wsdl.json" },
    });
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
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", context: "", service: "", repository: "", plugins: ["project", "openapi", "proto"],
    });
    expect(plan.plugins).toEqual(["project", "openapi"]);
    expect(plan.source).toBe("services/billing/portolan/*.json");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      plugin: "project",
      options: { group: "finance", component: "billing", groupKind: "system", out: "project.json" },
    });
  });

  it("writes a validated manifest and rejects duplicate roots", () => {
    const root = workspace();
    const request = { root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", context: "", service: "", repository: "", plugins: ["project", "openapi"] };
    writeProject(root, request);
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(manifest.projects[0].id).toBe("billing");
    expect(manifest.sources).toContain("services/billing/portolan/*.json");
    expect(manifest.extract.map((step) => step.plugin)).toEqual(["project", "openapi"]);
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
    const request = { source: "external", root: "", repository, ref: "main", commit, sourcePath, id: "payments", name: "Payments", group: "payments", component: "payments", context: "", service: "", plugins: ["project"] };
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
