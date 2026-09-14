import { walkSteps } from "../catalog-model.ts";
import type { Catalog, WorkItem, WorkItemLink, WorkItemTarget } from "../catalog-model.ts";

export function workItemTargetKey(target: WorkItemTarget): string {
  return JSON.stringify([target.kind, target.kind === "step" ? target.flow : "", target.id]);
}

export function workItemLinkKey(link: WorkItemLink): string {
  return JSON.stringify([link.workItem, workItemTargetKey(link.target), link.basis]);
}

export function workItemTargetExists(catalog: Catalog, target: WorkItemTarget): boolean {
  if (!target || typeof target.id !== "string") return false;
  switch (target.kind) {
    case "flow": return catalog.flows.some((flow) => flow.id === target.id);
    case "service": return catalog.contexts.some((context) => context.services.some((service) => service.id === target.id));
    case "adr": return catalog.adrs.some((adr) => adr.id === target.id);
    case "rfc": return (catalog.rfcs ?? []).some((rfc) => rfc.id === target.id);
    case "step": return catalog.flows.some((flow) => flow.id === target.flow && walkSteps(flow.steps).some((step) => step.id === target.id));
    default: return false;
  }
}

/** The same task appears once even when several kinds of evidence associate it. */
export function relatedWorkItems(catalog: Catalog, target: WorkItemTarget): { item: WorkItem; links: WorkItemLink[] }[] {
  const key = workItemTargetKey(target);
  const links = (catalog.workItemLinks ?? []).filter((link) => workItemTargetKey(link.target) === key);
  return (catalog.workItems ?? []).flatMap((item) => {
    const related = links.filter((link) => link.workItem === item.id);
    return related.length ? [{ item, links: related }] : [];
  }).sort((a, b) => a.item.key.localeCompare(b.item.key, undefined, { numeric: true }) || a.item.id.localeCompare(b.item.id));
}

export function safeWorkItemUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
