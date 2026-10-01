import type {
  Catalog,
  Flow,
  FlowNode,
  FlowTrigger,
  Step,
} from "../catalog-model.ts";
import {
  REDIS_OPERATIONS,
  allServices,
  allStores,
  walkSteps,
} from "../catalog-model.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";

/**
 * What a flow step's `ref` may resolve against. `validateCatalog` builds the
 * sets; `validateContexts` fills the events, calls and provided methods while
 * it walks the services; `validateFlows` reads all five once every service
 * has been seen. The sets are shared by reference, so the two must run in
 * that order.
 */
export type StepRefs = {
  eventIds: Set<string>;
  rpcIds: Set<string>;
  providedRpcRefs: Set<string>;
  storeIds: Set<string>;
  operationRefs: Set<string>;
};

/**
 * Every flow: its participants, trigger, frames, steps, examples, responses
 * and composition seams, in the order `validateCatalog` always checked them.
 */
export function validateFlows(catalog: Catalog, refs: StepRefs): void {
  const { eventIds, rpcIds, providedRpcRefs, storeIds, operationRefs } = refs;

  assertUniqueSlugs(
    catalog.flows.map((f) => f.slug),
    "catalog",
    "flow",
  );

  const flowGroupIds = new Set(catalog.contexts.map((c) => c.id));
  const flowEntityKind = new Map<string, "service" | "store" | "external">();
  for (const service of allServices(catalog)) flowEntityKind.set(service.id, "service");
  for (const store of allStores(catalog)) flowEntityKind.set(store.id, "store");
  for (const external of catalog.externals ?? []) flowEntityKind.set(external.id, "external");

  const triggerKinds = new Set<FlowTrigger["kind"]>([
    "http",
    "callback",
    "event",
    "message",
    "job",
    "startup",
    "scheduled",
    "manual",
    "unproven",
  ]);
  const triggerConfidence = new Set<FlowTrigger["confidence"]>([
    "high",
    "medium",
    "low",
  ]);

  for (const flow of catalog.flows) {
    const lanes = new Set(flow.participants.map((p) => p.id));
    if (lanes.size !== flow.participants.length) {
      fail(
        `flow "${flow.slug}" has duplicate participant ids`,
        `flow ${flow.id}`,
      );
    }
    for (const participant of flow.participants) {
      if (!participant.entityRef) continue;
      const expected = flowEntityKind.get(participant.entityRef);
      if (!expected) {
        fail(
          `flow "${flow.slug}" participant "${participant.id}" refers to unknown entity "${participant.entityRef}"`,
          `flow ${flow.id} / participant ${participant.id}`,
        );
      } else if (participant.kind !== expected && participant.kind !== "unknown") {
        fail(
          `flow "${flow.slug}" participant "${participant.id}" is ${participant.kind} but entity "${participant.entityRef}" is ${expected}`,
          `flow ${flow.id} / participant ${participant.id}`,
        );
      }
    }
    // Whatever derived the flow knew which service's tree it was reading, so
    // there is no case where the owner is unknowable. Without it the flow has
    // no group to sit under and the tree files it as a defect.
    if (flow.owner === undefined) {
      fail(
        `flow "${flow.slug}" names no owner; a flow must state the group it belongs to`,
        `flow ${flow.id}`,
      );
    }
    if (flow.owner !== undefined && !flowGroupIds.has(flow.owner)) {
      fail(
        `flow "${flow.slug}" names owner "${flow.owner}", which is not a top-level group`,
        `flow ${flow.id}`,
      );
    }
    if (flow.trigger && !triggerKinds.has(flow.trigger.kind)) {
      fail(
        `flow "${flow.slug}" has unknown trigger kind "${flow.trigger.kind}"`,
        `flow ${flow.id}`,
      );
    }
    if (flow.trigger && !triggerConfidence.has(flow.trigger.confidence)) {
      fail(
        `flow "${flow.slug}" has unknown trigger confidence "${flow.trigger.confidence}"`,
        `flow ${flow.id}`,
      );
    }
    if (flow.includes) {
      const included = new Set<string>();
      for (const slug of flow.includes) {
        if (!slug || slug === flow.slug || included.has(slug)) {
          fail(
            `flow "${flow.slug}" has an invalid or duplicate included flow "${slug}"`,
            `flow ${flow.id}`,
          );
        }
        included.add(slug);
      }
    }
    validateFlowFrames(flow, flow.steps);

    const steps = walkSteps(flow.steps);
    const stepIds = new Set<string>();
    const stepById = new Map<string, Step>();
    for (const step of steps) {
      if (stepIds.has(step.id)) {
        fail(
          `flow "${flow.slug}" has duplicate step id "${step.id}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      stepIds.add(step.id);
      stepById.set(step.id, step);

      if (
        !(["rpc", "event", "call", "response"] as const).includes(step.kind)
      ) {
        fail(
          `flow "${flow.slug}" step "${step.id}" has unknown kind "${step.kind}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }

      if (step.reaches?.some((entrypoint) => entrypoint.length === 0)) {
        fail(
          `flow "${flow.slug}" step "${step.id}" has an empty reached source function`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.handoff) {
        if (!(["message", "job"] as const).includes(step.handoff.kind)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown handoff kind "${step.handoff.kind}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!step.handoff.transport) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a handoff with no transport`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!step.handoff.channel) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a handoff with no channel`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (step.handoff.kind === "job" && !step.handoff.message) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a job handoff with no message`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!(["send", "receive"] as const).includes(step.handoff.direction)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown handoff direction "${step.handoff.direction}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
      if (step.storeAccess) {
        if (step.kind !== "call") {
          fail(
            `flow "${flow.slug}" step "${step.id}" has store access metadata but is not a call`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!storeIds.has(step.storeAccess.store)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" names unknown store "${step.storeAccess.store}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.storeAccess.operation !== undefined &&
          !REDIS_OPERATIONS.includes(step.storeAccess.operation)
        ) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown store operation "${step.storeAccess.operation}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
      if (step.http) {
        if (step.kind !== "response") {
          fail(
            `flow "${flow.slug}" step "${step.id}" has HTTP response metadata but is not a response`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.http.status !== undefined &&
          (step.http.status < 100 || step.http.status > 599)
        ) {
          fail(
            `flow "${flow.slug}" response "${step.id}" has invalid HTTP status ${step.http.status}`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.http.outcome !== undefined &&
          !(["success", "error"] as const).includes(step.http.outcome)
        ) {
          fail(
            `flow "${flow.slug}" response "${step.id}" has unknown HTTP outcome "${step.http.outcome}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }

      if (!lanes.has(step.from)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": from "${step.from}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (!lanes.has(step.to)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": to "${step.to}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.ref !== undefined && step.status !== "unresolved") {
        const resolves =
          eventIds.has(step.ref) ||
          rpcIds.has(step.ref) ||
          (step.kind === "rpc" &&
            providedRpcRefs.has(`${step.to}|${step.ref}`)) ||
          (step.kind === "call" &&
            operationRefs.has(`${step.to}|${step.ref}`));
        if (!resolves) {
          fail(
            `flow "${flow.slug}" step "${step.id}": ref "${step.ref}" resolves to neither an Event, an RpcCall, a method provided by "${step.to}" nor an operation of "${step.to}", and status is "${step.status}" rather than "unresolved"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
    }

    // An example names the steps it showed by id; one that names a step
    // the flow does not have is a recording of some other flow, or of this
    // one before it changed, and either way it would be shown next to the
    // wrong step.
    const exampleIds = new Set<string>();
    for (const example of flow.examples ?? []) {
      if (!example.id || !example.recording || !example.traceId) {
        fail(
          `flow "${flow.slug}" has an example with no id, recording or trace id`,
          `flow ${flow.id}`,
        );
      }
      if (exampleIds.has(example.id)) {
        fail(
          `flow "${flow.slug}" carries example "${example.id}" twice`,
          `flow ${flow.id}`,
        );
      }
      exampleIds.add(example.id);
      for (const shown of example.steps) {
        if (!stepById.has(shown.step)) {
          fail(
            `flow "${flow.slug}" example "${example.id}" shows unknown step "${shown.step}"`,
            `flow ${flow.id}`,
          );
        }
      }
    }

    for (const step of steps) {
      if (step.kind !== "response") {
        if (step.replyTo !== undefined) {
          fail(
            `flow "${flow.slug}" step "${step.id}" is not a response but names replyTo "${step.replyTo}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        continue;
      }
      if (!step.replyTo) {
        fail(
          `flow "${flow.slug}" response "${step.id}" names no request in replyTo`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      const request = stepById.get(step.replyTo);
      if (!request || request.kind !== "rpc") {
        fail(
          `flow "${flow.slug}" response "${step.id}" replies to "${step.replyTo}", which is not an rpc request`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.from !== request.to || step.to !== request.from) {
        fail(
          `flow "${flow.slug}" response "${step.id}" does not reverse request "${request.id}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
    }
    for (const composition of flow.composition ?? []) {
      if (!composition.flow || composition.flow === flow.slug) {
        fail(
          `flow "${flow.slug}" composition names an empty or self fragment "${composition.flow}"`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (!stepIds.has(composition.seam.afterStep)) {
        fail(
          `flow "${flow.slug}" composition seam names unknown step "${composition.seam.afterStep}"`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (!composition.seam.target.trim()) {
        fail(
          `flow "${flow.slug}" composition fragment "${composition.flow}" has an empty seam target`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (!composition.seam.basis.trim()) {
        fail(
          `flow "${flow.slug}" composition fragment "${composition.flow}" has an empty seam basis`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (!(flow.includes ?? []).includes(composition.flow)) {
        fail(
          `flow "${flow.slug}" composition fragment "${composition.flow}" is absent from includes`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (
        !(["entrypoint", "reachability", "handoff"] as const).includes(
          composition.seam.kind,
        )
      ) {
        fail(
          `flow "${flow.slug}" composition has unknown seam kind "${composition.seam.kind}"`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
      if (
        !(["high", "medium", "low"] as const).includes(
          composition.seam.confidence,
        )
      ) {
        fail(
          `flow "${flow.slug}" composition has unknown confidence "${composition.seam.confidence}"`,
          `flow ${flow.id} / composition ${composition.flow}`,
        );
      }
    }
  }
}

/**
 * Frames have to mean what they say. An alt with one branch is not a choice, an
 * untitled branch states no condition, and steps written after an alt whose
 * every branch is terminal can never run — each of those would be drawn as a
 * perfectly ordinary sequence, which is exactly the reading we are trying to
 * stop, so they fail the build instead.
 */
function validateFlowFrames(flow: Flow, nodes: FlowNode[]): void {
  nodes.forEach((node, i) => {
    switch (node.type) {
      case "step":
        break;
      case "parallel":
        for (const branch of node.branches) validateFlowFrames(flow, branch);
        break;
      case "loop":
        if (!node.title) {
          fail(
            `flow "${flow.slug}" loop "${node.id}" has no title, so the diagram cannot say what it repeats until`,
            `flow ${flow.id} / loop ${node.id}`,
          );
        }
        validateFlowFrames(flow, node.steps);
        break;
      case "alt": {
        if (node.branches.length < 2) {
          fail(
            `flow "${flow.slug}" alt "${node.id}" has ${node.branches.length} branch(es); an alt states a choice and needs at least two`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        const titles = new Set<string>();
        for (const branch of node.branches) {
          if (!branch.title) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has a branch with no title, so nothing says when it runs`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          if (titles.has(branch.title)) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has two branches titled "${branch.title}"`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          titles.add(branch.title);
          validateFlowFrames(flow, branch.steps);
        }
        if (node.branches.every((b) => b.terminal) && i < nodes.length - 1) {
          fail(
            `flow "${flow.slug}" alt "${node.id}": every branch is terminal, so the ${nodes.length - 1 - i} node(s) after it can never run`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        break;
      }
    }
  });
}
