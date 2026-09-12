// The fields the GitOps tree and the deployer disagree on, said in one line
// each. Read by the deployment rows on a service's page and by the
// `deployment` subject a rule sees, so the two say the same words.

import type { Deployment } from "../catalog";

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
