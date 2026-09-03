// What happens after an event, as far as the flows can say.
//
// The event page lists who consumes an event. This module answers the next
// question - and then what? - by following each consumer into the flow where
// it is shown hearing the event, reading off what it publishes after that,
// and asking the same question of those events. Nothing here is a new fact:
// every hop is a consumer entry or a flow step the catalog already has, and
// each node links to the step it was read from.
//
// The chain hangs off the RECEIVING step, wherever it sits in a flow. The
// rail's "continues in" link only follows a flow that OPENS with the event,
// which is right for a handoff between two flows and wrong for this: in the
// hand-written estate no flow opens with an event, and OrderPlaced is heard at
// step 3 of one flow and step 14 of another.
//
// What a consumer publishes "after" hearing an event is read in walk order
// within the same flow. Walk order unions the branches of an alt, so a
// publish from a branch the receiving step is not on can appear here. That is
// the same approximation the flow tree makes when it asks "what does this flow
// touch", and the honest fix - restricting to one path - is a later question.

import type { Catalog, EdgeVia, Flow, Participant, Status, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { worstStatus } from "../lib/event-graph";

/** Why a branch stops short, and how much is not shown. */
export interface ChainCut {
  reason: "depth" | "cycle" | "budget";
  hidden: number;
}

interface ChainBase {
  /** Indentation level; the root event's consumers sit at 0. */
  depth: number;
  /** This node's own status: the consumer's, or the step's. */
  status: Status;
  /** Worst of this node and everything under it. */
  worst: Status;
  children: ChainNode[];
  cut?: ChainCut;
}

export type ChainNode = ChainBase &
  (
    | {
        kind: "consumer";
        service: string;
        context: string | null;
        /** False for a consumer no service in the catalog answers to. */
        known: boolean;
        via?: EdgeVia;
      }
    | {
        /** The step where the consumer is shown hearing the event. */
        kind: "receipt";
        flow: string;
        name: string;
        stepId: string;
        number: number;
      }
    | {
        /** An event the consumer publishes after hearing the one above. */
        kind: "event";
        id: string;
        name: string;
        publisher: string;
        context: string | null;
        flow: string;
        stepId: string;
        number: number;
      }
  );

export interface EventChain {
  root: string;
  nodes: ChainNode[];
  /** Nodes in the whole tree. */
  count: number;
  /** True when the node budget stopped the walk somewhere. */
  truncated: boolean;
}

export interface ChainOptions {
  /** Event hops below the root; a consumer, its receipt and what it publishes are one hop. */
  maxDepth?: number;
  maxNodes?: number;
}

export const CHAIN_DEPTH = 4;
export const CHAIN_BUDGET = 200;

interface Receipt {
  flow: Flow;
  steps: Step[];
  lanes: Map<string, Participant>;
  index: number;
}

export function eventChain(
  catalog: Catalog,
  eventId: string,
  opts: ChainOptions = {},
): EventChain {
  const maxDepth = opts.maxDepth ?? CHAIN_DEPTH;
  const maxNodes = opts.maxNodes ?? CHAIN_BUDGET;

  const serviceContext = new Map<string, string>();
  const events = new Map<
    string,
    { name: string; publisher: string; consumers: ChainConsumer[] }
  >();
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceContext.set(service.id, context.id);
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          events.set(event.id, {
            name: event.name,
            publisher: service.id,
            consumers: event.consumers,
          });
        }
      }
    }
  }

  // Every step where a service is shown hearing an event, by event.
  const receipts = new Map<string, Receipt[]>();
  for (const flow of catalog.flows) {
    const steps = walkSteps(flow.steps);
    const lanes = new Map(flow.participants.map((p) => [p.id, p]));
    steps.forEach((step, index) => {
      if (step.kind !== "event" || !step.ref || !events.has(step.ref)) return;
      if (step.from === step.to) return;
      if (lanes.get(step.to)?.kind !== "service") return;
      const list = receipts.get(step.ref) ?? [];
      list.push({ flow, steps, lanes, index });
      receipts.set(step.ref, list);
    });
  }

  let count = 0;
  let truncated = false;

  /** True when there is room for one more node; marks the cut otherwise. */
  const room = (parent: ChainBase | null, remaining: number): boolean => {
    if (count < maxNodes) {
      count += 1;
      return true;
    }
    truncated = true;
    if (parent && !parent.cut) parent.cut = { reason: "budget", hidden: remaining };
    return false;
  };

  const settle = (node: ChainBase): void => {
    node.worst = worstStatus([node.status, ...node.children.map((c) => c.worst)]);
  };

  const visit = (
    id: string,
    ancestors: Set<string>,
    hop: number,
    depth: number,
    parent: ChainBase | null,
  ): ChainNode[] => {
    const event = events.get(id);
    if (!event) return [];
    const out: ChainNode[] = [];

    event.consumers.forEach((consumer, i) => {
      if (!room(parent, event.consumers.length - i)) return;
      const node: ChainNode = {
        kind: "consumer",
        service: consumer.service,
        context: serviceContext.get(consumer.service) ?? null,
        known: serviceContext.has(consumer.service),
        ...(consumer.via ? { via: consumer.via } : {}),
        depth,
        status: consumer.status,
        worst: consumer.status,
        children: [],
      };
      out.push(node);

      const heard = (receipts.get(id) ?? []).filter(
        (r) => r.steps[r.index]?.to === consumer.service,
      );
      heard.forEach((receipt, j) => {
        if (!room(node, heard.length - j)) return;
        const step = receipt.steps[receipt.index]!;
        const rnode: ChainNode = {
          kind: "receipt",
          flow: receipt.flow.slug,
          name: receipt.flow.name,
          stepId: step.id,
          number: receipt.index + 1,
          depth: depth + 1,
          status: step.status,
          worst: step.status,
          children: [],
        };
        node.children.push(rnode);

        const published = publishedAfter(receipt, consumer.service, events);
        published.forEach(({ step: pub, index }, k) => {
          if (!room(rnode, published.length - k)) return;
          const ref = pub.ref!;
          const next = events.get(ref)!;
          const enode: ChainNode = {
            kind: "event",
            id: ref,
            name: next.name,
            publisher: next.publisher,
            context: serviceContext.get(next.publisher) ?? null,
            flow: receipt.flow.slug,
            stepId: pub.id,
            number: index + 1,
            depth: depth + 2,
            status: pub.status,
            worst: pub.status,
            children: [],
          };
          rnode.children.push(enode);

          if (ancestors.has(ref)) {
            enode.cut = { reason: "cycle", hidden: next.consumers.length };
          } else if (hop + 1 >= maxDepth) {
            if (next.consumers.length > 0)
              enode.cut = { reason: "depth", hidden: next.consumers.length };
          } else {
            enode.children = visit(
              ref,
              new Set([...ancestors, ref]),
              hop + 1,
              depth + 3,
              enode,
            );
          }
          settle(enode);
        });
        settle(rnode);
      });
      settle(node);
    });

    return out;
  };

  const nodes = visit(eventId, new Set([eventId]), 0, 0, null);
  return { root: eventId, nodes, count, truncated };
}

type ChainConsumer = { service: string; status: Status; via?: EdgeVia };

/**
 * The events a service publishes after a given step of a flow, in walk order,
 * first occurrence of each. Only the publisher's own events count: a service
 * relaying somebody else's event is a broker, and a broker is not a "then".
 */
function publishedAfter(
  receipt: Receipt,
  service: string,
  events: Map<string, { publisher: string }>,
): { step: Step; index: number }[] {
  const out: { step: Step; index: number }[] = [];
  const seen = new Set<string>();
  for (let i = receipt.index + 1; i < receipt.steps.length; i += 1) {
    const step = receipt.steps[i]!;
    if (step.kind !== "event" || !step.ref || step.from !== service) continue;
    if (step.to === step.from) continue;
    if (events.get(step.ref)?.publisher !== service) continue;
    if (seen.has(step.ref)) continue;
    seen.add(step.ref);
    out.push({ step, index: i });
  }
  return out;
}
