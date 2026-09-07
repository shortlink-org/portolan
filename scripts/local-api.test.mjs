import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { diffGeneratedFiles, discoverProject, inspectionRoot, planProject, readLocalSource, summarizeProjectTrial, writeProject } from "./local-api.mjs";

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
  it("reads UTF-8 source inside the workspace", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/client.go"), "package billing\n");
    expect(readLocalSource(root, "services/billing/client.go")).toEqual({
      path: "services/billing/client.go",
      content: "package billing\n",
    });
  });

  it("refuses local source traversal, symlink escape, binary files, and large files", () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "portolan-source-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.go"), "secret\n");
    symlinkSync(join(outside, "secret.go"), join(root, "escape.go"));
    writeFileSync(join(root, "binary.go"), Buffer.from([1, 0, 2]));
    writeFileSync(join(root, "large.go"), Buffer.alloc(1024 * 1024 + 1, 65));
    expect(() => readLocalSource(root, "../secret.go")).toThrow(/inside this repository/);
    expect(() => readLocalSource(root, "escape.go")).toThrow(/outside this repository/);
    expect(() => readLocalSource(root, "binary.go")).toThrow(/binary/);
    expect(() => readLocalSource(root, "large.go")).toThrow(/1 MB/);
  });

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

  it("finds component roots in a monorepo without reading dependency directories", () => {
    const root = workspace();
    mkdirSync(join(root, "services/orders"), { recursive: true });
    mkdirSync(join(root, "apps/storefront"), { recursive: true });
    mkdirSync(join(root, "node_modules/ignored"), { recursive: true });
    mkdirSync(join(root, ".worktrees/ignored"), { recursive: true });
    mkdirSync(join(root, "services/orders/testdata/ignored"), { recursive: true });
    writeFileSync(join(root, "services/orders/go.mod"), "module example.com/orders\n");
    writeFileSync(join(root, "apps/storefront/package.json"), "{}\n");
    writeFileSync(join(root, "node_modules/ignored/package.json"), "{}\n");
    writeFileSync(join(root, ".worktrees/ignored/package.json"), "{}\n");
    writeFileSync(join(root, "services/orders/testdata/ignored/go.mod"), "module example.com/ignored\n");
    const discovery = discoverProject(root, ".");
    expect(discovery.components).toEqual([
      { path: "apps/storefront", name: "Storefront", markers: ["package.json"], technologies: ["Node.js"] },
      { path: "services/billing", name: "Billing", markers: ["go.mod"], technologies: ["Go"] },
      { path: "services/orders", name: "Orders", markers: ["go.mod"], technologies: ["Go"] },
    ]);
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

  it("offers the Redis extractor only when Go source constructs a supported client", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/go.mod"), "module example.com/billing\nrequire github.com/redis/go-redis/v9 v9.19.0\n");
    writeFileSync(join(root, "services/billing/cache.go"), 'package billing\nimport cachev9 "github.com/redis/go-redis/v9"\nfunc connect() { _ = cachev9.NewClient(&cachev9.Options{}) }\n');
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "redis", process: { command: "true" } });
    const discovery = discoverProject(root, "services/billing");
    expect(discovery.detections.find((item) => item.plugin === "redis")).toMatchObject({
      confidence: "high",
      evidence: "cache.go",
    });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "redis"],
    });
    expect(plan.steps[1]).toMatchObject({
      plugin: "redis",
      options: { context: "finance", service: "billing", store: "redis", out: "redis.json" },
    });

    writeFileSync(join(root, "services/billing/cache.go"), "package billing\n");
    expect(discoverProject(root, "services/billing").detections.map((item) => item.plugin)).not.toContain("redis");
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

  it("passes the selected group to the glossary extractor", () => {
    const root = workspace();
    writeFileSync(join(root, "services/billing/GLOSSARY.md"), "# Glossary\n\n## Invoice\nA bill.\n");
    const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.plugins.push({ name: "glossary", process: { command: "true" } });
    const plan = planProject(root, manifest, {
      root: "services/billing", id: "billing", name: "Billing", group: "finance", component: "billing", repository: "", plugins: ["project", "glossary"],
    });
    expect(plan.steps.find((step) => step.plugin === "glossary")?.options).toMatchObject({
      context: "finance",
      files: ["GLOSSARY.md"],
      out: "glossary.json",
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

  it("summarises catalog facts and warnings from the selected project extractors", () => {
    const root = workspace();
    mkdirSync(join(root, "services/billing/portolan"), { recursive: true });
    writeFileSync(join(root, "services/billing/portolan/api.json"), JSON.stringify({
      contexts: [{
        id: "finance",
        services: [{
          id: "finance.billing",
          provides: [{ id: "billing.v1", methods: [{ name: "charge" }, { name: "refund" }] }],
          consumes: [{ id: "ledger.v1/post", peer: "finance.ledger" }],
          channels: [{ address: "billing.events", messages: [{ name: "charged" }] }],
        }],
      }],
      flows: [{ id: "billing-charge" }],
    }));
    writeFileSync(join(root, "services/billing/portolan/redis.json"), JSON.stringify({
      contexts: [{ id: "finance", services: [{ id: "finance.billing" }] }],
      stores: [{ id: "finance.billing.redis", keyspaces: [{ pattern: "invoice:{id}" }, { pattern: "payment:{id}" }] }],
    }));
    const output = "services/billing/portolan";
    const result = summarizeProjectTrial(root, {
      plugins: ["openapi", "redis"],
      steps: [{ plugin: "openapi", out: output }, { plugin: "redis", out: output }],
    }, [
      { type: "step-finished", phase: "extract", plugin: "openapi", output, status: "written", durationMs: 4, fileCount: 1, changedCount: 1, files: [`${output}/api.json`], warnings: ["one route has no description"] },
      { type: "step-finished", phase: "extract", plugin: "redis", output, status: "written", durationMs: 3, fileCount: 1, changedCount: 1, files: [`${output}/redis.json`], warnings: [] },
      { type: "step-finished", phase: "generate", plugin: "markdown", output: "docs", status: "written", durationMs: 2, fileCount: 10, changedCount: 10, files: ["docs/index.md"], warnings: [] },
    ]);
    expect(Object.fromEntries(result.facts.map((fact) => [fact.key, fact.count]))).toMatchObject({
      contexts: 1,
      services: 1,
      contracts: 1,
      apiOperations: 2,
      integrations: 1,
      channels: 1,
      messages: 1,
      stores: 1,
      keyPatterns: 2,
      flows: 1,
    });
    expect(result.steps.map((step) => step.plugin)).toEqual(["openapi", "redis"]);
    expect(result.warnings).toEqual([{ plugin: "openapi", message: "one route has no description" }]);
    expect(result.generatedFiles).toBe(2);
  });
});
