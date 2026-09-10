import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { InitError, defaultAnswers, init, nextStep, toolchainFor } from "./init.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const created = [];

beforeAll(() => {
  process.env.PORTOLAN_SCHEMA = resolve(root, "schema/portolan.schema.json");
  process.env.PORTOLAN_INSTALL_ROOT = root;
});

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

function workspace(files) {
  const dir = mkdtempSync(join(tmpdir(), "portolan-init-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const quiet = { version: "0.0.0-test", log: () => {}, ask: { ...defaultAnswers, warn: () => {} } };
const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, "portolan.json"), "utf8"));
const goService = {
  "go.mod": "module example.com/orders\n\ngo 1.24\n",
  "internal/domain/order/order.go": "package order\n\ntype Order struct{ ID string }\n",
};

describe("init with defaults", () => {
  it("declares Go only for the typed HTTP client analyzer", () => {
    expect(toolchainFor("http-clients")).toMatchObject({ command: "go", label: "Go", missing: false });
    expect(toolchainFor("go-domain")).toBeNull();
  });

  it("prints runnable next commands with and without package scripts", () => {
    expect(nextStep(false, true)).toBe("Next: npm run architecture:gen && npm run architecture");
    expect(nextStep(true, true)).toBe("Generating; then: npm run architecture");
    expect(nextStep(false, false)).toBe("Next: npx @shortlink-org/portolan generate && npx @shortlink-org/portolan dev");
    expect(nextStep(true, false)).toBe("Generating; then: npx @shortlink-org/portolan dev");
  });

  it("reads what the repository contains into one project at the root", async () => {
    const dir = workspace({
      "package.json": '{"name":"@acme/order-service","scripts":{"test":"vitest"}}\n',
      ...goService,
      "api/openapi.yaml": "openapi: 3.0.0\ninfo:\n  title: Orders\n  version: '1'\npaths: {}\n",
      "docs/adr/0001-free-form.md": "# Not an ADR Portolan understands\n",
    });
    const result = await init(dir, quiet);
    const manifest = manifestOf(dir);

    expect(manifest.projects).toEqual([{ id: "order-service", name: "Order Service", root: ".", group: "order-service", component: "order-service" }]);
    expect(manifest.sources).toEqual(["portolan/*.json"]);
    expect(manifest.extract.map((step) => step.plugin)).toEqual(["project", "go-domain", "openapi"]);
    expect(manifest.extract.every((step) => step.in === "." && step.out === "portolan")).toBe(true);
    expect(manifest.extract[0].options).toMatchObject({ groupKind: "bounded-context", componentKind: "service" });
    expect(manifest.extract[2].options.spec).toBe("api/openapi.yaml");
    expect(manifest.generate.map((step) => step.plugin)).toEqual(["markdown", "mermaid"]);
    expect(result.generate).toBe(false);

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.scripts).toEqual({ test: "vitest", "architecture": "portolan dev", "architecture:gen": "portolan generate", "architecture:check": "portolan check", "architecture:build": "portolan build" });
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".portolan/\n");
  });

  it("turns nested build files into one project each when the root has none", async () => {
    const dir = workspace({
      "README.md": "# Estate\n",
      "services/orders/go.mod": goService["go.mod"],
      "services/orders/internal/domain/order/order.go": goService["internal/domain/order/order.go"],
      "services/web/package.json": '{"name":"web"}\n',
    });
    await init(dir, quiet);
    const manifest = manifestOf(dir);
    const repository = manifest.projects[0].group;

    expect(manifest.projects.map((project) => [project.id, project.root, project.component])).toEqual([
      ["orders", "services/orders", "orders"],
      ["web", "services/web", "web"],
    ]);
    expect(manifest.projects.every((project) => project.group === repository)).toBe(true);
    expect(manifest.sources).toEqual(["services/orders/portolan/*.json", "services/web/portolan/*.json"]);
    expect(manifest.extract.map((step) => [step.plugin, step.in])).toEqual([
      ["project", "services/orders"],
      ["go-domain", "services/orders"],
      ["project", "services/web"],
    ]);
  });

  it("keeps the root as the project when it has a build file of its own", async () => {
    const dir = workspace({
      "package.json": '{"name":"tool"}\n',
      "examples/demo/go.mod": goService["go.mod"],
    });
    await init(dir, quiet);
    expect(manifestOf(dir).projects.map((project) => project.root)).toEqual(["."]);
  });

  it("still writes a manifest for an empty directory", async () => {
    const dir = workspace({});
    await init(dir, quiet);
    const manifest = manifestOf(dir);
    expect(manifest.extract.map((step) => step.plugin)).toEqual(["project"]);
    expect(manifest.projects[0].root).toBe(".");
  });

  it("refuses to touch an existing manifest", async () => {
    const dir = workspace({ "portolan.json": "{}\n" });
    await expect(init(dir, quiet)).rejects.toThrow(InitError);
    expect(readFileSync(join(dir, "portolan.json"), "utf8")).toBe("{}\n");
  });
});

describe("init with answers", () => {
  it("writes only the roots, plugins and identity that were chosen", async () => {
    const dir = workspace({
      "README.md": "# Estate\n",
      "services/orders/go.mod": goService["go.mod"],
      "services/orders/internal/domain/order/order.go": goService["internal/domain/order/order.go"],
      "services/web/package.json": '{"name":"web"}\n',
    });
    const asked = [];
    const result = await init(dir, {
      ...quiet,
      ask: {
        ...quiet.ask,
        roots: (choices) => { asked.push(["roots", choices.map((choice) => [choice.path, choice.selected])]); return ["services/orders"]; },
        plugins: (root, detections) => { asked.push(["plugins", root, detections.map((detection) => detection.plugin)]); return ["project"]; },
        scripts: () => false,
        generate: () => true,
      },
    });
    const manifest = manifestOf(dir);

    expect(asked).toEqual([
      ["roots", [[".", false], ["services/orders", true], ["services/web", true]]],
      ["plugins", "services/orders", ["project", "go-domain"]],
    ]);
    expect(manifest.projects.map((project) => project.id)).toEqual(["orders"]);
    expect(manifest.extract.map((step) => step.plugin)).toEqual(["project"]);
    expect(result.generate).toBe(true);
  });

  it("uses the id the user typed for a single project", async () => {
    const dir = workspace({ "package.json": '{"name":"@acme/whatever"}\n' });
    await init(dir, {
      ...quiet,
      ask: { ...quiet.ask, identity: (defaults) => ({ ...defaults, id: "orders", name: "Orders", group: "orders", component: "orders" }) },
    });
    const manifest = manifestOf(dir);
    expect(manifest.projects[0]).toMatchObject({ id: "orders", name: "Orders" });
    expect(manifest.extract[0].options).toMatchObject({ group: "orders", component: "orders", componentName: "Orders" });
    expect(manifest.generate[0].options.title).toBe("Orders");
  });

  it("writes nothing when the user declines", async () => {
    const dir = workspace({ "package.json": '{"name":"x"}\n' });
    await expect(init(dir, { ...quiet, ask: { ...quiet.ask, write: () => false } })).rejects.toThrow(/cancelled/);
    expect(() => readFileSync(join(dir, "portolan.json"))).toThrow();
  });
});
