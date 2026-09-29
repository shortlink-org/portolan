// Generates likec4/ sources from the merged catalog.
//
// Everything LikeC4 renders is DECLARED here: the C4 views — the estate at
// level 1, its containers at level 2 as one picture and one per context, two
// per service — and a full dynamic view per flow, plus a bounded-context
// crossings view when crossings exist. Nothing in the app draws these pictures itself.
//
//   node scripts/gen-likec4.mjs

import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "./catalog-sources.mjs";
import reserved from "../src/likec4/reserved.json" with { type: "json" };
import { catalogProfiles } from "../src/catalog-profile.ts";
import { allDeployments, deploys, environmentOf } from "../src/catalog-model.ts";
import { isCrossContext } from "../src/flow/cross-context.ts";

// Every source, not one file: a service that publishes its own facts gets a
// C4 view like any other, and generating from a single file would leave it out
// of the pictures while the rest of the app knows about it.
//
// The sources come back as files rather than being written here, so that
// `gen` can settle them the way it settles every generated page - written,
// or in check mode compared and reported as drift - and `likec4:gen` can
// still write them on its own before the dev server starts.
export async function likec4Sources({ catalog, manifest }) {
const profiles = catalogProfiles(manifest);

// --- ids (mirrors src/likec4/ids.ts; kept in step by src/likec4/ids.test.ts) ---
// The reserved words are not mirrored, they are the same file: a word the
// grammar has taken must be escaped identically on both sides or a clicked
// node stops finding what it stands for.
const RESERVED = new Set(reserved);
const safeId = (raw) => {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || RESERVED.has(cleaned)
    ? `_${cleaned}`
    : cleaned;
};
// Mirrors storeFqn in ids.ts; catalog ids and ownership stay unchanged.
const storeRefs = new Map((catalog.stores ?? []).map((store) => [
  store.id,
  `${store.owner.split(".").slice(0, -1).map(safeId).join(".")}._store_${safeId(store.id)}`,
]));
const fqn = (id) => storeRefs.get(id) ?? id.split(".").map(safeId).join(".");
const flowViewId = (flow) => `flow_${safeId(flow.slug)}`;
const flowCrossViewId = (flow) => `${flowViewId(flow)}_cross`;
const contextViewId = (c) => `ctx_${safeId(c.id)}`;
const serviceViewId = (s) => `svc_${safeId(s.id)}`;
const serviceInsideViewId = (s) => `${serviceViewId(s)}_inside`;
const deploymentViewId = (environment) => `deploy_${safeId(environment)}`;
const serviceDeployViewId = (s) => `deploy_svc_${safeId(s.id)}`;
const LANDSCAPE_VIEW = "landscape";
const CONTAINERS_VIEW = "containers";
const profileLandscapeViewId = (profile) =>
  `${LANDSCAPE_VIEW}_${safeId(profile.id)}`;
const profileContainersViewId = (profile) =>
  `${CONTAINERS_VIEW}_${safeId(profile.id)}`;
const includeTargets = (targets) =>
  targets.length > 0 ? targets.join(", ") : "*";

const q = (text) =>
  `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// An arrow's label says what the relation does, in the direction it points:
// `publishes OrderPlaced`, not a bare `OrderPlaced` a reader has to turn round.
// A label that already opens with a verb — a flow step's `enqueue send_email`
// — keeps its own; a bare name is given the relation's.
const withVerb = (verb, name) => (/^[a-z]+ /.test(name) ? name : `${verb} ${name}`);
const counted = (verb, count, noun) => `${verb} ${count} ${noun}${count === 1 ? "" : "s"}`;

// The protocol a call travels on, read off the document that declares it.
// Mirrors sourceDocKind in src/lib/source-doc.ts, plus the generated stub a
// Go client is read from when no proto is vendored. Empty when the source
// says nothing a reader could name.
const protocolOf = (source) => {
  const path = String(source ?? "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  if (path.endsWith(".proto") || path.endsWith(".pb.go")) return "gRPC";
  if (path.endsWith(".wsdl")) return "SOAP";
  if (path.endsWith(".graphql") || path.endsWith(".graphqls")) return "GraphQL";
  if (/\.(ya?ml|json)$/.test(path)) return "HTTP";
  return "";
};

// What a box says it does: the first sentence of the first paragraph of prose.
// A README opens with a title and, often, a line saying which service it is -
// "Service `cart` - bounded context shop. TypeScript on Node.js." - which names
// the service by its code name and says nothing of what it does; that line is
// passed over. Markdown is taken out, and a sentence past 200 characters is cut
// at a word. Nothing is said when no paragraph qualifies.
function ledeOf(markdown, slug = "") {
  const paragraphs = String(markdown ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    if (/^(#|```|~~~|<|!\[|\||[-*+] |\d+\. |>)/.test(paragraph)) continue;
    const words = paragraph.split(/\s+/).length;
    if (words < 3) continue;
    if (slug && paragraph.includes(`\`${slug}\``) && words < 25) continue;
    return firstSentence(plainText(paragraph));
  }
  return "";
}
function plainText(markdown) {
  return markdown
    .replace(/\s+/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s.,;:!?)]|$)/g, "$1$2")
    .trim();
}
function firstSentence(text) {
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(text)?.[1] ?? text;
  if (sentence.length <= 200) return sentence;
  const cut = sentence.slice(0, 200);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 200)}…`;
}

// What a container box says under its name at level 2: what the service is
// built with when an extractor recorded it, and what it speaks, read off the
// contracts it provides. Both are facts the catalog holds; neither is guessed.
const technologyOf = (service) => {
  const protocols = new Set(
    service.provides
      .map((provided) => protocolOf(provided.source))
      .filter(Boolean),
  );
  return [...(service.technologies ?? []), ...[...protocols].sort()].join(
    " · ",
  );
};

// --- shared visual language ------------------------------------------------
// These hex values are the light/dark-neutral midpoints of the --ctx-N and
// --status-* tokens in src/index.css. LikeC4 bakes colours into its own theme,
// so the seam between renderers is kept invisible by hand here.
const CTX_COLORS = [
  "#4a86c8",
  "#9a66cc",
  "#2aa196",
  "#c4703f",
  "#6b7cb4",
  "#b46b8b",
];
const STATUS_COLORS = {
  verified: "#2f9e63",
  declared: "#b8912f",
  unresolved: "#e0453f",
};
const RESPONSE_ERROR_COLOR = "#b7646b";
const STATUS_LINE = {
  verified: "solid",
  declared: "dashed",
  unresolved: "dotted",
};
const STATUS_RANK = { verified: 0, declared: 1, unresolved: 2 };
const KIND_HEAD = {
  event: "onormal",
  rpc: "normal",
  call: "none",
  response: "normal",
};

// Every relation carries the kind of fact it is, so a view can say which
// facts it draws: a level-2 picture with the bus on it leaves out the arrows
// that skip the bus, and nothing else has to change for it to do so.
const RELATION_KINDS = [
  "publishes_to",
  "calls",
  "depends_on",
  "bus",
  "reads",
  "persists",
  "uses",
  "owns",
];

const contextColorName = (contextId) => {
  const i = catalog.contexts.findIndex((c) => c.id === contextId);
  return `ctx${(i < 0 ? 0 : i) % CTX_COLORS.length}`;
};

// --- collect participants that are not catalog services --------------------
const serviceIds = new Set(
  catalog.contexts.flatMap((c) => c.services.map((s) => s.id)),
);
const storeIds = new Set((catalog.stores ?? []).map((store) => store.id));
const externalIds = new Set((catalog.externals ?? []).map((external) => external.id));
const participantEntityRef = new Map();
const rootParticipants = new Map(); // id -> kind
for (const flow of catalog.flows) {
  for (const p of flow.participants) {
    if (p.entityRef) participantEntityRef.set(p.id, p.entityRef);
    // A nested Store cannot be an actor in a LikeC4 dynamic view. Keep its
    // readable root lane here; entityRef still powers UI links/backlinks.
    if (p.entityRef && (serviceIds.has(p.entityRef) || externalIds.has(p.entityRef))) continue;
    if (serviceIds.has(p.id)) continue;
    rootParticipants.set(p.id, { kind: p.kind, label: p.label ?? p.id });
  }
}
// A system outside the estate with a contract is a root participant whether or
// not a flow has walked to it yet: a call recorded on `consumes` lands on it,
// and the catalog knows what it is called, which a lane's bare id does not.
for (const external of catalog.externals ?? []) {
  rootParticipants.set(external.id, {
    kind: "external",
    label: external.name || external.id,
  });
}
// Event consumers that no service accounts for are real dependencies too.
for (const context of catalog.contexts) {
  for (const service of context.services) {
    for (const aggregate of service.aggregates) {
      for (const event of aggregate.events) {
        for (const consumer of event.consumers) {
          if (serviceIds.has(consumer.service)) continue;
          if (rootParticipants.has(consumer.service)) continue;
          rootParticipants.set(consumer.service, {
            kind: "unknown",
            label: consumer.service,
          });
        }
      }
    }
  }
}

// An unresolved call keeps the raw peer name, `risk.v1`, as its contract says;
// the flow that made the same call put the peer on a lane whose id carries no
// dot, `risk-v1`, because a dot would read as containment here. The two are
// one participant, joined by the label the lane kept, so the call resolves to
// the lane and not to a `v1` nested inside a `risk` that nobody declared.
const participantByLabel = new Map();
for (const [id, meta] of rootParticipants)
  participantByLabel.set(meta.label, id);
// A dot means containment only for catalog services. Root participants are
// declared as one safe identifier, so a broker named `river.orders` must be
// referenced as `river_orders`, not as an undeclared `orders` inside `river`.
const participantRef = (id) => {
  const entity = participantEntityRef.get(id) ?? id;
  if (storeIds.has(entity)) return safeId(id);
  if (externalIds.has(entity)) return safeId(entity);
  return rootParticipants.has(entity) && !serviceIds.has(entity) ? safeId(entity) : fqn(entity);
};
function peerParticipant(peer) {
  if (serviceIds.has(peer) || rootParticipants.has(peer)) return peer;
  return participantByLabel.get(peer);
}

// A store is a container the estate keeps its state in, so it belongs inside
// the service that owns it — not at the model root, where a flow's own store
// participants sit. The two are different ids and the catalog says nothing
// that would join them, so neither is guessed into the other.
const storesByOwner = new Map();
const storeById = new Map();
for (const store of catalog.stores ?? []) {
  storeById.set(store.id, store);
  const owned = storesByOwner.get(store.owner) ?? [];
  owned.push(store);
  storesByOwner.set(store.owner, owned);
}

/** Every step of a flow, branches and loops included, in declaration order. */
function walkFlowSteps(nodes, visit) {
  for (const node of nodes) {
    if (node.type === "step") visit(node);
    else if (node.type === "parallel")
      node.branches.forEach((b) => walkFlowSteps(b, visit));
    else if (node.type === "loop") walkFlowSteps(node.steps, visit);
    else if (node.type === "alt")
      node.branches.forEach((b) => walkFlowSteps(b.steps, visit));
  }
}

// ---------------------------------------------------------------------------
// specification
// ---------------------------------------------------------------------------
const spec = [];
spec.push(
  "// GENERATED by scripts/gen-likec4.mjs from the merged catalog — do not edit.",
);
spec.push("specification {");
CTX_COLORS.forEach((hex, i) => spec.push(`  color ctx${i} ${hex}`));
for (const [name, hex] of Object.entries(STATUS_COLORS)) {
  spec.push(`  color ${name} ${hex}`);
}
spec.push(`  color response_error ${RESPONSE_ERROR_COLOR}`);
spec.push("");
spec.push("  element context {");
spec.push("    style { shape rectangle  opacity 5%  border dashed }");
spec.push("  }");
spec.push("  element service {");
spec.push("    style { shape rectangle }");
spec.push("  }");
spec.push("  element aggregate {");
spec.push("    style { shape rectangle  opacity 20% }");
spec.push("  }");
spec.push("  element event {");
spec.push("    style { shape rectangle  opacity 30% }");
spec.push("  }");
spec.push("  element actor {");
spec.push("    style { shape person  color muted }");
spec.push("  }");
spec.push("  element broker {");
spec.push("    style { shape queue  color muted }");
spec.push("  }");
spec.push("  element store {");
spec.push("    style { shape storage  color muted }");
spec.push("  }");
spec.push("  element external {");
spec.push("    style { shape rectangle  color muted }");
spec.push("  }");
spec.push("  element unknown {");
spec.push("    style { shape rectangle  color unresolved  border dashed }");
spec.push("  }");
spec.push("");
// Where a service runs (portolan.0012): three nested places, drawn as
// frames around the instances they hold, from the deployer's snapshot.
spec.push("  deploymentNode environment {");
spec.push("    style { shape rectangle  opacity 5%  border dashed }");
spec.push("  }");
spec.push("  deploymentNode cluster {");
spec.push("    style { shape rectangle  opacity 10%  border dashed  color muted }");
spec.push("  }");
spec.push("  deploymentNode namespace {");
spec.push("    style { shape rectangle  opacity 15%  color muted }");
spec.push("  }");
spec.push("");
for (const kind of RELATION_KINDS) spec.push(`  relationship ${kind}`);
spec.push("}");

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

/**
 * Emits one flow as LikeC4 dynamic-view steps.
 *
 * Every frame in the catalog has a frame here: `alt` becomes `alt { when … else
 * … }`, which is the same vocabulary the step rail uses, so the picture and the
 * list read alike. Terminality has no LikeC4 keyword of its own; it is wrapped
 * in a `break` frame, which is what a sequence diagram calls a branch that
 * leaves the flow rather than rejoining it.
 */
// --- request and response edges (mirrors src/flow/answers.ts) --------------
// A unary RPC is two messages, not one long edge label. When composition has
// already materialised a response step, that step is the return. Otherwise we
// draw the contract response: immediately for a nested call, and at the end of
// the flow for the actor request that opened it.
const methodOf = new Map();
const serviceById = new Map();
for (const context of catalog.contexts) {
  for (const service of context.services) {
    serviceById.set(service.id, service);
    for (const provided of service.provides) {
      for (const method of provided.methods) {
        methodOf.set(`${provided.id}/${method.name}`, method);
      }
    }
  }
}
// What comes back from a third party is in its document too.
for (const external of catalog.externals ?? []) {
  for (const provided of external.provides) {
    for (const method of provided.methods) {
      methodOf.set(`${provided.id}/${method.name}`, method);
    }
  }
}

function contractOf(step) {
  if (step.kind !== "rpc") return null;
  if (step.ref) return methodOf.get(step.ref) ?? null;
  const service = serviceById.get(step.to);
  if (!service || !step.label) return null;
  for (const provided of service.provides) {
    const found = provided.methods.find((m) => m.name === step.label);
    if (found) return found;
  }
  return null;
}

function emitSteps(nodes, out, indent, replied) {
  for (const node of nodes) {
    if (node.type === "step") {
      const contract = contractOf(node);
      const request = contract?.request ?? "";
      const response = replied.has(node.id) ? "" : (contract?.response ?? "");
      const storeLabel =
        node.storeAccess?.operation && node.storeAccess?.keyspace
          ? `${node.storeAccess.operation.toUpperCase()} ${node.storeAccess.keyspace}`
          : "";
      const requestLabel =
        storeLabel ||
        (node.kind === "rpc" && request
          ? request
          : node.label || node.ref || node.kind);
      // A synchronous request and its contract response are one catalog hop.
      // Keep them on one LikeC4 relation too, so the diagram and rail share
      // one step number. An explicit response step remains a separate edge:
      // it is source-backed execution, not a contract annotation.
      const label = response ? `${requestLabel} → ${response}` : requestLabel;
      const attrs = [
        `color ${node.http?.outcome === "error" ? "response_error" : node.status}`,
        `line ${node.kind === "response" ? "dashed" : "solid"}`,
        `head ${KIND_HEAD[node.kind]}`,
      ];
      // The condition used to be pasted onto every label because there was no
      // frame to carry it. There is one now, so the label is just the message.
      const notes = [];
      if (node.note) notes.push(node.note);
      if (node.line) notes.push(node.line);
      if (node.storeAccess?.source) notes.push(node.storeAccess.source);
      out.push(
        `${indent}${participantRef(node.from)} -> ${participantRef(node.to)} ${q(label)} {`,
      );
      out.push(`${indent}  ${attrs.join("  ")}`);
      if (notes.length > 0)
        out.push(`${indent}  notes ${q(notes.join(" — "))}`);
      out.push(`${indent}}`);
      continue;
    }
    if (node.type === "parallel") {
      out.push(`${indent}par ${node.title ? `${q(node.title)} ` : ""}{`);
      for (const branch of node.branches)
        emitSteps(branch, out, `${indent}  `, replied);
      out.push(`${indent}}`);
      continue;
    }
    if (node.type === "loop") {
      out.push(`${indent}loop ${q(node.title)} {`);
      emitSteps(node.steps, out, `${indent}  `, replied);
      out.push(`${indent}}`);
      continue;
    }
    if (node.type === "alt") {
      out.push(`${indent}alt {`);
      node.branches.forEach((branch, i) => {
        const keyword = i === 0 ? "when" : "else";
        out.push(`${indent}  ${keyword} ${q(branch.title)} {`);
        if (branch.terminal) {
          out.push(`${indent}    break 'ends the flow' {`);
          emitSteps(
            branch.steps,
            out,
            `${indent}      `,
            replied,
          );
          out.push(`${indent}    }`);
        } else {
          emitSteps(
            branch.steps,
            out,
            `${indent}    `,
            replied,
          );
        }
        out.push(`${indent}  }`);
      });
      out.push(`${indent}}`);
    }
  }
}

/** Keeps only steps that actually leave a bounded context. */
function crossContextOnly(nodes, contextOf) {
  const keep = (step) => isCrossContext(step, contextOf);
  const walk = (list) => {
    const out = [];
    for (const node of list) {
      if (node.type === "step") {
        if (keep(node)) out.push(node);
      } else if (node.type === "parallel") {
        const branches = node.branches.map(walk).filter((b) => b.length > 0);
        if (branches.length > 0) out.push({ ...node, branches });
      } else if (node.type === "loop") {
        const steps = walk(node.steps);
        if (steps.length > 0) out.push({ ...node, steps });
      } else if (node.type === "alt") {
        const branches = node.branches
          .map((b) => ({ ...b, steps: walk(b.steps) }))
          .filter((b) => b.steps.length > 0);
        if (branches.length > 0) out.push({ ...node, branches });
      }
    }
    return out;
  };
  return walk(nodes);
}

const views = [];
views.push("views {");

// --- C4 level 1: the estate and what stands outside it ---------------------
// Contexts as black boxes, and the participants that are not the estate's to
// build: the people who use it, the systems it pays and asks, and the
// consumers nothing in the catalog accounts for. Brokers and stores are left
// out on purpose — they are containers, and they belong to the level below.
//
// This is not /graph's picture: that one is services against the events they
// carry, and it is drawn by React Flow. No picture is drawn by both.
const OUTSIDE = new Set(["actor", "external", "unknown"]);
const outside = [...rootParticipants]
  .filter(([, meta]) => OUTSIDE.has(meta.kind))
  .map(([id]) => safeId(id));
// LikeC4 folds every relation between two top-level boxes into one arrow and,
// once there is more than one, labels it `[...]`. The fold is labelled here
// instead: what crosses, counted by what it does, and each fact in the notes.
const CROSSING_NOUNS = [
  ["calls", "method"],
  ["publishes", "event"],
  ["starts", "flow"],
  ["owns", "store"],
  ["reads", "store"],
  ["persists", "shape"],
  ["depends on", "service"],
];
/**
 * `include from -> to with { title … }` lines for folded arrows. `endpoint`
 * maps a relation's end to the box that draws it on this picture, or to
 * nothing when the picture does not hold it. `spell` is how the view names a
 * box, or nothing when it cannot name it without naming something else, and
 * `keep` says which pairs of boxes are labelled at all.
 */
function foldLabels(endpoint, indent = "    ", spell = (box) => box, keep = () => true) {
  const pairs = new Map(); // "from|to" -> { from, to, byVerb: Map<verb, Set<name>> }
  for (const { from: source, to: target, verb, name } of crossings) {
    const [from, to] = [endpoint(source), endpoint(target)];
    if (!from || !to || from === to || !keep(from, to)) continue;
    const key = `${from}|${to}`;
    const pair = pairs.get(key) ?? { from, to, byVerb: new Map() };
    const names = pair.byVerb.get(verb) ?? new Set();
    names.add(name);
    pair.byVerb.set(verb, names);
    pairs.set(key, pair);
  }
  return [...pairs.values()].flatMap((pair) => {
    const [from, to] = [spell(pair.from), spell(pair.to)];
    if (!from || !to) return [];
    const parts = CROSSING_NOUNS.filter(([verb]) => pair.byVerb.has(verb)).map(([verb, noun]) => {
      const names = [...pair.byVerb.get(verb)].sort();
      return { verb, names, title: names.length === 1 ? withVerb(verb, names[0]) : counted(verb, names.length, noun) };
    });
    const title = parts.map((part) => part.title).join(" · ");
    const facts = parts.flatMap((part) => part.names.map((name) => withVerb(part.verb, name)));
    // One fact is its own title; the notes are for the ones a count stands for.
    const notes = facts.length > 1 ? `  notes ${q(facts.join("\n"))}` : "";
    return [`${indent}include ${from} -> ${to} with { title ${q(title)}${notes} }`];
  });
}

// What a view scoped to an element can name. Inside `view x of a.b` the first
// segment of a reference is the scope itself when it is the scope's own name,
// else one of the scope's children, else an element at the model's root - and
// nothing else: not the scope's siblings, and no second try when the first
// match leads nowhere. So inside `auth.auth` the service is spelled `auth`,
// `auth.auth` means `auth.auth.auth`, and the context's store beside it cannot
// be named at all. (Checked against `likec4 validate`, 1.59.) The tree is read
// off the model as written.
const childrenOf = new Map(); // parent reference ("" for the root) -> Set of names
const declaredRefs = new Set();
{
  const path = [];
  for (const line of model) {
    for (const row of line.split("\n")) {
      const declared = /^( *)([A-Za-z_][\w-]*) = \w+\b/.exec(row);
      if (!declared) continue;
      const depth = declared[1].length / 2 - 1;
      path.length = depth;
      addTo(childrenOf, path.join("."), declared[2]);
      path.push(declared[2]);
      declaredRefs.add(path.join("."));
    }
  }
}
function resolveIn(scope, reference) {
  const [head, ...rest] = reference.split(".");
  const base =
    head === scope.split(".").at(-1) ? scope
    : childrenOf.get(scope)?.has(head) ? `${scope}.${head}`
    : childrenOf.get("")?.has(head) ? head
    : null;
  const resolved = base && [base, ...rest].join(".");
  return resolved && declaredRefs.has(resolved) ? resolved : null;
}
/** The shortest spelling that, inside `scope`, names `target` and nothing else. */
function spellIn(scope, target) {
  const segments = target.split(".");
  for (let start = segments.length - 1; start >= 0; start -= 1) {
    const candidate = segments.slice(start).join(".");
    if (resolveIn(scope, candidate) === target) return candidate;
  }
  return null;
}

/**
 * A service's neighbours view draws the service, the stores and services of
 * its own context as their own boxes, and everything in another context folded
 * into that context. Only arrows with the service at one end are labelled:
 * those are the ones whose far box the view is sure to hold, and a label on
 * any other pair would pull boxes into the picture that it does not draw.
 */
function neighbourLabels(service, context, indent = "    ") {
  const self = fqn(service.id);
  const home = safeId(context.id);
  const box = (reference) => {
    if (reference === self || reference.startsWith(`${self}.`)) return self;
    const segments = reference.split(".");
    if (segments.length === 1) return reference;
    return segments[0] === home ? segments.slice(0, 2).join(".") : segments[0];
  };
  return foldLabels(box, indent, (reference) => spellIn(self, reference), (from, to) => from === self || to === self);
}

/**
 * A context's own L2 view opens the context and folds every other one. The
 * arrows between the two sides are labelled here; the ones inside are the
 * folded call pairs `containerPredicates` already names.
 */
function contextLabels(context, indent = "    ") {
  const home = safeId(context.id);
  const inside = (box) => box.startsWith(`${home}.`);
  const box = (reference) => {
    const segments = reference.split(".");
    if (segments.length === 1) return reference;
    return segments[0] === home ? segments.slice(0, 2).join(".") : segments[0];
  };
  return foldLabels(box, indent, (reference) => spellIn(home, reference), (from, to) => inside(from) !== inside(to));
}

/** A top-level box stands for everything nested in it. */
function landscapeLabels(roots, indent = "    ") {
  const visible = new Set(roots);
  return foldLabels((ref) => {
    const root = ref.split(".")[0];
    return visible.has(root) ? root : null;
  }, indent);
}

views.push(`  view ${LANDSCAPE_VIEW} {`);
views.push("    title 'Estate'");
views.push(
  catalog.contexts.some(
    (context) => context.kind && context.kind !== "bounded-context",
  )
    ? "    description 'Every architecture group, and everything outside the estate that touches one.'"
    : "    description 'Every bounded context, and everything outside the estate that touches one.'",
);
views.push(
  `    include ${includeTargets([...catalog.contexts.map((c) => safeId(c.id)), ...outside])}`,
);
views.push(...landscapeLabels([...catalog.contexts.map((c) => safeId(c.id)), ...outside]));
views.push("  }");
views.push("");

// --- C4 level 2: every container in the estate -----------------------------
// The same boxes as the landscape, opened: each context with its services
// and their stores beside them, the brokers the
// flows walk through, and the same outsiders as above. One picture of what
// runs, what it talks to and over which protocol — the diagram most people
// mean when they ask for "the architecture".
const brokersOfService = new Map(); // service id -> Set of broker ids
for (const edge of busEdges.values()) {
  const [service, broker] = brokerIds.has(edge.to)
    ? [edge.from, edge.to]
    : [edge.to, edge.from];
  const set = brokersOfService.get(service) ?? new Set();
  set.add(broker);
  brokersOfService.set(service, set);
}
const allServices = catalog.contexts.flatMap((c) => c.services);
const drawnBrokers = [
  ...new Set(
    allServices.flatMap((s) => [...(brokersOfService.get(s.id) ?? [])]),
  ),
];
views.push(`  view ${CONTAINERS_VIEW} {`);
views.push("    title 'Containers'");
views.push(
  "    description 'Every service, the store it keeps its state in, the brokers between them, and everything outside the estate that touches one.'",
);
views.push(
  `    include ${includeTargets([
    ...catalog.contexts.map((c) => safeId(c.id)),
    ...allServices.map((s) => fqn(s.id)),
    ...(catalog.stores ?? []).map((store) => fqn(store.id)),
    ...drawnBrokers.map(safeId),
    ...outside,
  ])}`,
);
views.push(...containerCards(allServices));
views.push(...transportLabels(allServices, [...rootParticipants.keys()]));
views.push(
  ...containerPredicates([...callPairs.values()], carriedByBus, "    "),
);
views.push(...localQueueRanks(allServices, [...rootParticipants.keys()]));
if (outside.some((id) => [...actorIds].some((actor) => safeId(actor) === id)))
  views.push(`    rank source { ${[...actorIds].map(safeId).join(", ")} }`);
views.push("  }");
views.push("");

// The model is the union so shared edges and per-context views are declared
// once. These two views per profile are the isolated estate entry points the
// UI uses: only the configured groups and the outsiders their own flows name
// are included.
for (const profile of profiles) {
  // An empty context selection is the historical single-catalog manifest's
  // implicit `default` profile. The browser treats it as the whole catalog;
  // the generated views must do the same or it asks for landscape_default
  // while the bundle only contains the unscoped landscape view.
  const profileContexts = profile.contexts.length
    ? catalog.contexts.filter((context) =>
        profile.contexts.includes(context.id),
      )
    : catalog.contexts;
  const profileContextIds = new Set(
    profileContexts.map((context) => context.id),
  );
  const profileServices = profileContexts.flatMap(
    (context) => context.services,
  );
  const profileServiceIds = new Set(
    profileServices.map((service) => service.id),
  );
  const profileRoots = new Set();
  for (const flow of catalog.flows) {
    if (!profileContextIds.has(flow.owner)) continue;
    for (const participant of flow.participants) {
      if (!profileServiceIds.has(participant.id))
        profileRoots.add(participant.id);
    }
  }
  for (const service of profileServices) {
    for (const dependency of service.dependsOn ?? []) {
      if (!profileServiceIds.has(dependency)) profileRoots.add(dependency);
    }
    for (const call of service.consumes) {
      const peer = peerParticipant(call.peer);
      if (peer && !profileServiceIds.has(peer)) profileRoots.add(peer);
    }
    for (const aggregate of service.aggregates) {
      for (const event of aggregate.events) {
        for (const consumer of event.consumers) {
          if (!profileServiceIds.has(consumer.service))
            profileRoots.add(consumer.service);
        }
      }
    }
  }
  const profileOutside = [...profileRoots]
    .filter((id) => OUTSIDE.has(rootParticipants.get(id)?.kind))
    .map(safeId);
  const profileBrokers = [...profileRoots]
    .filter((id) => rootParticipants.get(id)?.kind === "broker")
    .map(safeId);
  const profileStores = (catalog.stores ?? []).filter((store) =>
    profileServiceIds.has(store.owner),
  );

  views.push(`  view ${profileLandscapeViewId(profile)} {`);
  views.push(`    title ${q(profile.title)}`);
  views.push(
    `    description 'The groups and outside systems selected by this catalog profile.'`,
  );
  views.push(
    `    include ${includeTargets([...profileContexts.map((context) => safeId(context.id)), ...profileOutside])}`,
  );
  views.push(...landscapeLabels([...profileContexts.map((context) => safeId(context.id)), ...profileOutside]));
  views.push("  }");
  views.push("");

  views.push(`  view ${profileContainersViewId(profile)} {`);
  views.push(`    title ${q(`${profile.title} containers`)}`);
  views.push(
    `    description 'The services, stores and transports selected by this catalog profile.'`,
  );
  views.push(
    `    include ${includeTargets([
      ...profileContexts.map((context) => safeId(context.id)),
      ...profileServices.map((service) => fqn(service.id)),
      ...profileStores.map((store) => fqn(store.id)),
      ...profileBrokers,
      ...profileOutside,
    ])}`,
  );
  views.push(...containerCards(profileServices));
  views.push(...transportLabels(profileServices, [...profileRoots]));
  views.push(
    ...containerPredicates(
      [...callPairs.values()].filter(
        (pair) =>
          profileServiceIds.has(pair.from) && (profileServiceIds.has(pair.to) || profileRoots.has(pair.to)),
      ),
      carriedByBus.filter(
        ([from, to]) =>
          profileServiceIds.has(from) && profileServiceIds.has(to),
      ),
      "    ",
    ),
  );
  views.push(...localQueueRanks(profileServices, [...profileRoots]));
  const profileActors = [...actorIds].map(safeId).filter((id) => profileOutside.includes(id));
  if (profileActors.length) views.push(`    rank source { ${profileActors.join(", ")} }`);
  views.push("  }");
  views.push("");
}

for (const context of catalog.contexts) {
  // --- C4 level 2: the containers of one context --------------------------
  // Services, and the databases they keep their state in. Stores are named:
  // the ones this context's services own, and the ones they only read, which
  // is how a service reading someone else's database shows up as a crossing
  // rather than as a box inside its own walls. The brokers these services
  // publish on or listen to arrive with `*` as neighbours, the way the other
  // contexts do, and are not named: naming the bus would also pull in every
  // other context's hops onto it, which are not this context's picture.
  const contextStores = new Set();
  const contextServiceIds = new Set(context.services.map((s) => s.id));
  for (const service of context.services) {
    for (const store of storesByOwner.get(service.id) ?? [])
      contextStores.add(store.id);
    for (const storeId of service.stores ?? []) {
      if (storeById.has(storeId)) contextStores.add(storeId);
    }
  }
  const include = ["*", ...[...contextStores].map(fqn)].join(", ");
  // Only the pairs the picture holds both ends of: a neighbour in another
  // context is drawn folded into its context, and naming one of its services
  // would unfold it into a second box.
  const inside = ([from, to]) =>
    contextServiceIds.has(from) && contextServiceIds.has(to);
  const pairs = [...callPairs.values()].filter((pair) =>
    inside([pair.from, pair.to]),
  );
  views.push(`  view ${contextViewId(context)} of ${safeId(context.id)} {`);
  views.push(`    title ${q(context.name)}`);
  views.push(`    include ${include}`);
  views.push(...containerCards(context.services));
  views.push(...contextLabels(context));
  views.push(
    ...containerPredicates(pairs, carriedByBus.filter(inside), "    "),
  );
  views.push("  }");

  for (const service of context.services) {
    // Still level 2, one service deep: the service as a box, and everything
    // that reaches it or that it reaches. Its own parts are excluded by name
    // rather than the subject included by name, because inside a scoped view a
    // dotted reference is read relative to the scope first — and `auth.auth`
    // read from inside `auth.auth` resolves to nothing at all.
    const parts = [
      ...service.aggregates.map((a) => safeId(a.slug)),
    ];
    views.push(`  view ${serviceViewId(service)} of ${fqn(service.id)} {`);
    views.push(`    title ${q(`${service.name} — neighbours`)}`);
    views.push("    include *, -> *, * ->");
    if (parts.length > 0) views.push(`    exclude ${parts.join(", ")}`);
    views.push(...neighbourLabels(service, context));
    views.push("  }");

    // --- C4 level 3: inside one service ------------------------------------
    // Its aggregates and its stores. Events are in the model but not in this
    // picture: a service with eleven of them would draw a wall of boxes where
    // the page already lists them, one line each.
    views.push(
      `  view ${serviceInsideViewId(service)} {`,
    );
    views.push(`    title ${q(`${service.name} — inside`)}`);
    const aggregateIds = new Set(service.aggregates.map((aggregate) => aggregate.id));
    const insideStores = new Set([
      ...(storesByOwner.get(service.id) ?? []).map((store) => store.id),
      ...[...persists.values()].filter((edge) => aggregateIds.has(edge.aggregate)).map((edge) => edge.store),
    ]);
    views.push(`    include ${[fqn(service.id), ...[...aggregateIds].map(fqn), ...[...insideStores].map(fqn)].join(", ")}`);
    views.push("    exclude * -> * where kind is owns");
    views.push("  }");
  }
}
views.push("");

for (const flow of catalog.flows) {
  const contexts = new Map(flow.participants.map((p) => [p.id, p.context]));
  const contextOf = (id) => contexts.get(id) ?? null;
  const replied = new Set();
  walkFlowSteps(flow.steps, (step) => {
    if (step.kind === "response" && step.replyTo) replied.add(step.replyTo);
  });
  views.push(`  dynamic view ${flowViewId(flow)} {`);
  views.push(`    title ${q(flow.name)}`);
  views.push(`    description ${q(flow.summary)}`);
  const body = [];
  emitSteps(flow.steps, body, "    ", replied);
  views.push(...body);
  views.push("  }");
  views.push("");

  const cross = crossContextOnly(flow.steps, contextOf);
  if (cross.length === 0) continue;
  views.push(`  dynamic view ${flowCrossViewId(flow)} {`);
  views.push(`    title ${q(`${flow.name} — crossings only`)}`);
  const crossBody = [];
  emitSteps(cross, crossBody, "    ", replied);
  views.push(...crossBody);
  views.push("  }");
  views.push("");
}
// ---------------------------------------------------------------------------
// deployment: where the services run (portolan.0012)
// ---------------------------------------------------------------------------
// One tree per environment, the cluster and the namespace as frames inside
// it, and an instance of the service in the namespace it stands in. The
// relations are the model's own: LikeC4 draws between two instances what the
// model declares between their elements, so an environment's picture shows
// the calls both ends of which are deployed there, and nothing a reader
// would have to fold by hand. One view per environment, and one per service
// that runs somewhere: its instances with the frames around them.
const deployment = [];
const deployTree = new Map(); // environment -> cluster -> namespace -> Map(service id -> {service, deployment})
const placesOfService = new Map(); // service id -> [fqn of instance]
const framesOfEnvironment = new Map(); // environment -> Set(fqn of every node under it)
for (const placed of allDeployments(catalog)) {
  for (const service of allServices) {
    if (!deploys(placed, service)) continue;
    const env = environmentOf(placed);
    const clusters = deployTree.get(env) ?? new Map();
    deployTree.set(env, clusters);
    const namespaces = clusters.get(placed.cluster) ?? new Map();
    clusters.set(placed.cluster, namespaces);
    const instances = namespaces.get(placed.namespace) ?? new Map();
    namespaces.set(placed.namespace, instances);
    // Two Applications of one service in one place is one instance: the
    // picture is about where it runs, and it runs there once.
    if (!instances.has(service.id)) instances.set(service.id, { service, deployment: placed });
  }
}
const environments = [...deployTree.keys()].sort();
const sorted = (map) => [...map.keys()].sort();
if (environments.length > 0) {
  deployment.push("deployment {");
  for (const env of environments) {
    const envId = safeId(env);
    deployment.push(`  environment ${envId} ${q(env)} {`);
    const clusters = deployTree.get(env);
    for (const cluster of sorted(clusters)) {
      const path = [envId];
      let indent = "    ";
      if (cluster) {
        path.push(safeId(cluster));
        deployment.push(`${indent}cluster ${safeId(cluster)} ${q(cluster)} {`);
        indent += "  ";
      }
      const namespaces = clusters.get(cluster);
      for (const namespace of sorted(namespaces)) {
        const nsPath = [...path];
        let nsIndent = indent;
        if (namespace) {
          nsPath.push(safeId(namespace));
          deployment.push(`${nsIndent}namespace ${safeId(namespace)} ${q(namespace)} {`);
          nsIndent += "  ";
        }
        const instances = namespaces.get(namespace);
        for (const serviceId of sorted(instances)) {
          const { service, deployment: placed } = instances.get(serviceId);
          const instanceId = safeId(service.id);
          const revision = /^[0-9a-f]{40}$/.test(placed.revision) ? placed.revision.slice(0, 7) : placed.revision;
          const about = [placed.name, revision ? `at ${revision}` : ""].filter(Boolean).join(" ");
          deployment.push(`${nsIndent}${instanceId} = instanceOf ${fqn(service.id)} {`);
          deployment.push(`${nsIndent}  description ${q(about)}`);
          deployment.push(`${nsIndent}}`);
          const places = placesOfService.get(service.id) ?? [];
          places.push([...nsPath, instanceId].join("."));
          placesOfService.set(service.id, places);
          const frames = framesOfEnvironment.get(env) ?? new Set();
          for (let depth = 2; depth <= nsPath.length; depth += 1) frames.add(nsPath.slice(0, depth).join("."));
          frames.add([...nsPath, instanceId].join("."));
          framesOfEnvironment.set(env, frames);
        }
        if (namespace) deployment.push(`${indent}}`);
      }
      if (cluster) deployment.push("    }");
    }
    deployment.push("  }");
  }
  deployment.push("}");

  views.push("");
  for (const env of environments) {
    // Every frame under the environment, named one by one rather than as
    // `env.**`: a descendant wildcard draws the instances alone and folds
    // the cluster and namespace away, and where a thing runs is the point.
    views.push(`  deployment view ${deploymentViewId(env)} {`);
    views.push(`    title ${q(`${env} — deployed`)}`);
    views.push(`    include ${[...framesOfEnvironment.get(env)].join(", ")}`);
    // No fold labels here: LikeC4 1.59 parses `include a -> b with { … }` in
    // a deployment view and then ignores it, so folded calls between two
    // instances still read `[...]`.
    views.push("  }");
  }
  for (const service of allServices) {
    const places = placesOfService.get(service.id);
    if (!places) continue;
    // The frames around each instance, named one by one: a node named with
    // its children is drawn as the frame it is, and a reader can tell the
    // two boxes apart by where they sit.
    const frames = new Set();
    for (const place of places) {
      const segments = place.split(".");
      for (let depth = 1; depth <= segments.length; depth += 1) frames.add(segments.slice(0, depth).join("."));
    }
    views.push(`  deployment view ${serviceDeployViewId(service)} {`);
    views.push(`    title ${q(`${service.name} — where it runs`)}`);
    views.push(`    include ${[...frames].join(", ")}`);
    views.push("  }");
  }
}
views.push("}");

return [
  { name: "deployment.c4", contents: `// GENERATED — do not edit.\n${deployment.join("\n")}\n` },
  { name: "spec.c4", contents: `${spec.join("\n")}\n` },
  { name: "model.c4", contents: `// GENERATED — do not edit.\n${model.join("\n")}\n` },
  { name: "views.c4", contents: `// GENERATED — do not edit.\n${views.join("\n")}\n` },
];
}

// Run as a script - `npm run likec4:gen`, before the dev server starts - the
// sources are written under likec4/ here and now.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = await loadCatalog();
  const files = await likec4Sources(bundle);
  mkdirSync("likec4", { recursive: true });
  for (const file of files) writeFileSync(join("likec4", file.name), file.contents);
  console.log(
    `wrote ${files.map((file) => `likec4/${file.name}`).join(", ")} ` +
      `(${files.find((file) => file.name === "views.c4").contents.match(/dynamic view /g)?.length ?? 0} dynamic views)`,
  );
}
