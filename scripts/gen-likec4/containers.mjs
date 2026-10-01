// Level 2, shared by the estate's container view and each context's: one
// labelled arrow per pair of containers, the consumer arrows the bus already
// carries, compact cards, transport labels and queue ranks.

import { counted, protocolOf, q, safeId, withVerb } from "./ids.mjs";
import { STATUS_LINE, STATUS_RANK } from "./specification.mjs";

/** The folded call pairs, and the predicates a container view is built from. */
export function containerHelpers(g) {
  const { catalog, fqn, participantRef, peerParticipant, storesByOwner, brokerIds, busEdges, busLabel } = g;
  // --- one arrow per pair of containers --------------------------------------
  // The model keeps one relation per method, which is what the neighbours view
  // and the flows are about. A container diagram is about which boxes talk and
  // over what, and LikeC4 folds a pair's relations into one edge on its own but
  // labels it `[...]`. The fold is given a label here, once per pair: the
  // count and protocol when evidence is uniform. Mixed pairs stay separate.
  const callPairs = new Map(); // "from|to" -> { from, to, methods:[], protocols:Set, status }
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const call of service.consumes) {
        const peer = peerParticipant(call.peer);
        if (!peer) continue;
        const key = `${service.id}|${peer}`;
        const pair = callPairs.get(key) ?? {
          from: service.id,
          to: peer,
          methods: [],
          protocols: new Set(),
          statuses: new Set(),
          status: "unresolved",
        };
        pair.methods.push(call.id.split("/").pop() ?? call.id);
        pair.statuses.add(call.status);
        const protocol = protocolOf(call.source);
        pair.protocols.add(protocol);
        if (STATUS_RANK[call.status] < STATUS_RANK[pair.status])
          pair.status = call.status;
        callPairs.set(key, pair);
      }
    }
  }

  /** The `include a -> b with { … }` line that labels one pair's folded edge. */
  function pairEdge(pair) {
    // A mixed pair stays separate: a verified HTTP call must not lend its
    // appearance to a declared gRPC call or to an event between the same nodes.
    const target = `${participantRef(pair.from)} -> ${participantRef(pair.to)} where kind is calls`;
    if (pair.statuses.size > 1 || pair.protocols.size > 1) {
      // Drawn one relation per edge, each under its own `calls <method>`.
      return `include ${target} with { multiple true }`;
    }
    const title = pair.methods.length === 1 ? withVerb("calls", pair.methods[0]) : counted("calls", pair.methods.length, "method");
    const technology = [...pair.protocols].sort().join(" · ");
    const props = [
      `title ${q(title)}`,
      technology ? `technology ${q(technology)}` : "",
      `color ${pair.status}`,
      `line ${STATUS_LINE[pair.status]}`,
    ].filter(Boolean);
    return `include ${target} with { ${props.join("  ")} }`;
  }

  // A consumer arrow the bus already carries: the publisher's hop onto a broker
  // and that broker's hop to the consumer are both drawn, so the arrow that
  // skips the broker would say the same thing twice. One that is not carried —
  // a consumer no flow has walked to — stays, as the only sign it listens.
  const carriedByBus = []; // [publisher, consumer]
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      const consumers = new Map();
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            const names = consumers.get(consumer.service) ?? new Set();
            names.add(event.name);
            consumers.set(consumer.service, names);
          }
        }
      }
      consumers.delete(service.id);
      for (const [consumer, names] of consumers) {
        // A shared broker alone does not prove it carries THIS event. Every
        // omitted consumer fact must remain represented by both transport hops.
        const via = [...names].every((name) => [...brokerIds].some((broker) =>
          busEdges.get(`${service.id}|${broker}`)?.labels.has(name) &&
          busEdges.get(`${broker}|${consumer}`)?.labels.has(name),
        ));
        if (via) carriedByBus.push([service.id, consumer]);
      }
    }
  }

  /**
   * The level-2 predicates shared by the estate's container view and each
   * context's: the folded call edges, then the consumer arrows the bus carries
   * taken away.
   */
  function containerPredicates(pairs, carried, indent) {
    return [
      ...pairs.map((pair) => `${indent}${pairEdge(pair)}`),
      ...carried.map(
        ([from, to]) =>
          `${indent}exclude ${participantRef(from)} -> ${participantRef(to)} where kind is publishes_to`,
      ),
      `${indent}autoLayout LeftRight 100 70`,
      `${indent}style * { size sm  textSize xl }`,
      `${indent}style element.kind = store { size xs  textSize lg }`,
    ];
  }

  /** Compact cards keep implementation paths in element details, not on the canvas. */
  function containerCards(services, indent = "    ") {
    return services.flatMap((service) => [
      `${indent}include ${fqn(service.id)} with { description '' }`,
      ...(storesByOwner.get(service.id) ?? []).map((store) => `${indent}include ${fqn(store.id)} with { description '' }`),
    ]);
  }

  /** Only customize edges whose endpoints this view already includes. */
  function transportLabels(services, roots, indent = "    ") {
    const visible = new Set([...services.map((service) => service.id), ...roots]);
    return [...busEdges.values()].filter((edge) => visible.has(edge.from) && visible.has(edge.to)).map((edge) => {
      return `${indent}include ${participantRef(edge.from)} -> ${participantRef(edge.to)} where kind is bus with { title ${q(busLabel(edge))}  notes ${q([...edge.labels].sort().join("\n"))} }`;
    });
  }
  // Rank constraints align only local queues, without claiming that they are
  // owned by a context or fabricating a shared infrastructure boundary.
  function localQueueRanks(services, roots, indent = "    ") {
    const allowed = new Set(roots);
    return services.flatMap((service) => {
      const brokers = [...brokerIds].filter((broker) => allowed.has(broker) && [...busEdges.values()].some((edge) => [edge.from, edge.to].includes(broker) && [edge.from, edge.to].includes(service.id)) && [...busEdges.values()].every((edge) => ![edge.from, edge.to].includes(broker) || [edge.from, edge.to].includes(service.id)));
      return brokers.length ? [`${indent}rank same { ${[fqn(service.id).split(".").slice(0, -1).join("."), ...brokers.map(safeId)].join(", ")} }`] : [];
    });
  }
  return { callPairs, carriedByBus, containerPredicates, containerCards, transportLabels, localQueueRanks };
}
