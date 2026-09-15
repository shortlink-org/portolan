// What shown drafts add to the estate-wide pictures - a
// call across contexts on the context map, an event on the dependency graph.

import { createContext } from "react";
import type { CatalogIndex } from "../catalog";
import type { ContextRelation } from "../lib/context-map";
import type { EventGraph } from "../lib/event-graph";
import type { Draft } from "./model";

/** The ids of the map's links a draft added, with the branch each came from. */
export const DraftLinks = createContext<ReadonlyMap<string, string>>(new Map());

/** The context map's relationships with every link a shown draft adds laid in. */
export function withDraftLinks(
  relations: readonly ContextRelation[],
  drafts: readonly Draft[],
  index: CatalogIndex,
): { relations: ContextRelation[]; draftLinks: Map<string, string> } {
  const out: ContextRelation[] = structuredClone(relations as ContextRelation[]);
  const draftLinks = new Map<string, string>();
  const contextOf = (serviceId: string) => index.serviceContext.get(serviceId)?.id ?? null;

  for (const draft of drafts) {
    for (const entity of draft.entities) {
      for (const link of entity.newLinks ?? []) {
        const upstream = contextOf(link.from);
        const downstream = contextOf(link.to);
        if (!upstream || !downstream || upstream === downstream) continue;
        const [a, b] = [upstream, downstream].sort() as [string, string];
        let relation = out.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
        if (!relation) {
          relation = { a, b, id: `${a}~${b}`, dependencies: [], shared: [], patterns: [] };
          out.push(relation);
        }
        let dependency = relation.dependencies.find((d) => d.upstream === upstream && d.downstream === downstream);
        if (!dependency) {
          dependency = { upstream, downstream, links: [] };
          relation.dependencies.push(dependency);
        }
        dependency.links.push({ kind: link.kind, id: link.id, label: link.label, from: link.from, to: link.to, status: "declared" });
        draftLinks.set(link.id, draft.branch);
      }
    }
  }
  return { relations: out, draftLinks };
}

/** The dependency graph with every event a shown draft adds as a node of its own. */
export function withDraftEvents(graph: EventGraph, drafts: readonly Draft[], index: CatalogIndex): EventGraph {
  const events = [...graph.events];
  for (const draft of drafts) {
    for (const entity of draft.entities) {
      if (entity.kind !== "event" || entity.state !== "added" || !entity.parent) continue;
      const publisher = index.aggregateOwner.get(entity.parent)?.id;
      if (!publisher || events.some((e) => e.id === entity.id)) continue;
      events.push({ id: entity.id, name: entity.name, publisher, context: index.serviceContext.get(publisher)?.id ?? null, consumers: [] });
    }
  }
  const services = graph.services.map((service) => ({
    ...service,
    publishes: events.filter((event) => event.publisher === service.id).length,
  }));
  return { services, events };
}

/** How the graph marks what shown drafts did to its events: dashed for new, faded for removed. */
export function draftGraphCss(drafts: readonly Draft[]): string {
  const rules: string[] = [];
  for (const draft of drafts) {
    for (const entity of draft.entities) {
      if (entity.kind !== "event") continue;
      const selector = `.react-flow__node[data-id="event:${entity.id.replace(/"/g, '\\"')}"]`;
      if (entity.state === "added") {
        rules.push(`${selector} { outline: 2px dashed var(--status-verified); outline-offset: 4px; border-radius: 6px; }`);
      } else if (entity.state === "removed") {
        rules.push(`${selector} { opacity: 0.45; text-decoration: line-through; outline: 1px dashed var(--fg-muted); outline-offset: 4px; }`);
      } else {
        rules.push(`${selector} { outline: 2px dashed var(--accent); outline-offset: 4px; border-radius: 6px; }`);
      }
    }
  }
  return rules.join("\n");
}
