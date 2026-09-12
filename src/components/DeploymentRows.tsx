// Where a service runs, one row per Application the deployer lists for it.
//
// The environment is the row's identity: it is what a reader scans for -
// "is it in prod yet" - and what the snapshot groups by. The revision is the
// answer to the next question, "which commit", and is a link to the commit
// on the forge when it is one; a chart version is not, and is shown as it
// is. The application link opens the deployer's own page, which is where
// health and sync live: they move without a commit and are not kept here.

import { ExternalLink } from "lucide-react";
import type { Deployment } from "../catalog";
import { deploymentBasis } from "../catalog";
import { driftLines } from "../lib/deployment-drift";
import { Ident } from "./Ident";
import { RowActions } from "./RowActions";

/** The commit on the forge, when the revision is one and the repository is known. */
function commitHref(deployment: Deployment): string | null {
  if (!deployment.repo || !/^[0-9a-f]{40}$/.test(deployment.revision)) {
    return null;
  }
  const repo = `https://${deployment.repo}`;
  const view = repo.toLowerCase().includes("gitlab") ? "/-/commit/" : "/commit/";
  return `${repo}${view}${deployment.revision}`;
}

/** A commit shortened the way `git log --oneline` shortens it; anything else whole. */
function shortRevision(revision: string): string {
  return /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const href = commitHref(deployment);
  const where = [deployment.cluster, deployment.namespace]
    .filter(Boolean)
    .join(" / ");
  return (
    <div className="row items-start px-2 py-1.5">
      <span className="chip" title="the environment the application is placed in">
        {deployment.environment}
      </span>
      <span className="mono text-muted" title="cluster / namespace">
        {where}
      </span>
      <div className="min-w-0">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {deployment.revision ? (
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="mono text-ink hover:underline"
                title={`${deployment.revision} on the forge`}
              >
                {shortRevision(deployment.revision)}
              </a>
            ) : (
              <Ident value={deployment.revision}>
                {shortRevision(deployment.revision)}
              </Ident>
            )
          ) : (
            <span className="text-muted">not synced yet</span>
          )}
          {deployment.targetRevision ? (
            <span className="text-muted" title="what the application tracks">
              tracks {deployment.targetRevision}
            </span>
          ) : null}
          {deployment.tool ? (
            <span className="chip mono">{deployment.tool}</span>
          ) : null}
          {/* Who said so, when only the tree has: what should run, with
              nothing yet saying it does. A row both spoke for says nothing
              here - agreement is the ordinary case and needs no chip. */}
          {deploymentBasis(deployment) === "manifest" ? (
            <span
              className="chip status-declared"
              title="declared in the GitOps tree; the deployer has not been read for it"
            >
              declared
            </span>
          ) : null}
          {/* The tree and the deployer disagree. The chip carries the
              difference in words, so a reader does not have to open both. */}
          {driftLines(deployment).length > 0 ? (
            <span
              className="chip status-unresolved"
              title={driftLines(deployment).join("\n")}
            >
              drift
            </span>
          ) : null}
        </span>
        {deployment.images?.length ? (
          <ul className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {deployment.images.map((image) => (
              <li key={image}>
                <Ident value={image} className="text-muted">
                  {image}
                </Ident>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <a
        href={deployment.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-control text-accent hover:underline"
        title={`${deployment.name} in Argo CD, where its health and sync state are`}
      >
        {deployment.name}
        <ExternalLink size={12} aria-hidden />
      </a>
      <RowActions copy={deployment.name} label={deployment.name} />
    </div>
  );
}

export function DeploymentRows({ deployments }: { deployments: Deployment[] }) {
  return (
    <div className="rows grid-cols-[auto_auto_1fr_auto_auto]">
      {deployments.map((deployment) => (
        <DeploymentRow key={deployment.id} deployment={deployment} />
      ))}
    </div>
  );
}
