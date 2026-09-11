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
import type { Problem } from "./derive";

/** Where the Application deploys from, as the row's far end: the thing nobody claims. */
function deployedFrom(deployment: Deployment): string {
  if (deployment.chart && !deployment.path) return `chart ${deployment.chart}`;
  return [deployment.repo, deployment.path].filter(Boolean).join("/") || "?";
}

export function deployProblems(catalog: Catalog): Problem[] {
  const services = catalog.contexts.flatMap((context) => context.services);
  const out: Problem[] = [];
  for (const deployment of allDeployments(catalog)) {
    if (services.some((service) => deploys(deployment, service))) continue;
    out.push({
      kind: "deployment-unclaimed",
      severity: "warning",
      context: "",
      service: "",
      id: deployment.id,
      peer: deployedFrom(deployment),
      note: `${deployment.name} runs in ${deployment.environment || deployment.cluster || "an unnamed environment"}${deployment.namespace ? `, namespace ${deployment.namespace}` : ""}; if it is a service of the estate, its \`path\` should be a directory the Application's path is under. ${deployment.url}`,
      source: undefined,
    });
  }
  return out;
}
