// The example GitOps tree, rendered the way Argo CD would render it.
//
// Every overlay under examples/gitops/envs/*/shop/* is built with kustomize
// - the binary when it is on the PATH, kubectl's copy otherwise - and what
// the environment says (the tag, the replica count, the variable) has to be
// what comes out. Then the tree is held to the snapshot in examples/argocd:
// an overlay that no Application in the snapshot deploys, or an Application
// pointing at a directory that is not here, is the two examples drifting
// apart, which is the one thing an example must not do.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const gitops = join(root, "examples", "gitops");

/** kustomize itself, else the copy kubectl ships; the output is the same. */
function kustomizeCommand() {
  for (const candidate of ["kustomize"]) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return [candidate, "build"];
    } catch {
      // Not on the PATH.
    }
  }
  return ["kubectl", "kustomize"];
}

const [command, ...args] = kustomizeCommand();
const build = (dir) => execFileSync(command, [...args, dir], { encoding: "utf8" });

/** `<env>/shop/<service>` for every overlay in the tree, sorted. */
function overlays() {
  const out = [];
  for (const env of readdirSync(join(gitops, "envs")).sort()) {
    const shop = join(gitops, "envs", env, "shop");
    if (!existsSync(shop)) continue;
    for (const service of readdirSync(shop).sort()) {
      if (existsSync(join(shop, service, "kustomization.yaml"))) out.push({ env, service, dir: join(shop, service) });
    }
  }
  return out;
}

describe("the example GitOps tree", () => {
  it("has an overlay for cart in both environments and pricing in prod only", () => {
    expect(overlays().map((o) => `${o.env}/${o.service}`)).toEqual(["prod/cart", "prod/pricing", "staging/cart"]);
  });

  it("renders cart in prod at the tag prod runs, three replicas, labelled with the environment", () => {
    const rendered = build(join(gitops, "envs", "prod", "shop", "cart"));
    expect(rendered).toContain("image: ghcr.io/shortlink-org/cart:2.1.0");
    expect(rendered).toContain("replicas: 3");
    expect(rendered).toContain("env: prod");
    expect(rendered).toContain("app.kubernetes.io/part-of: shop");
    // The base's names and namespace survive the overlay.
    expect(rendered).toMatch(/kind: Ingress[\s\S]*namespace: shop/);
  });

  it("renders cart in staging as the release candidate, one replica, NODE_ENV restated and nothing else lost", () => {
    const rendered = build(join(gitops, "envs", "staging", "shop", "cart"));
    expect(rendered).toContain("image: ghcr.io/shortlink-org/cart:2.2.0-rc.1");
    expect(rendered).toContain("replicas: 1");
    expect(rendered).toMatch(/name: NODE_ENV\n\s+value: staging/);
    // Merged by name: the other variables the base declares are still there.
    expect(rendered).toMatch(/name: PRICING_ADDR\n\s+value: pricing\.shop\.svc:9090/);
    expect(rendered).not.toContain("value: production");
  });

  it("renders pricing in prod with the longer cache and the secret untouched", () => {
    const rendered = build(join(gitops, "envs", "prod", "shop", "pricing"));
    expect(rendered).toContain("image: ghcr.io/shortlink-org/pricing:1.4.2");
    expect(rendered).toContain("PRICE_LIST_TTL: 1h");
    expect(rendered).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(rendered).toContain("kind: Secret");
  });

  it("is what the snapshot in examples/argocd was recorded from", () => {
    const snapshot = JSON.parse(readFileSync(join(root, "examples", "argocd", "argocd.apps.json"), "utf8"));
    const placed = snapshot.deployments.filter((d) => d.project === "shop");
    // One Application per overlay, named as the ApplicationSet names it,
    // pointing at the overlay, labelled onto the service.
    expect(placed.map((d) => [d.name, d.environment, d.path, d.service]).sort()).toEqual(
      overlays().map((o) => [`shop-${o.service}-${o.env}`, o.env, `examples/gitops/envs/${o.env}/shop/${o.service}`, `shop.${o.service}`]).sort(),
    );
    // The image the snapshot says runs is the image the overlay renders.
    for (const deployment of placed) {
      const rendered = build(join(root, deployment.path));
      for (const image of deployment.images ?? []) expect(rendered).toContain(`image: ${image}`);
    }
    // The clusters the environments name are the ones the snapshot places in.
    for (const { env } of overlays()) {
      const cluster = readFileSync(join(gitops, "envs", env, "cluster.yaml"), "utf8").match(/^\s+name: (.+)$/m)?.[1];
      for (const deployment of placed.filter((d) => d.environment === env)) expect(deployment.cluster).toBe(cluster);
    }
  });

  it("names every Application in the shop ApplicationSet with the labels the fetcher places by", () => {
    const appset = readFileSync(join(gitops, "appsets", "shop.yaml"), "utf8");
    expect(appset).toContain("app.kubernetes.io/part-of: shop");
    expect(appset).toContain('app.kubernetes.io/name: "{{.path.basename}}"');
    expect(appset).toContain('name: "shop-{{.path.basename}}-{{.env}}"');
    expect(appset).toContain("path: examples/gitops/envs/*/cluster.yaml");
  });
});
