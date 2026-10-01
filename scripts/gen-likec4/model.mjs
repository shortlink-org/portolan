// The model block: every element the estate holds, then the relations
// between them - consumption, calls, dependencies, ownership, persistence,
// the hops through a broker, and what an actor starts.

import { counted, ledeOf, protocolOf, q, safeId, technologyOf, withVerb } from "./ids.mjs";
import { walkFlowSteps } from "./participants.mjs";
import { STATUS_LINE, STATUS_RANK } from "./specification.mjs";

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------
/** The model lines, and the facts about them that the views fold, label and rank by. */
export function emitModel(g) {
  const { catalog, fqn, contextColorName, serviceIds, rootParticipants, participantRef, peerParticipant, storesByOwner, storeById } = g;
  const model = [];
  model.push("model {");

  // A broker's line is rewritten once its hops are read, to say what it is.
  const brokerLine = new Map(); // participant id -> index in model
  const externalSummary = new Map((catalog.externals ?? []).map((external) => [external.id, external.summary]));
  for (const [id, meta] of rootParticipants) {
    if (meta.kind === "broker") brokerLine.set(id, model.length);
    const lede = meta.kind === "external" ? ledeOf(externalSummary.get(id)) : "";
    model.push(`  ${safeId(id)} = ${meta.kind} ${q(meta.label)}${lede ? ` {\n    description ${q(lede)}\n  }` : ""}`);
  }
  model.push("");

  for (const context of catalog.contexts) {
    model.push(`  ${safeId(context.id)} = context ${q(context.name)} {`);
    model.push(
      `    description ${q([context.kind, context.summary].filter(Boolean).join(" · "))}`,
    );
    model.push(`    style { color ${contextColorName(context.id)} }`);
    for (const service of context.services) {
      model.push(`    ${safeId(service.slug)} = service ${q(service.name)} {`);
      // What it does, not where it lives: the repository path is in the
      // service's details, and its stack is the technology line below.
      const lede = ledeOf(service.readme, service.slug);
      if (lede) model.push(`      description ${q(lede)}`);
      const technology = technologyOf(service);
      if (technology) model.push(`      technology ${q(technology)}`);
      model.push(`      style { color ${contextColorName(context.id)} }`);
      for (const aggregate of service.aggregates) {
        model.push(
          `      ${safeId(aggregate.slug)} = aggregate ${q(aggregate.kind === "model-group" ? `${aggregate.name} (model group)` : aggregate.name)} {`,
        );
        for (const event of aggregate.events) {
          const latest = event.versions[event.versions.length - 1];
          model.push(`        ${safeId(event.name)} = event ${q(event.name)} {`);
          model.push(`          description ${q(latest?.doc ?? "")}`);
          model.push("        }");
        }
        model.push("      }");
      }
      model.push("    }");
    }
    for (const service of context.services) {
      for (const store of storesByOwner.get(service.id) ?? []) {
        model.push(`    ${fqn(store.id).split(".").at(-1)} = store ${q(store.name)} {`);
        model.push(`      technology ${q(store.kind)}`);
        model.push(`      description ${q(`Owned by ${service.name}`)}`);
        model.push("    }");
      }
    }
    model.push("  }");
  }
  model.push("");

  // relations: event consumption, then rpc calls
  const relations = [];
  // What each relation does, kept beside its text so a picture that folds many
  // of them into one arrow can still say what the arrow carries.
  const crossings = []; // { from, to, verb, name } in LikeC4 references
  const crossing = (from, to, verb, name) => crossings.push({ from, to, verb, name });
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            // A service hearing its own event is a fact about the event, not
            // an arrow between two boxes; the app's graph keeps it on the
            // event for the same reason.
            if (consumer.service === service.id) continue;
            crossing(fqn(service.id), participantRef(consumer.service), "publishes", event.name);
            relations.push(
              `  ${fqn(service.id)} -[publishes_to]-> ${participantRef(consumer.service)} ${q(withVerb("publishes", event.name))} {\n` +
                `    style { color ${consumer.status}  line ${STATUS_LINE[consumer.status]}  head onormal }\n` +
                `  }`,
            );
          }
        }
      }
      for (const call of service.consumes) {
        const peer = peerParticipant(call.peer);
        if (!peer) continue;
        const method = call.id.split("/").pop() ?? call.id;
        const protocol = protocolOf(call.source);
        crossing(fqn(service.id), participantRef(peer), "calls", method);
        relations.push(
          `  ${fqn(service.id)} -[calls]-> ${participantRef(peer)} ${q(withVerb("calls", method))} {\n` +
            (protocol ? `    technology ${q(protocol)}\n` : "") +
            `    description ${q(`${call.id} · ${call.status}${call.source ? ` · ${call.source}` : ""}`)}\n` +
            `    style { color ${call.status}  line ${STATUS_LINE[call.status]}  head normal }\n` +
            `  }`,
        );
      }
      for (const dependency of service.dependsOn ?? []) {
        if (!serviceIds.has(dependency)) continue;
        crossing(fqn(service.id), fqn(dependency), "depends on", dependency);
        relations.push(
          `  ${fqn(service.id)} -[depends_on]-> ${fqn(dependency)} 'depends on' {\n` +
            `    style { color declared  line ${STATUS_LINE.declared}  head normal }\n` +
            `  }`,
        );
      }
      // Ownership is explicit now that stores and services are peers in L2.
      for (const store of storesByOwner.get(service.id) ?? []) {
        crossing(fqn(service.id), fqn(store.id), "owns", store.name || store.id);
        relations.push(`  ${fqn(service.id)} -[owns]-> ${fqn(store.id)} 'owns' {\n    style { color muted  line solid  head none }\n  }`);
      }
      // Cross-service readers still target the actual store, never its owner.
      for (const storeId of service.stores ?? []) {
        const store = storeById.get(storeId);
        if (!store || store.owner === service.id) continue;
        crossing(fqn(service.id), fqn(store.id), "reads", store.name || store.id);
        relations.push(
          `  ${fqn(service.id)} -[reads]-> ${fqn(store.id)} 'reads' {\n` +
            `    style { color declared  line ${STATUS_LINE.declared}  head normal }\n` +
            `  }`,
        );
      }
    }
  }

  // What a table says it persists is the one arrow inside a service that is read
  // off the schema rather than off the code: the aggregate goes into the store,
  // and the tables that carry it are the label. A table persisting an aggregate
  // another service owns draws the same arrow across the boundary, which is the
  // crossing the Problems page reports.
  const persists = new Map(); // "aggregate|store" -> { aggregate, store, labels:[] }
  for (const store of catalog.stores ?? []) {
    for (const table of store.tables) {
      const aggregate = table.persists?.aggregate;
      if (!aggregate) continue;
      const key = `${aggregate}|${store.id}`;
      const edge = persists.get(key) ?? {
        aggregate,
        store: store.id,
        labels: [],
      };
      edge.labels.push(table.name);
      persists.set(key, edge);
    }
    for (const keyspace of store.keyspaces ?? []) {
      const aggregate = keyspace.persists?.aggregate;
      if (!aggregate) continue;
      const key = `${aggregate}|${store.id}`;
      const edge = persists.get(key) ?? {
        aggregate,
        store: store.id,
        labels: [],
      };
      edge.labels.push(keyspace.pattern);
      persists.set(key, edge);
    }
  }
  for (const edge of persists.values()) {
    for (const name of edge.labels) crossing(fqn(edge.aggregate), fqn(edge.store), "persists", name);
    const label =
      edge.labels.length > 3
        ? `${edge.labels.length} persisted shapes`
        : edge.labels.join(", ");
    relations.push(
      `  ${fqn(edge.aggregate)} -[persists]-> ${fqn(edge.store)} ${q(label)} {\n` +
        `    style { color declared  line ${STATUS_LINE.declared}  head normal }\n` +
        `  }`,
    );
  }

  // A broker is a container too, and the one the catalog only meets in flows:
  // no repository imports the bus, and an event records its consumers service
  // to service, as if the message went straight across. The hop through the
  // broker is read off the steps that walk it — once per pair and direction,
  // however many events or jobs travel that way — so a level-2 picture can put
  // the bus between publisher and subscriber instead of an arrow that skips it.
  const brokerIds = new Set(
    [...rootParticipants]
      .filter(([, meta]) => meta.kind === "broker")
      .map(([id]) => id),
  );
  const busEdges = new Map(); // "from|to" -> { from, to, kind, labels:Set, status, transports:Set }

  // --- what a hop through a broker travels on ---------------------------------
  // A step that hands off says so itself (`handoff.transport`: celery, kafka,
  // river). A domain event does not: the extractor that found it knows the bus
  // only as `bus`. Its wire channel does - AsyncAPI names the server's protocol,
  // a go-nats scan knows it read NATS - so the event is followed to its channel
  // and the channel to its protocol. Nothing is said when the two disagree.
  const TRANSPORT_NAMES = {
    amqp: "AMQP",
    celery: "Celery",
    eventgrid: "Event Grid",
    eventhub: "Event Hubs",
    "in-memory": "in-memory",
    "internal-commands": "internal commands",
    servicebus: "Service Bus",
    storagequeue: "Storage Queues",
    "googlepubsub": "Pub/Sub",
    "google-pubsub": "Pub/Sub",
    kafka: "Kafka",
    mqtt: "MQTT",
    nats: "NATS",
    rabbitmq: "RabbitMQ",
    redis: "Redis",
    river: "River",
    sns: "SNS",
    sql: "SQL",
    sqs: "SQS",
    watermill: "Watermill",
  };
  const transportName = (id) => TRANSPORT_NAMES[id.toLowerCase()] ?? id;
  const channelProtocols = new Map(); // address -> Set of protocols
  const eventChannels = new Map(); // "service|event" and "|event" -> Set of wire channels
  const addTo = (map, key, value) => map.set(key, (map.get(key) ?? new Set()).add(value));
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const channel of service.channels ?? []) {
        if (channel.protocol) addTo(channelProtocols, channel.address, channel.protocol.toLowerCase());
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          if (!event.wire?.channel) continue;
          addTo(eventChannels, `${service.id}|${event.name}`, event.wire.channel);
          addTo(eventChannels, `|${event.name}`, event.wire.channel);
        }
      }
    }
  }
  function stepTransport(step) {
    if (step.handoff?.transport) return step.handoff.transport.toLowerCase();
    if (step.kind !== "event" || !step.label) return null;
    // Onto the broker the publisher is known; off it, any service that
    // publishes an event of that name is asked.
    const publisher = brokerIds.has(step.to) ? step.from : null;
    const channels = eventChannels.get(`${publisher ?? ""}|${step.label}`) ?? eventChannels.get(`|${step.label}`);
    const protocols = new Set([...(channels ?? [])].flatMap((address) => [...(channelProtocols.get(address) ?? [])]));
    return protocols.size === 1 ? [...protocols][0] : null;
  }
  // A hop onto a broker is sent — an event published, a job enqueued — and a hop
  // off it is delivered. A job is a message like an event is, so it takes the
  // hollow head too: a sequence diagram's headless in-process call would leave
  // the queue's arrow without a direction.
  const busHead = (edge) => (edge.kind === "rpc" ? "normal" : "onormal");
  function busLabel(edge) {
    const names = [...edge.labels].sort();
    const onto = brokerIds.has(edge.to);
    const verb = !onto ? "delivers" : edge.kind === "event" ? "publishes" : "enqueues";
    const noun = edge.kind === "event" ? "event" : "job";
    return names.length === 1 ? withVerb(verb, names[0]) : counted(verb, names.length, noun);
  }
  for (const flow of catalog.flows) {
    walkFlowSteps(flow.steps, (step) => {
      if (step.kind === "response") return;
      if (brokerIds.has(step.from) === brokerIds.has(step.to)) return;
      const key = `${step.from}|${step.to}`;
      const edge = busEdges.get(key) ?? {
        from: step.from,
        to: step.to,
        kind: step.kind,
        labels: new Set(),
        status: "unresolved",
        transports: new Set(),
      };
      if (step.label) edge.labels.add(step.label);
      const transport = stepTransport(step);
      if (transport) edge.transports.add(transportName(transport));
      if (STATUS_RANK[step.status] < STATUS_RANK[edge.status])
        edge.status = step.status;
      busEdges.set(key, edge);
    });
  }
  const busTechnology = (transports) => [...transports].sort().join(" · ");
  const brokerTransports = new Map(); // broker id -> Set of transport names
  for (const edge of busEdges.values()) {
    const broker = brokerIds.has(edge.to) ? edge.to : edge.from;
    for (const transport of edge.transports) addTo(brokerTransports, broker, transport);
    const technology = busTechnology(edge.transports);
    relations.push(
      `  ${participantRef(edge.from)} -[bus]-> ${participantRef(edge.to)} ${q(busLabel(edge))} {\n` +
        (technology ? `    technology ${q(technology)}\n` : "") +
        `    style { color ${edge.status}  line ${STATUS_LINE[edge.status]}  head ${busHead(edge)} }\n` +
        `  }`,
    );
  }

  // The box says what it is only when every hop agrees. One broker id can stand
  // for two estates' buses - `bus` is NATS in one and RabbitMQ in the next - and
  // a box that said both would be describing neither; the arrows still say theirs.
  for (const [broker, transports] of brokerTransports) {
    const index = brokerLine.get(broker);
    if (index === undefined || transports.size !== 1) continue;
    model[index] = `${model[index]} {\n    technology ${q(busTechnology(transports))}\n  }`;
  }

  // An actor is the one participant nothing else in the catalog can place: no
  // repository imports the customer, and no event names them. A flow step is
  // the only evidence that they touch the estate at all, so it is read as a
  // relation — once per pair, however many flows walk it.
  const actorIds = new Set(
    [...rootParticipants]
      .filter(([, meta]) => meta.kind === "actor")
      .map(([id]) => id),
  );
  //
  // The lane is a fallback, though: an extractor opens every inbound endpoint
  // with `client` because it has no way to see who is on the other end. Once a
  // service inside the estate is known to call the same service, "somebody
  // outside" is no longer the best explanation for its endpoints, and a declared
  // actor arrow beside a real caller would only repeat the guess. An observed
  // crossing is different: the collector saw a call with nobody of ours behind
  // it, and that stays drawn whoever else calls the service.
  const calledFromInside = new Set(); // service ids some other service calls over rpc
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const call of service.consumes) {
        const peer = peerParticipant(call.peer);
        if (peer && peer !== service.id) calledFromInside.add(peer);
      }
    }
  }
  const actorEdges = new Map(); // "from|to" -> { from, to, flows:Set, status }
  for (const flow of catalog.flows) {
    walkFlowSteps(flow.steps, (step) => {
      if (step.kind === "response") return;
      if (!actorIds.has(step.from) && !actorIds.has(step.to)) return;
      if (step.from === step.to) return;
      const key = `${step.from}|${step.to}`;
      const edge = actorEdges.get(key) ?? {
        from: step.from,
        to: step.to,
        flows: new Set(),
        status: "unresolved",
      };
      edge.flows.add(flow.name);
      // The best evidence any step offers: one observed crossing is enough to
      // say the actor really does touch the estate there.
      if (STATUS_RANK[step.status] < STATUS_RANK[edge.status])
        edge.status = step.status;
      actorEdges.set(key, edge);
    });
  }
  for (const edge of actorEdges.values()) {
    if (edge.status !== "verified" && calledFromInside.has(edge.to)) continue;
    const names = [...edge.flows];
    for (const name of names) crossing(participantRef(edge.from), participantRef(edge.to), "starts", name);
    const label = names.length === 1 ? withVerb("starts", names[0]) : counted("starts", names.length, "flow");
    relations.push(
      `  ${participantRef(edge.from)} -[uses]-> ${participantRef(edge.to)} ${q(label)} {\n` +
        `    style { color ${edge.status}  line ${STATUS_LINE[edge.status]}  head normal }\n` +
        `  }`,
    );
  }

  model.push(...relations);
  model.push("}");
  return { model, crossings, persists, brokerIds, busEdges, busLabel, actorIds, addTo };
}
