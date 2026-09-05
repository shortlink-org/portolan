// Generates likec4/ sources from the merged catalog.
//
// Everything LikeC4 renders is DECLARED here: the C4 views and one dynamic view
// per flow (plus a cross-context-only twin). Nothing in the app draws these
// pictures itself.
//
//   node scripts/gen-likec4.mjs

import { writeFileSync, mkdirSync } from "node:fs";

import { loadCatalog } from "./catalog-sources.mjs";
import reserved from "../src/likec4/reserved.json" with { type: "json" };

// Every source, not one file: a service that publishes its own facts gets a
// C4 view like any other, and generating from a single file would leave it out
// of the pictures while the rest of the app knows about it.
const { catalog } = await loadCatalog();

// --- ids (mirrors src/likec4/ids.ts; kept in step by src/likec4/ids.test.ts) ---
// The reserved words are not mirrored, they are the same file: a word the
// grammar has taken must be escaped identically on both sides or a clicked
// node stops finding what it stands for.
const RESERVED = new Set(reserved);
const safeId = (raw) => {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || RESERVED.has(cleaned) ? `_${cleaned}` : cleaned;
};
const fqn = (id) => id.split(".").map(safeId).join(".");
const flowViewId = (flow) => `flow_${safeId(flow.slug)}`;
const flowCrossViewId = (flow) => `${flowViewId(flow)}_cross`;
const contextViewId = (c) => `ctx_${safeId(c.id)}`;
const serviceViewId = (s) => `svc_${safeId(s.id)}`;
const serviceInsideViewId = (s) => `${serviceViewId(s)}_inside`;
const LANDSCAPE_VIEW = "landscape";

const q = (text) => `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// --- shared visual language ------------------------------------------------
// These hex values are the light/dark-neutral midpoints of the --ctx-N and
// --status-* tokens in src/index.css. LikeC4 bakes colours into its own theme,
// so the seam between renderers is kept invisible by hand here.
const CTX_COLORS = ["#4a86c8", "#9a66cc", "#2aa196", "#c4703f", "#6b7cb4", "#b46b8b"];
const STATUS_COLORS = {
  verified: "#2f9e63",
  declared: "#b8912f",
  unresolved: "#e0453f",
};
const STATUS_LINE = { verified: "solid", declared: "dashed", unresolved: "dotted" };
const KIND_HEAD = { event: "onormal", rpc: "normal", call: "none" };

const contextColorName = (contextId) => {
  const i = catalog.contexts.findIndex((c) => c.id === contextId);
  return `ctx${(i < 0 ? 0 : i) % CTX_COLORS.length}`;
};

// --- collect participants that are not catalog services --------------------
const serviceIds = new Set(
  catalog.contexts.flatMap((c) => c.services.map((s) => s.id)),
);
const rootParticipants = new Map(); // id -> kind
for (const flow of catalog.flows) {
  for (const p of flow.participants) {
    if (serviceIds.has(p.id)) continue;
    rootParticipants.set(p.id, { kind: p.kind, label: p.label ?? p.id });
  }
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
for (const [id, meta] of rootParticipants) participantByLabel.set(meta.label, id);
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
    else if (node.type === "parallel") node.branches.forEach((b) => walkFlowSteps(b, visit));
    else if (node.type === "loop") walkFlowSteps(node.steps, visit);
    else if (node.type === "alt") node.branches.forEach((b) => walkFlowSteps(b.steps, visit));
  }
}

// ---------------------------------------------------------------------------
// specification
// ---------------------------------------------------------------------------
const spec = [];
spec.push("// GENERATED by scripts/gen-likec4.mjs from the merged catalog — do not edit.");
spec.push("specification {");
CTX_COLORS.forEach((hex, i) => spec.push(`  color ctx${i} ${hex}`));
for (const [name, hex] of Object.entries(STATUS_COLORS)) {
  spec.push(`  color ${name} ${hex}`);
}
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
spec.push("}");

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------
const model = [];
model.push("model {");

for (const [id, meta] of rootParticipants) {
  model.push(`  ${safeId(id)} = ${meta.kind} ${q(meta.label)}`);
}
model.push("");

for (const context of catalog.contexts) {
  model.push(`  ${safeId(context.id)} = context ${q(context.name)} {`);
  model.push(`    description ${q(context.summary)}`);
  model.push(`    style { color ${contextColorName(context.id)} }`);
  for (const service of context.services) {
    model.push(`    ${safeId(service.slug)} = service ${q(service.name)} {`);
    model.push(`      description ${q(`${service.repo}/${service.path}`)}`);
    model.push(`      style { color ${contextColorName(context.id)} }`);
    for (const aggregate of service.aggregates) {
      model.push(`      ${safeId(aggregate.slug)} = aggregate ${q(aggregate.name)} {`);
      for (const event of aggregate.events) {
        const latest = event.versions[event.versions.length - 1];
        model.push(`        ${safeId(event.name)} = event ${q(event.name)} {`);
        model.push(`          description ${q(latest?.doc ?? "")}`);
        model.push("        }");
      }
      model.push("      }");
    }
    for (const store of storesByOwner.get(service.id) ?? []) {
      model.push(`      ${safeId(store.slug)} = store ${q(store.name)} {`);
      model.push(`        description ${q(store.kind)}`);
      model.push("      }");
    }
    model.push("    }");
  }
  model.push("  }");
}
model.push("");

// relations: event consumption, then rpc calls
const relations = [];
for (const context of catalog.contexts) {
  for (const service of context.services) {
    for (const aggregate of service.aggregates) {
      for (const event of aggregate.events) {
        for (const consumer of event.consumers) {
          // A service hearing its own event is a fact about the event, not
          // an arrow between two boxes; the app's graph keeps it on the
          // event for the same reason.
          if (consumer.service === service.id) continue;
          relations.push(
            `  ${fqn(service.id)} -> ${fqn(consumer.service)} ${q(event.name)} {\n` +
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
      relations.push(
        `  ${fqn(service.id)} -> ${fqn(peer)} ${q(method)} {\n` +
          `    style { color ${call.status}  line ${STATUS_LINE[call.status]}  head normal }\n` +
          `  }`,
      );
    }
    // Owning a store is containment and needs no arrow. Reading one somebody
    // else owns is the arrow worth drawing, and it is the same fact the
    // Problems page reports: a database with a second reader.
    for (const storeId of service.stores ?? []) {
      const store = storeById.get(storeId);
      if (!store || store.owner === service.id) continue;
      relations.push(
        `  ${fqn(service.id)} -> ${fqn(store.id)} 'reads' {\n` +
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
const persists = new Map(); // "aggregate|store" -> { aggregate, store, tables:[] }
for (const store of catalog.stores ?? []) {
  for (const table of store.tables) {
    const aggregate = table.persists?.aggregate;
    if (!aggregate) continue;
    const key = `${aggregate}|${store.id}`;
    const edge = persists.get(key) ?? { aggregate, store: store.id, tables: [] };
    edge.tables.push(table.name);
    persists.set(key, edge);
  }
}
for (const edge of persists.values()) {
  const label =
    edge.tables.length > 3 ? `${edge.tables.length} tables` : edge.tables.join(", ");
  relations.push(
    `  ${fqn(edge.aggregate)} -> ${fqn(edge.store)} ${q(label)} {\n` +
      `    style { color declared  line ${STATUS_LINE.declared}  head normal }\n` +
      `  }`,
  );
}

// An actor is the one participant nothing else in the catalog can place: no
// repository imports the customer, and no event names them. A flow step is
// the only evidence that they touch the estate at all, so it is read as a
// relation — once per pair, however many flows walk it.
const STATUS_RANK = { verified: 0, declared: 1, unresolved: 2 };
const actorIds = new Set(
  [...rootParticipants].filter(([, meta]) => meta.kind === "actor").map(([id]) => id),
);
const actorEdges = new Map(); // "from|to" -> { from, to, flows:Set, status }
for (const flow of catalog.flows) {
  walkFlowSteps(flow.steps, (step) => {
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
    if (STATUS_RANK[step.status] < STATUS_RANK[edge.status]) edge.status = step.status;
    actorEdges.set(key, edge);
  });
}
for (const edge of actorEdges.values()) {
  const names = [...edge.flows];
  const label = names.length === 1 ? names[0] : `${names.length} flows`;
  relations.push(
    `  ${fqn(edge.from)} -> ${fqn(edge.to)} ${q(label)} {\n` +
      `    style { color ${edge.status}  line ${STATUS_LINE[edge.status]}  head normal }\n` +
      `  }`,
  );
}

model.push(...relations);
model.push("}");

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
// --- what comes back from a call (mirrors src/flow/answers.ts) -------------
// The catalog records hops and never replies, so a reply is looked up in the
// contract the step reaches. It rides on the step's own label rather than
// becoming an arrow of its own: a dynamic view numbers its steps, and those
// numbers are the ones the rail beside the canvas counts.
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

function answerOf(step) {
  if (step.kind !== "rpc") return "";
  if (step.ref) return methodOf.get(step.ref)?.response ?? "";
  const service = serviceById.get(step.to);
  if (!service || !step.label) return "";
  for (const provided of service.provides) {
    const found = provided.methods.find((m) => m.name === step.label);
    if (found) return found.response ?? "";
  }
  return "";
}

function emitSteps(nodes, out, indent) {
  for (const node of nodes) {
    if (node.type === "step") {
      const answer = answerOf(node);
      const label =
        (node.label ?? node.ref ?? node.kind) + (answer ? ` → ${answer}` : "");
      const attrs = [
        `color ${node.status}`,
        `line ${STATUS_LINE[node.status]}`,
        `head ${KIND_HEAD[node.kind]}`,
      ];
      // The condition used to be pasted onto every label because there was no
      // frame to carry it. There is one now, so the label is just the message.
      const notes = [];
      if (node.note) notes.push(node.note);
      if (node.line) notes.push(node.line);
      out.push(`${indent}${fqn(node.from)} -> ${fqn(node.to)} ${q(label)} {`);
      out.push(`${indent}  ${attrs.join("  ")}`);
      if (notes.length > 0) out.push(`${indent}  notes ${q(notes.join(" — "))}`);
      out.push(`${indent}}`);
      continue;
    }
    if (node.type === "parallel") {
      out.push(`${indent}par ${node.title ? `${q(node.title)} ` : ""}{`);
      for (const branch of node.branches) emitSteps(branch, out, `${indent}  `);
      out.push(`${indent}}`);
      continue;
    }
    if (node.type === "loop") {
      out.push(`${indent}loop ${q(node.title)} {`);
      emitSteps(node.steps, out, `${indent}  `);
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
          emitSteps(branch.steps, out, `${indent}      `);
          out.push(`${indent}    }`);
        } else {
          emitSteps(branch.steps, out, `${indent}    `);
        }
        out.push(`${indent}  }`);
      });
      out.push(`${indent}}`);
    }
  }
}

/** Keeps only steps that actually leave a bounded context. */
function crossContextOnly(nodes, contextOf) {
  const keep = (step) => {
    if (step.kind === "call") return false;
    if (step.from === step.to) return false;
    const a = contextOf(step.from);
    const b = contextOf(step.to);
    return !(a !== null && a === b);
  };
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
// consumers nothing in the catalog accounts for. Brokers and the stores a
// flow names are left out on purpose — they are containers, and they belong
// to the level below.
//
// This is not /graph's picture: that one is services against the events they
// carry, and it is drawn by React Flow. No picture is drawn by both.
const OUTSIDE = new Set(["actor", "external", "unknown"]);
const outside = [...rootParticipants]
  .filter(([, meta]) => OUTSIDE.has(meta.kind))
  .map(([id]) => safeId(id));
views.push(`  view ${LANDSCAPE_VIEW} {`);
views.push("    title 'Estate'");
views.push(
  "    description 'Every bounded context, and everything outside the estate that touches one.'",
);
views.push(
  `    include ${[...catalog.contexts.map((c) => safeId(c.id)), ...outside].join(", ")}`,
);
views.push("  }");
views.push("");

for (const context of catalog.contexts) {
  // --- C4 level 2: the containers of one context --------------------------
  // Services, and the databases they keep their state in. A store is a
  // grandchild of the context, so `*` does not reach it and each one is named:
  // the ones this context's services own, and the ones they only read, which
  // is how a service reading someone else's database shows up as a crossing
  // rather than as a box inside its own walls.
  const contextStores = new Set();
  for (const service of context.services) {
    for (const store of storesByOwner.get(service.id) ?? []) contextStores.add(store.id);
    for (const storeId of service.stores ?? []) {
      if (storeById.has(storeId)) contextStores.add(storeId);
    }
  }
  const include = ["*", ...[...contextStores].map(fqn)].join(", ");
  views.push(`  view ${contextViewId(context)} of ${safeId(context.id)} {`);
  views.push(`    title ${q(context.name)}`);
  views.push(`    include ${include}`);
  views.push("  }");

  for (const service of context.services) {
    // Still level 2, one service deep: the service as a box, and everything
    // that reaches it or that it reaches. Its own parts are excluded by name
    // rather than the subject included by name, because inside a scoped view a
    // dotted reference is read relative to the scope first — and `auth.auth`
    // read from inside `auth.auth` resolves to nothing at all.
    const parts = [
      ...service.aggregates.map((a) => safeId(a.slug)),
      ...(storesByOwner.get(service.id) ?? []).map((store) => safeId(store.slug)),
    ];
    views.push(`  view ${serviceViewId(service)} of ${fqn(service.id)} {`);
    views.push(`    title ${q(`${service.name} — neighbours`)}`);
    views.push("    include *, -> *, * ->");
    if (parts.length > 0) views.push(`    exclude ${parts.join(", ")}`);
    views.push("  }");

    // --- C4 level 3: inside one service ------------------------------------
    // Its aggregates and its stores. Events are in the model but not in this
    // picture: a service with eleven of them would draw a wall of boxes where
    // the page already lists them, one line each.
    views.push(`  view ${serviceInsideViewId(service)} of ${fqn(service.id)} {`);
    views.push(`    title ${q(`${service.name} — inside`)}`);
    views.push("    include *");
    views.push("  }");
  }
}
views.push("");

for (const flow of catalog.flows) {
  const contexts = new Map(flow.participants.map((p) => [p.id, p.context]));
  const contextOf = (id) => contexts.get(id) ?? null;

  views.push(`  dynamic view ${flowViewId(flow)} {`);
  views.push(`    title ${q(flow.name)}`);
  views.push(`    description ${q(flow.summary)}`);
  const body = [];
  emitSteps(flow.steps, body, "    ");
  views.push(...body);
  views.push("  }");
  views.push("");

  const cross = crossContextOnly(flow.steps, contextOf);
  views.push(`  dynamic view ${flowCrossViewId(flow)} {`);
  views.push(`    title ${q(`${flow.name} — crossings only`)}`);
  const crossBody = [];
  emitSteps(cross, crossBody, "    ");
  if (crossBody.length === 0) {
    // A flow with no crossing at all still needs a renderable view.
    const first = flow.participants[0];
    if (first) crossBody.push(`    ${fqn(first.id)} -> ${fqn(first.id)} 'no cross-context step'`);
  }
  views.push(...crossBody);
  views.push("  }");
  views.push("");
}
views.push("}");

mkdirSync("likec4", { recursive: true });
writeFileSync("likec4/spec.c4", `${spec.join("\n")}\n`);
writeFileSync("likec4/model.c4", `// GENERATED — do not edit.\n${model.join("\n")}\n`);
writeFileSync("likec4/views.c4", `// GENERATED — do not edit.\n${views.join("\n")}\n`);

console.log(
  `wrote likec4/spec.c4, likec4/model.c4, likec4/views.c4 ` +
    `(${catalog.flows.length * 2} dynamic views, ${relations.length} relations)`,
);
