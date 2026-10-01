// Where the estate's code was read and where its services run: the
// repository pins and the deployments, with the helpers that place a
// deployment on a service.

import type { Catalog } from "./catalog.ts";
import type { Service } from "./contexts.ts";

/**
 * A repository the estate was read at, and the commit it was read at.
 *
 * It exists so a source path can be a link when the code is not in this
 * repository. A service says which repository it lives in; only whoever
 * fetched that repository knows which commit the copy is of, and by the time
 * an extractor runs, that fact is in a lock file no page ever reads.
 *
 * It is a list on the catalog rather than a field on `Service` because the pin
 * is a fact about the estate and not about one service: a repository holding
 * three services is fetched once, at one commit, and writing that commit three
 * times would be three places for it to disagree with itself.
 */
export interface RepoPin {
  /** The repository, spelled the way `Service.repo` spells it: "github.com/acme/shop". */
  repo: string;
  /** The commit the copy was made of. Full sha: it is not resolved locally, so there is nothing to expand it against. */
  commit: string;
  /**
   * Where the fetched copy is in the workspace the catalog was generated in,
   * `vendor/repos/acme/shop`. A service of this repository spells its paths
   * from the repository; a reader on this machine - a README's images, a
   * local source preview, an editor link - finds the file under this.
   */
  path?: string;
}

/**
 * One place a service runs: an Argo CD Application, as the deployer listed
 * it, reduced to what a deploy changes.
 *
 * A list on the catalog rather than a field on `Service`, for two reasons.
 * The fetcher that writes it reads a control plane, not a service's tree, so
 * it does not know which service an Application is; the join is made where
 * the whole estate is known, by the repository and path the Application
 * deploys from against the ones a service says it lives at. And one service
 * stands in several places - staging, production, a second region - and
 * each is its own row.
 *
 * Nothing here moves without a deploy. Health, sync state and the time of
 * the last operation move on their own, and a page regenerated from the
 * tree cannot follow them; they are not kept.
 */
export interface Deployment {
  /** `<argocd namespace>/<application name>`: unique per control plane. */
  id: string;
  /** The Application's name, as `argocd app get` takes it. */
  name: string;
  /** The Argo CD project it belongs to. */
  project: string;
  /**
   * Where a reader would say it runs: the application's environment label,
   * else the cluster it deploys to. What the page groups by.
   */
  environment: string;
  /** The destination cluster, by its Argo CD name; `in-cluster` for the one Argo CD runs in. */
  cluster: string;
  /** The destination namespace. */
  namespace: string;
  /** The repository it deploys from, spelled the way `Service.repo` spells it. Empty for a chart from a registry. */
  repo: string;
  /** The directory in that repository the manifests are read from, as a reader would type it. Empty for a chart. */
  path: string;
  /** The Helm chart name, when the source is a chart registry rather than a repository. */
  chart?: string;
  /** What the Application tracks: a branch, a tag, a chart version. */
  targetRevision: string;
  /** What is deployed now: the commit, or chart version, the last sync resolved `targetRevision` to. */
  revision: string;
  /** `helm`, `kustomize`, `directory` or `plugin`, as Argo CD says it; empty until it has said. */
  tool: string;
  /** The Application in the Argo CD UI. */
  url: string;
  /**
   * The service it deploys, by id, when the Application's labels say so:
   * `app.kubernetes.io/part-of` and `app.kubernetes.io/name`, the same
   * labels a workload carries. A GitOps repository's Application points at
   * an overlay, not at the service's directory, so the path alone cannot
   * place it; the labels can, and an ApplicationSet stamps them on every
   * Application it makes. Absent when the labels are, and the path decides.
   */
  service?: string;
  /** The container images the deployed resources run, as the deployer summarised them, sorted. */
  images?: string[];
  /**
   * Who said so. `manifest` is a row an extractor read out of a GitOps
   * tree: what should run. `api` is a row a fetcher read off the deployer:
   * what does. `both` is one the merge folded from the two, which is the
   * ordinary case for an estate that keeps both, and the only one that can
   * carry drift. Absent reads as `api`, which is what every row was before
   * there were trees to read.
   */
  basis?: DeploymentBasis;
  /**
   * What the tree says where it and the deployer disagree, set by the merge
   * when both spoke (portolan.0013). A field is present only when the two
   * differ; a row with no drift has no field at all.
   */
  drift?: DeploymentDrift;
}

export type DeploymentBasis = "manifest" | "api" | "both";

export const DEPLOYMENT_BASES: readonly DeploymentBasis[] = [
  "manifest",
  "api",
  "both",
] as const;

/** The GitOps tree's word on the fields where the deployer says otherwise. */
export interface DeploymentDrift {
  project?: string;
  cluster?: string;
  namespace?: string;
  path?: string;
  targetRevision?: string;
  /** The images the overlay pins, when they are not the ones running. */
  images?: string[];
}

/** The basis a row carries, `api` when it carries none. */
export function deploymentBasis(deployment: Deployment): DeploymentBasis {
  return deployment.basis ?? "api";
}

/** Every repository the estate was read at. Absent means none, exactly as with modules. */
export function allRepos(catalog: Catalog): RepoPin[] {
  return catalog.repos ?? [];
}

/** Every place a service runs. Absent means none, exactly as with repos. */
export function allDeployments(catalog: Catalog): Deployment[] {
  return catalog.deployments ?? [];
}

/**
 * Whether a deployment is of this service. The labels decide when the
 * Application carries them: `service` is the id, and an Application
 * labelled for one service is not another's however its path reads. Without
 * labels, the path: the same repository, and the manifests read from inside
 * the service's directory - or from anywhere in the repository when the
 * service is the whole of it. An Application that matches nothing is a fact
 * for the Problems page rather than for a guess.
 */
export function deploys(deployment: Deployment, service: Service): boolean {
  if (deployment.service) return deployment.service === service.id;
  if (!deployment.repo || deployment.repo !== service.repo) return false;
  const root = service.path.replace(/^\/+|\/+$/g, "");
  if (!root) return true;
  return deployment.path === root || deployment.path.startsWith(`${root}/`);
}

/**
 * The environment a reader would say a deployment stands in: the one the
 * deployer named, else the cluster, else the one word that says neither was
 * said. Every picture and filter groups by this, so it is decided once.
 */
export function environmentOf(deployment: Deployment): string {
  return deployment.environment || deployment.cluster || "unplaced";
}

/** Where this service runs, in catalog order: the snapshot's, which is by id. */
export function deploymentsOf(catalog: Catalog, service: Service): Deployment[] {
  return allDeployments(catalog).filter((deployment) =>
    deploys(deployment, service),
  );
}
