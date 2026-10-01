// Dynamic views: one per flow with every frame the catalog has, and one of
// its crossings alone when a step leaves a bounded context.

import { flowCrossViewId, flowViewId, q } from "./ids.mjs";
import { walkFlowSteps } from "./participants.mjs";
import { KIND_HEAD } from "./specification.mjs";
import { isCrossContext } from "../../src/flow/cross-context.ts";

/** How a flow's steps are emitted, and how the ones that cross a context are kept. */
export function flowSteps(g) {
  const { catalog, participantRef } = g;
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
  return { emitSteps, crossContextOnly };
}

/** The dynamic views of every flow. */
export function flowViews(g) {
  const { catalog, views, emitSteps, crossContextOnly } = g;
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
}
