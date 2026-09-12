// What the deployer runs that the catalog cannot place.
//
// The snapshot lists every Application the control plane manages, and the
// join to a service is by the repository and directory it deploys from
// (portolan.0012). An Application that matches nothing is one of three
// things: a service nobody has pointed an extractor at yet, a service whose
// `path` is spelled differently from where its manifests live, or something
// that is not a service at all - an ingress controller, a monitoring stack.
// The first two are worth a row; the third is noise a reviewed policy can
// hide. Nothing here decides which, because nothing here can.

import type { Catalog, Deployment } from "../catalog";
import { allDeployments, deploys } from "../catalog";
import type { Finding } from "./derive";

/** Where the Application deploys from, as the row's far end: the thing nobody claims. */
function deployedFrom(deployment: Deployment): string {
  if (deployment.chart && !deployment.path) return `chart ${deployment.chart}`;
  return [deployment.repo, deployment.path].filter(Boolean).join("/") || "?";
}

/** The fields the tree and the deployer disagree on, said in one line each. */
export function driftLines(deployment: Deployment): string[] {
  const drift = deployment.drift;
  if (!drift) return [];
  const lines: string[] = [];
  if (drift.project) lines.push(`project ${drift.project} in the tree, ${deployment.project} deployed`);
  if (drift.cluster) lines.push(`cluster ${drift.cluster} in the tree, ${deployment.cluster} deployed`);
  if (drift.namespace) lines.push(`namespace ${drift.namespace} in the tree, ${deployment.namespace} deployed`);
  if (drift.path) lines.push(`path ${drift.path} in the tree, ${deployment.path} deployed`);
  if (drift.targetRevision) {
    lines.push(`tracks ${drift.targetRevision} in the tree, ${deployment.targetRevision} deployed`);
  }
  if (drift.images?.length) {
    lines.push(`pins ${drift.images.join(", ")} in the tree; running ${(deployment.images ?? []).join(", ") || "nothing"}`);
  }
  return lines;
}

export function deployProblems(catalog: Catalog): Finding[] {
  const services = catalog.contexts.flatMap((context) => context.services);
  const out: Finding[] = [];
  for (const deployment of allDeployments(catalog)) {
    // The tree and the deployer disagree: what should run and what does
    // are two facts, and their difference is the one a reader came for.
    const lines = driftLines(deployment);
    if (lines.length > 0) {
      const owner = services.find((service) => deploys(deployment, service));
      const context = owner ? catalog.contexts.find((c) => c.services.includes(owner)) : undefined;
      out.push({
        kind: "deployment-drift",
        severity: "warning",
        context: context?.id ?? "",
        service: owner?.id ?? "",
        id: deployment.id,
        peer: deployment.environment,
        note: `${lines.join("; ")}. ${deployment.url}`,
        source: undefined,
      });
    }
    if (services.some((service) => deploys(deployment, service))) continue;
    out.push({
      kind: "deployment-unclaimed",
      severity: "warning",
      context: "",
      service: "",
      id: deployment.id,
      peer: deployedFrom(deployment),
      note: `${deployment.name} runs in ${deployment.environment || deployment.cluster || "an unnamed environment"}${deployment.namespace ? `, namespace ${deployment.namespace}` : ""}; ${
        deployment.service
          ? `its labels name ${deployment.service}, which is no service of the estate`
          : "if it is a service of the estate, its `path` should be a directory the Application's path is under, or the Application should carry app.kubernetes.io/part-of and app.kubernetes.io/name"
      }. ${deployment.url}`,
      source: undefined,
    });
  }
  return out;
}
