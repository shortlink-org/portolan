// Edges the flows already know.
//
// A flow step saying `bus -> payments.ledger : OrderPlaced` is the same fact as
// a consumer entry on the event, written in the other place. The extractors
// cannot put it on the event - a service's repository knows what the service
// hears, not who else listens to what it says - so after the merge the host
// reads it out of the steps and writes it where the graph, the Problems page
// and the generators look.
//
// Three rules keep this from inventing anything:
//
//  - A derived edge inherits the step's status and never becomes `verified`
//    on its own. A step nobody observed running gives an edge nobody observed.
//  - A declared edge wins. If a source already names the consumer or the call,
//    the step adds nothing; and between two flows implying the same edge, the
//    first in catalog order is the one recorded.
//  - A derived edge says where it came from. `via` names the flow and the step,
//    so a reader can tell "the service declares this" from "a flow shows it".

import type {
  Catalog,
  EdgeVia,
  EventConsumer,
  Flow,
  FlowNode,
  RpcCall,
  Service,
  Status,
  Step,
} from "./catalog";
// With the extension: scripts/catalog-sources.mjs runs this file under Node
// without a bundler, and Node resolves nothing it is not told.
import { walkSteps } from "./catalog.ts";

export interface DerivedEdge {
  kind: "consumer" | "rpc";
  /** Event id for a consumer, RpcCall id for a call. */
  ref: string;
  /** The consumer of the event, or the caller of the method. */
  service: string;
  /** rpc only: the step's `to`, the service the call was made to. */
  peer?: string;
  status: Status;
  via: EdgeVia;
}

export interface Enriched {
  catalog: Catalog;
  derived: DerivedEdge[];
}

/**
 * Returns a catalog whose consumers and calls include every edge its flows
 * imply, plus the list of what was added. Pure: the input is never written to,
 * and enriching twice yields the same catalog as enriching once.
 */
export function enrichCatalog(input: Catalog): Enriched {
  // A step naming an event by the name it travels under is resolved first, so
  // everything below - and every consumer derived from it - sees the event
  // rather than the name.
  const catalog = resolveForeignKeys(
    resolveWireNames(composeOutboundContinuations(input)),
  );

  const serviceById = new Map<string, Service>();
  const eventOwner = new Map<string, string>();
  const providedMethods = new Set<string>(); // "<provider>|<interface>/<method>"
  const declaredRpcIds = new Set<string>();
  const haveConsumer = new Set<string>(); // "<event>|<service>"
  const haveCall = new Set<string>(); // "<service>|<call>"

  // A system outside the estate answers on a contract too, and a step reaching
  // it on an operation its document declares is as resolvable as one reaching
  // a service of ours. Keyed by the external's id, which is what the lane says.
  for (const external of catalog.externals ?? []) {
    for (const provided of external.provides) {
      for (const method of provided.methods) {
        providedMethods.add(`${external.id}|${provided.id}/${method.name}`);
      }
    }
  }

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceById.set(service.id, service);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          providedMethods.add(`${service.id}|${provided.id}/${method.name}`);
        }
      }
      for (const call of service.consumes) {
        declaredRpcIds.add(call.id);
        haveCall.add(`${service.id}|${call.id}`);
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          eventOwner.set(event.id, service.id);
          for (const consumer of event.consumers) {
            haveConsumer.add(`${event.id}|${consumer.service}`);
          }
        }
      }
    }
  }

  const derived: DerivedEdge[] = [];
  const consumersFor = new Map<string, EventConsumer[]>();
  const callsFor = new Map<string, RpcCall[]>();

  for (const flow of catalog.flows) {
    const lanes = new Map(flow.participants.map((p) => [p.id, p]));

    for (const step of walkSteps(flow.steps)) {
      if (!step.ref) continue;
      const via: EdgeVia = { flow: flow.slug, step: step.id };

      if (step.kind === "event") {
        if (!eventOwner.has(step.ref)) continue;
        // A self-message is in-process; a broker, a store or an actor on the
        // receiving end is a publish, a write or a notification, none of
        // which is a service listening.
        if (step.from === step.to) continue;
        const lane = lanes.get(step.to);
        if (!lane) continue;
        if (lane.kind === "broker" || lane.kind === "store" || lane.kind === "actor")
          continue;

        const key = `${step.ref}|${step.to}`;
        if (haveConsumer.has(key)) continue;
        haveConsumer.add(key);

        const known = lane.kind === "service" && serviceById.has(step.to);
        const status: Status = known ? step.status : "unresolved";
        push(consumersFor, step.ref, { service: step.to, status, via });
        derived.push({ kind: "consumer", ref: step.ref, service: step.to, status, via });

        continue;
      }

      if (step.kind === "rpc") {
        // Only a service has a `consumes` list to put the call on.
        if (!serviceById.has(step.from)) continue;
        const key = `${step.from}|${step.ref}`;
        if (haveCall.has(key)) continue;

        // The call has to be resolvable before this pass. Derived calls feed
        // the validator's set of known call ids, and a call derived from a
        // step naming a method nobody provides would make that step its own
        // evidence.
        const provided = providedMethods.has(`${step.to}|${step.ref}`);
        if (!provided && !declaredRpcIds.has(step.ref)) continue;
        haveCall.add(key);

        const status: Status = provided ? step.status : "unresolved";
        push(callsFor, step.from, {
          id: step.ref,
          peer: step.to,
          status,
          source: flow.source ?? `flow:${flow.slug}`,
          via,
        });
        derived.push({
          kind: "rpc",
          ref: step.ref,
          service: step.from,
          peer: step.to,
          status,
          via,
        });
      }
    }
  }

  if (derived.length === 0) return { catalog, derived };

  const contexts = catalog.contexts.map((context) => ({
    ...context,
    services: context.services.map((service) => {
      const calls = callsFor.get(service.id);
      const touched =
        calls !== undefined ||
        service.aggregates.some((a) => a.events.some((e) => consumersFor.has(e.id)));
      if (!touched) return service;

      return {
        ...service,
        consumes: calls ? [...service.consumes, ...calls] : service.consumes,
        aggregates: service.aggregates.map((aggregate) => {
          if (!aggregate.events.some((e) => consumersFor.has(e.id))) return aggregate;

          return {
            ...aggregate,
            events: aggregate.events.map((event) => {
              const added = consumersFor.get(event.id);
              return added ? { ...event, consumers: [...event.consumers, ...added] } : event;
            }),
          };
        }),
      };
    }),
  }));

  return { catalog: { ...catalog, contexts }, derived };
}

/**
 * Joins an asynchronous entry flow to the outbound flow extracted from the
 * function it dispatches.
 *
 * Both sides carry a source function key. That is deliberately stronger than
 * matching display labels such as `Worker.Work`: two packages can use that
 * name, while `jobs/email:Worker.Work` names the code the extractor actually
 * entered. A duplicated entrypoint composes nothing rather than choosing one.
 */
function composeOutboundContinuations(input: Catalog): Catalog {
  const byEntry = new Map<string, Flow | null>();
  for (const flow of input.flows) {
    if (!flow.entrypoint) continue;
    byEntry.set(
      flow.entrypoint,
      byEntry.has(flow.entrypoint) ? null : flow,
    );
  }
  if (byEntry.size === 0) return input;

  const consumed = new Set<string>();
  let any = false;
  const flows = input.flows.map((flow) => {
    // Entrypoint flows are the continuations, never their own roots.
    if (flow.entrypoint) return flow;

    const additions: Flow[] = [];
    const steps = expandContinuations(flow.steps, (step) => {
      if (!step.continuesAt) return null;
      const continuation = byEntry.get(step.continuesAt);
      if (!continuation) return null;
      const entersService = continuation.participants.some(
        (participant) =>
          participant.id === step.to && participant.kind === "service",
      );
      if (!entersService || continuation.owner !== flow.owner) return null;
      additions.push(continuation);
      consumed.add(continuation.slug);
      return prefixFlowNodes(
        continuation.steps,
        `continuation-${continuation.slug}`,
      );
    });
    if (additions.length === 0) return flow;
    any = true;

    const participants = [...flow.participants];
    const seen = new Set(participants.map((participant) => participant.id));
    for (const continuation of additions) {
      for (const participant of continuation.participants) {
        if (seen.has(participant.id)) continue;
        seen.add(participant.id);
        participants.push(participant);
      }
    }
    return {
      ...flow,
      summary:
        flow.summary.replace(/\s*$/, "") +
        " Source-backed outbound continuation is included.",
      participants,
      steps,
    };
  });

  if (!any) return input;
  return {
    ...input,
    flows: flows.filter(
      (flow) => !flow.entrypoint || !consumed.has(flow.slug),
    ),
  };
}

function expandContinuations(
  nodes: FlowNode[],
  continuationOf: (step: Step) => FlowNode[] | null,
): FlowNode[] {
  const out: FlowNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "step": {
        out.push(node);
        const continuation = continuationOf(node);
        if (continuation) out.push(...continuation);
        break;
      }
      case "alt":
        out.push({
          ...node,
          branches: node.branches.map((branch) => ({
            ...branch,
            steps: expandContinuations(branch.steps, continuationOf),
          })),
        });
        break;
      case "parallel":
        out.push({
          ...node,
          branches: node.branches.map((branch) =>
            expandContinuations(branch, continuationOf),
          ),
        });
        break;
      case "loop":
        out.push({
          ...node,
          steps: expandContinuations(node.steps, continuationOf),
        });
        break;
    }
  }
  return out;
}

function prefixFlowNodes(nodes: FlowNode[], prefix: string): FlowNode[] {
  return nodes.map((node) => {
    const id = `${prefix}-${node.id}`;
    switch (node.type) {
      case "step":
        return { ...node, id };
      case "alt":
        return {
          ...node,
          id,
          branches: node.branches.map((branch) => ({
            ...branch,
            steps: prefixFlowNodes(branch.steps, prefix),
          })),
        };
      case "parallel":
        return {
          ...node,
          id,
          branches: node.branches.map((branch) =>
            prefixFlowNodes(branch, prefix),
          ),
        };
      case "loop":
        return { ...node, id, steps: prefixFlowNodes(node.steps, prefix) };
    }
  });
}

/**
 * Steps that name an event by the name it travels under, resolved to the event
 * that travels under it.
 *
 * An extractor can only resolve what its own repository declares. A policy
 * reacting to somebody else's message has the wire name and nothing else —
 * `ledger.PaymentAuthorized` — so the step names it, says `unresolved`, and
 * leaves the other end to the merge. This is where it arrives, and the match is
 * the one verify-otel already makes against a trace: the event whose wire name
 * that is, or failing that the one event whose wire name ends in that segment.
 * Two candidates resolve to neither, because a guess here would put a service
 * on somebody else's event.
 *
 * A resolved step becomes `declared` and never `verified`: reading a name in
 * source is a claim that it listens, not a record of it having listened.
 */
function resolveWireNames(catalog: Catalog): Catalog {
  const byWire = new Map<string, string>();
  const bySegment = new Map<string, string | null>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const wire = event.wire?.name;
          if (!wire) continue;
          if (!byWire.has(wire)) byWire.set(wire, event.id);
          const segment = wire.slice(wire.lastIndexOf(".") + 1);
          bySegment.set(segment, bySegment.has(segment) ? null : event.id);
        }
      }
    }
  }
  if (byWire.size === 0) return catalog;

  const resolve = (step: Step): Step => {
    if (step.kind !== "event" || step.ref || step.status !== "unresolved") return step;
    const named = step.label;
    if (!named) return step;
    const found = byWire.get(named) ?? bySegment.get(named) ?? null;
    if (!found) return step;

    return { ...step, ref: found, status: "declared" };
  };

  let any = false;
  const flows = catalog.flows.map((flow) => {
    let changed = false;
    const steps = mapSteps(flow.steps, (step) => {
      const resolved = resolve(step);
      changed ||= resolved !== step;

      return resolved;
    });
    any ||= changed;

    return changed ? { ...flow, steps } : flow;
  });

  return any ? { ...catalog, flows } : catalog;
}

/**
 * Foreign keys naming a table this store does not have, resolved against the
 * estate's other stores.
 *
 * A migration says `REFERENCES orders (id)`, and the extractor that read it
 * knows only the store it was reading: a key into another service's table
 * keeps the raw name, because no extractor sees two schemas. The merge sees
 * all of them, and a name exactly one table in the estate answers to is that
 * table - which is what turns a dangling key into the crossing it is, on the
 * page and on Problems. Two tables of that name resolve to neither.
 */
function resolveForeignKeys(catalog: Catalog): Catalog {
  const stores = catalog.stores ?? [];
  if (stores.length === 0) return catalog;

  const known = new Set<string>();
  const byName = new Map<string, string | null>();
  for (const store of stores) {
    for (const table of store.tables) {
      known.add(table.id);
      byName.set(table.name, byName.has(table.name) ? null : table.id);
    }
  }

  let any = false;
  const resolved = stores.map((store) => {
    let touched = false;
    const tables = store.tables.map((table) => {
      let changed = false;
      const columns = table.columns.map((column) => {
        if (!column.fk || known.has(column.fk.table)) return column;
        const found = byName.get(column.fk.table);
        if (!found) return column;
        changed = true;

        return { ...column, fk: { ...column.fk, table: found } };
      });
      touched ||= changed;

      return changed ? { ...table, columns } : table;
    });
    any ||= touched;

    return touched ? { ...store, tables } : store;
  });

  return any ? { ...catalog, stores: resolved } : catalog;
}

/** The same tree, with every step handed to `resolve`. */
function mapSteps(nodes: FlowNode[], resolve: (step: Step) => Step): FlowNode[] {
  return nodes.map((node) => {
    switch (node.type) {
      case "step":
        return resolve(node);
      case "alt":
        return {
          ...node,
          branches: node.branches.map((branch) => ({
            ...branch,
            steps: mapSteps(branch.steps, resolve),
          })),
        };
      case "parallel":
        return { ...node, branches: node.branches.map((branch) => mapSteps(branch, resolve)) };
      case "loop":
        return { ...node, steps: mapSteps(node.steps, resolve) };
    }
  });
}

function push<T>(into: Map<string, T[]>, key: string, item: T): void {
  const list = into.get(key);
  if (list) list.push(item);
  else into.set(key, [item]);
}
