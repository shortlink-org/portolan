// The fetcher, against a recorded Argo CD. NEVER against a live one: the
// whole point of this plugin's design is that the build does not depend on
// a control plane being up, or on anyone holding a token.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPlugin } from "../plugin-host.mjs";
import { FRAGMENT_NAME, LIST_PATH, LOCK_NAME, OFFLINE_ENV, TOKEN_ENV, baseUrl, deploymentOf, run, toolOf } from "./fetch-argocd.mjs";

const REVISION = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

/** Two applications the way the API lists them, with everything a page must not keep. */
const CART = {
  metadata: { name: "shop-cart", namespace: "argocd", labels: { env: "prod", team: "shop" } },
  spec: {
    project: "shop",
    source: { repoURL: "https://github.com/shortlink-org/portolan.git", path: "./examples/shop/cart/deploy/k8s/", targetRevision: "main", kustomize: { namePrefix: "prod-" } },
    destination: { server: "https://kubernetes.default.svc", namespace: "shop" },
  },
  status: {
    sync: { status: "Synced", revision: REVISION },
    health: { status: "Healthy" },
    summary: { images: ["ghcr.io/shortlink-org/cart:1.4.2", "ghcr.io/shortlink-org/cart:1.4.2", "redis:7"] },
    sourceType: "Kustomize",
    operationState: { finishedAt: "2026-09-11T10:00:00Z" },
  },
};
const PRICING = {
  metadata: { name: "shop-pricing", namespace: "argocd" },
  spec: {
    project: "shop",
    sources: [
      { repoURL: "https://charts.example.com", chart: "service", targetRevision: "2.1.0", helm: { valueFiles: ["$values/pricing.yaml"], parameters: [{ name: "db.password", value: "hunter2" }] } },
      { repoURL: "git@github.com:shortlink-org/portolan.git", path: "examples/shop/pricing/deploy", targetRevision: "HEAD", ref: "values" },
    ],
    destination: { name: "eu-west-1", namespace: "shop" },
  },
  status: { sync: { revisions: ["2.1.0", REVISION] }, summary: { images: ["ghcr.io/shortlink-org/pricing:0.9.0"] } },
};

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Serves the one call the plugin makes, from recorded shapes. */
async function argocd(handle = null) {
  const seen = [];
  const urls = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.authorization ?? "");
    urls.push(request.url);
    if (handle) return handle(request, response);
    response.setHeader("Content-Type", "application/json");
    if (request.url.startsWith(LIST_PATH)) {
      response.end(JSON.stringify({ metadata: { resourceVersion: "12345" }, items: [PRICING, CART] }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found", code: 5, message: "no such route" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, urls };
}

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-fetch-argocd-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A test must never inherit a real credential or a real offline setting.
const isolated = { [TOKEN_ENV]: "", [OFFLINE_ENV]: "", CI: "" };
const options = (server, cacheDir, extra = {}) => ({ server, cache: cacheDir, ...extra });
const fetch = (opts, env = {}) => run({ options: opts }, { env: { ...isolated, ...env } });
const names = (response) => response.files.map((file) => file.name).sort();
const contentsOf = (response, name) => response.files.find((file) => file.name === name)?.contents ?? "";
const write = (dir, response) => {
  for (const file of response.files) {
    mkdirSync(dirname(join(dir, file.name)), { recursive: true });
    writeFileSync(join(dir, file.name), file.contents);
  }
};

describe("fetch-argocd", () => {
  it("writes the snapshot and a lock beside it, sorted, keeping what a deploy changes and nothing else", async () => {
    const server = await argocd();
    const response = await fetch(options(server.url, cache(), { projects: ["shop"] }));
    expect(names(response)).toEqual([FRAGMENT_NAME, LOCK_NAME]);
    expect(server.urls).toEqual([`${LIST_PATH}?projects=shop`]);

    const catalog = JSON.parse(contentsOf(response, FRAGMENT_NAME));
    expect(catalog).toMatchObject({ contexts: [], defs: {}, flows: [], adrs: [] });
    expect(catalog.deployments.map((d) => d.id)).toEqual(["argocd/shop-cart", "argocd/shop-pricing"]);
    expect(catalog.deployments[0]).toEqual({
      id: "argocd/shop-cart",
      name: "shop-cart",
      project: "shop",
      environment: "prod",
      cluster: "in-cluster",
      namespace: "shop",
      repo: "github.com/shortlink-org/portolan",
      path: "examples/shop/cart/deploy/k8s",
      targetRevision: "main",
      revision: REVISION,
      tool: "kustomize",
      url: `${server.url}/applications/argocd/shop-cart`,
      images: ["ghcr.io/shortlink-org/cart:1.4.2", "redis:7"],
    });
    // A multi-source application follows the source that carries the
    // manifests, and its cluster names the environment when no label does.
    expect(catalog.deployments[1]).toMatchObject({
      environment: "eu-west-1",
      cluster: "eu-west-1",
      repo: "github.com/shortlink-org/portolan",
      path: "examples/shop/pricing/deploy",
      targetRevision: "HEAD",
      revision: REVISION,
      tool: "helm",
    });
    expect(catalog.deployments[1].chart).toBeUndefined();
    // Nothing that moves without a commit, and no value, reaches the tree.
    const text = contentsOf(response, FRAGMENT_NAME);
    for (const leaked of ["Synced", "Healthy", "finishedAt", "hunter2", "namePrefix", "resourceVersion"]) expect(text).not.toContain(leaked);

    const lock = JSON.parse(contentsOf(response, LOCK_NAME));
    expect(lock).toEqual({
      server: server.url,
      applications: ["argocd/shop-cart", "argocd/shop-pricing"],
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    expect(response.warnings).toEqual([]);
  });

  it("asks with the projects, the selector and the token, and lets none of them reach the output", async () => {
    const server = await argocd();
    const anonymous = await fetch(options(server.url, cache()));
    const authorised = await fetch(options(server.url, cache(), { projects: ["shop", "platform"], selector: "team=shop" }), { [TOKEN_ENV]: "a-real-looking-secret" });
    expect(server.urls).toEqual([LIST_PATH, `${LIST_PATH}?projects=shop&projects=platform&selector=team%3Dshop`]);
    expect(server.seen).toEqual(["", "Bearer a-real-looking-secret"]);
    for (const file of anonymous.files) {
      expect(contentsOf(authorised, file.name)).toBe(file.contents);
      expect(contentsOf(authorised, file.name)).not.toContain("a-real-looking-secret");
    }
  });

  it("replays the committed snapshot offline, byte for byte, and in CI", async () => {
    const server = await argocd();
    const cacheDir = cache();
    const online = await fetch(options(server.url, cacheDir));
    write(cacheDir, online);

    const replayed = await fetch(options(server.url, cacheDir), { [OFFLINE_ENV]: "1" });
    expect(names(replayed)).toEqual(names(online));
    for (const file of online.files) expect(contentsOf(replayed, file.name)).toBe(file.contents);
    expect(replayed.warnings).toHaveLength(1);
    expect(replayed.warnings[0].message).toContain("not fetched (offline)");

    const inCi = await fetch(options(server.url, cacheDir), { CI: "true" });
    expect(names(inCi)).toEqual(names(online));
    expect(server.urls).toHaveLength(1);
  });

  it("names a snapshot edited by hand", async () => {
    const server = await argocd();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir)));
    writeFileSync(join(cacheDir, FRAGMENT_NAME), '{ "deployments": [] }\n');
    await expect(fetch(options(server.url, cacheDir), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/edited by hand/);
  });

  it("fails rather than emitting nothing when there is no snapshot to fall back to", async () => {
    await expect(fetch(options("http://127.0.0.1:1", cache()), { [OFFLINE_ENV]: "1" })).rejects.toThrow(/no argocd\.lock\.json/);

    const broken = await argocd((request, response) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "the control plane is having a day", code: 13 }));
    });
    await expect(fetch(options(broken.url, cache()))).rejects.toThrow(/the control plane is having a day.*no usable snapshot/);

    const empty = await argocd((request, response) => {
      response.end(JSON.stringify({ items: null }));
    });
    await expect(fetch(options(empty.url, cache()))).rejects.toThrow(/lists no applications/);
  });

  it("falls back to the committed snapshot when the server fails", async () => {
    const server = await argocd();
    const cacheDir = cache();
    const online = await fetch(options(server.url, cacheDir));
    write(cacheDir, online);

    const broken = await argocd((request, response) => {
      response.statusCode = 502;
      response.end();
    });
    const fallback = await fetch(options(broken.url, cacheDir));
    expect(names(fallback)).toEqual(names(online));
    expect(fallback.warnings[0].message).toMatch(/not fetched \(.*http 502\)/);
  });

  it("refuses a missing server and a missing cache", async () => {
    await expect(fetch(options("", cache()))).rejects.toThrow(/server/);
    await expect(fetch(options("argocd.example.com", ""))).rejects.toThrow(/cache/);
  });

  it("runs through the host like any plugin", async () => {
    const server = await argocd();
    const cacheDir = cache();
    write(cacheDir, await fetch(options(server.url, cacheDir)));
    const saved = { CI: process.env.CI, [OFFLINE_ENV]: process.env[OFFLINE_ENV] };
    process.env.CI = "";
    process.env[OFFLINE_ENV] = "1";
    try {
      const result = await runPlugin({ name: "argocd", host: "fetch-argocd" }, { portolanVersion: "0.1.0", options: options(server.url, cacheDir) });
      expect(result.files).toHaveLength(2);
      expect(result.warnings).toEqual([`${server.url}: not fetched (offline); the snapshot committed in this repository is used unchanged`]);
      const described = await runPlugin({ name: "argocd", host: "fetch-argocd" }, { portolanVersion: "0.1.0", kind: "describe" });
      expect(described.describe).toMatchObject({ name: "fetch-argocd", phases: ["extract"] });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("one application", () => {
  it("spells the server as a URL, https unless told otherwise", () => {
    expect(baseUrl("argocd.example.com")).toBe("https://argocd.example.com");
    expect(baseUrl("https://argocd.example.com/")).toBe("https://argocd.example.com");
    expect(baseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("reads the environment off the label the manifest names, else off the cluster", () => {
    const base = "https://argocd.example.com";
    expect(deploymentOf(CART, base, "env").environment).toBe("prod");
    expect(deploymentOf(CART, base, "tier").environment).toBe("in-cluster");
    expect(deploymentOf({ ...CART, spec: { ...CART.spec, destination: { server: "https://1.2.3.4", namespace: "x" } } }, base, "tier").environment).toBe("https://1.2.3.4");
  });

  it("infers the tool from the source until the status has said", () => {
    expect(toolOf("Kustomize", {})).toBe("kustomize");
    expect(toolOf("", { chart: "x" })).toBe("helm");
    expect(toolOf("", { helm: {} })).toBe("helm");
    expect(toolOf("", { kustomize: {} })).toBe("kustomize");
    expect(toolOf("", { plugin: {} })).toBe("plugin");
    expect(toolOf("", { directory: {} })).toBe("directory");
    expect(toolOf("", {})).toBe("");
  });

  it("refuses an application without a name, and defaults the namespace and project", () => {
    expect(() => deploymentOf({ metadata: {} }, "https://a")).toThrow(/no name/);
    expect(deploymentOf({ metadata: { name: "x" } }, "https://a")).toMatchObject({ id: "argocd/x", project: "default", tool: "", url: "https://a/applications/argocd/x" });
  });
});
