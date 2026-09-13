import { walkSteps } from "../catalog";
import type { Catalog, Service } from "../catalog";
import type { ChainNode, EventChain } from "./chain";

export function commandAnchor(id: string): string {
  return `command-${id}`;
}

export function isCommandHash(hash: string, id: string): boolean {
  try { return decodeURIComponent(hash.slice(1)) === commandAnchor(id); }
  catch { return false; }
}

/** Unique known effects; a cut or missing evidence never means zero effects. */
export function commandSummary(chain: EventChain, owner: string) {
  const events = new Set<string>();
  const services = new Set<string>();
  let incomplete = chain.truncated || chain.nodes.length === 0;
  const visit = (nodes: ChainNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "event") {
        events.add(node.id);
        if (node.publisher !== owner) services.add(node.publisher);
      }
      if (node.kind === "consumer") {
        if (node.service !== owner) services.add(node.service);
        if (!node.known || !node.children.length) incomplete = true;
      }
      if ((node.kind === "execution" || node.kind === "receipt") && !node.children.length) incomplete = true;
      if (node.cut?.reason === "depth" || node.cut?.reason === "budget" || node.status === "unresolved") incomplete = true;
      visit(node.children);
    }
  };
  visit(chain.nodes);
  return { events: events.size, services: services.size, incomplete, unknown: events.size === 0 };
}

export interface CommandEntry {
  flow: string;
  stepId: string;
  label: string;
  source?: string;
}

/** Keep problematic rows and their ancestry so a filter never loses context. */
export function problemBranches(nodes: ChainNode[]): ChainNode[] {
  return nodes.flatMap((node) => {
    const gap = node.status === "unresolved" || node.cut?.reason === "budget" || node.cut?.reason === "depth" ||
      (node.kind === "consumer" && (!node.known || !node.children.length) && !node.cut) ||
      ((node.kind === "execution" || node.kind === "receipt") && !node.children.length && !node.cut);
    if (gap) return [node];
    const children = problemBranches(node.children);
    return children.length ? [{ ...node, children }] : [];
  });
}

/** Entry descriptions use the linked contract or the flow's recorded trigger. */
export function commandEntries(catalog: Catalog, service: Service, chain: EventChain): CommandEntry[] {
  return chain.nodes.flatMap((node) => {
    if (node.kind !== "execution") return [];
    const flow = catalog.flows.find((flow) => flow.slug === node.flow);
    if (!flow) return [];
    const steps = walkSteps(flow.steps);
    const step = steps.find((step) => step.id === node.stepId);
    if (!step) return [];
    let label: string;
    if (step.kind === "rpc") {
      const provided = service.provides.find((p) => p.methods.some((m) => `${p.id}/${m.name}` === step.ref));
      const method = provided?.methods.find((m) => `${provided.id}/${m.name}` === step.ref);
      const protocol = /\.proto(?::\d+)?$/.test(provided?.source ?? "") ? "gRPC" : method?.soap ? "SOAP" : "RPC";
      label = method?.http ? `${method.http.method} ${method.http.path}`.trim() : `${protocol} · ${step.ref}`;
      const caller = flow.participants?.find((participant) => participant.id === step.from);
      if (caller?.kind === "service") label += ` ← ${caller.label || caller.entityRef || caller.id}`;
    } else {
      const opening = steps[0];
      const trigger = flow.trigger;
      const eventName = opening?.kind === "event" ? opening.label || opening.ref : undefined;
      if (eventName) label = `Event · ${eventName}`;
      else if (trigger?.kind === "scheduled") label = `Schedule · ${trigger.label || flow.name}`;
      else if (trigger?.label) label = `${trigger.kind} · ${trigger.label}`;
      else label = `Internal call · ${step.label || flow.name}`;
    }
    return [{ flow: flow.slug, stepId: step.id, label, source: step.line }];
  });
}
