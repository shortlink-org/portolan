// Flows: a sequence read out of source, its participants, steps and framing
// nodes, the recordings that showed it running, and the traversal helpers
// derived from the steps.

import type { Field, RelationEvidence, Status } from "./shared.ts";
import type { HTTPDestination } from "./interfaces.ts";
import type { RedisOperation } from "./stores.ts";

/**
 * A sequence read out of source.
 *
 * Extractors may attach the execution trigger they proved. Authored flows omit
 * it when that evidence is not part of the document.
 */
export interface Flow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  source?: string; // the file the flow was read out of
  /** Source-backed execution root and the strength of that evidence. */
  trigger?: FlowTrigger;
  /** Source function this flow expands, used for evidence-backed composition. */
  entrypoint?: string;
  /** Source-backed flow fragments composed into this root flow. */
  includes?: string[];
  /** Why and where each source-backed fragment was composed. */
  composition?: FlowComposition[];
  /**
   * The top-level group this flow belongs to. Whatever derived the flow read
   * one component's tree to find it and therefore knows the answer, so the flow
   * states it instead of leaving a reader to recover it from `source` - and the
   * validator holds every flow to it, because a flow with no owner has nowhere
   * to sit in the tree.
   */
  owner: string;
  participants: Participant[]; // order is significant - it is the lane order
  steps: FlowNode[];
  /**
   * Recordings of this flow running: one per trace a verifier kept, each
   * naming the steps it showed with what the spans said about them. Examples
   * of data, not evidence - the evidence is the status on the step.
   */
  examples?: FlowExample[];
}
/** One recorded run of a flow, read from one trace. */
export interface FlowExample {
  /** "<recording>#<trace id>": unique within the flow, stable across runs. */
  id: string;
  /**
   * The file the trace was read from, relative to the verify step's input
   * root - where an uploaded recording is kept.
   */
  recording: string;
  traceId: string;
  /** When the root span started, RFC 3339 UTC; absent when the recording has no clock. */
  recordedAt?: string;
  /** Root start to the last end the trace shows. */
  durationMs: number;
  /** The steps this trace showed, in the order it showed them. */
  steps: ExampleStep[];
}
/**
 * What one span said about one step. Only an allowlist of attributes is
 * carried: names, verbs, routes, status codes - never a query text, a header
 * or a path with an id in it.
 */
export interface ExampleStep {
  step: string;
  label?: string;
  durationMs: number;
  attributes?: Record<string, string>;
}
/**
 * How many recordings showed a step. On a declared step it accompanies the
 * raised status; on a step no source declares it is why the step is there.
 */
export interface StepSeen {
  traces: number;
}
export interface FlowTrigger {
  kind:
    | "http"
    | "callback"
    | "event"
    | "message"
    | "job"
    | "startup"
    | "scheduled"
    | "manual"
    | "unproven";
  label?: string;
  confidence: "high" | "medium" | "low";
}
export interface Participant {
  id: string;
  kind: "actor" | "service" | "broker" | "store" | "external" | "unknown";
  context: string | null; // null for actors and brokers
  label?: string;
  /** Canonical Service, Store or External id represented by this lane. */
  entityRef?: string;
}
export interface FlowComposition {
  /** Slug of the fragment inserted into the root flow. */
  flow: string;
  /** Source file of that fragment, when known. */
  source?: string;
  seam: {
    /** Step after which the fragment was inserted, in the composed flow. */
    afterStep: string;
    kind: "entrypoint" | "reachability" | "handoff";
    /** Source function or transport/channel tuple that proves the seam. */
    target: string;
    basis: string;
    confidence: "high" | "medium" | "low";
  };
}
export type FlowNode = Step | Parallel | Alt | Loop;

export interface Step {
  evidence?: RelationEvidence[];
  destination?: HTTPDestination;
  type: "step";
  id: string;
  from: string;
  to: string; // participant ids; from === to is a self-message
  kind: "rpc" | "event" | "call" | "response";
  ref?: string; // Event.id, RpcCall.id or provided RPC method id; otherwise unresolved
  label?: string;
  status: Status;
  note?: string;
  line?: string;
  /** Synchronous request step this synthesized response returns from. */
  replyTo?: string;
  /** Proven HTTP wire contract for a response step. */
  http?: HTTPResponse;
  /** Source function execution enters here, when an extractor can prove it. */
  continuesAt?: string;
  /** Source functions proven to execute on the path represented by this step. */
  reaches?: string[];
  /** Exact asynchronous send/receive evidence used for flow composition. */
  handoff?: FlowHandoff;
  /** Repository call resolved to a concrete store operation after merge. */
  storeAccess?: FlowStoreAccess;
  /** Recordings that showed this hop; set by a verifier. */
  seen?: StepSeen;
}
export interface HTTPResponse {
  status?: number;
  contentType?: string;
  body?: string;
  /** RPC method whose response value is serialized into this body. */
  bodyRef?: string;
  encoding?: string;
  outcome?: "success" | "error";
  warning?: string;
  source?: string;
  /** Shape recovered directly from a literal response body. */
  fields?: Field[];
}
export interface FlowHandoff {
  kind: "message" | "job";
  transport: string;
  channel: string;
  message?: string;
  direction: "send" | "receive";
}
export interface FlowStoreAccess {
  store: string;
  method?: string;
  operation?: RedisOperation;
  keyspace?: string;
  /** Concrete adapter call rather than the use-case-side repository call. */
  source?: string;
}
export interface Parallel {
  type: "parallel";
  id: string;
  title?: string;
  branches: FlowNode[][];
}
/**
 * A choice. Exactly one branch runs, so the branches are not a sequence and
 * nothing that reads a flow may treat them as one.
 *
 * `terminal` marks a branch that ENDS the flow rather than rejoining it — the
 * cancel arm of a risk check, say. Without it a reader has no way to tell that
 * the steps drawn after the alt do not follow that branch, and the sequence
 * reads as "the order was cancelled and then charged".
 */
export interface Alt {
  type: "alt";
  id: string;
  branches: AltBranch[];
}
export interface AltBranch {
  /** The condition under which this branch runs, in words. */
  title: string;
  steps: FlowNode[];
  /** True when the flow stops here instead of continuing past the alt. */
  terminal?: boolean;
  /**
   * Recordings that went this way, on a frame a verifier wrote where the
   * recordings parted. A branch with no steps and a count is the recordings
   * that went no further.
   */
  seen?: StepSeen;
}
export interface Loop {
  type: "loop";
  id: string;
  title: string;
  steps: FlowNode[];
}

// ---------------------------------------------------------------------------
// Traversal helpers. Everything here is DERIVED from the steps, never stored in
// the JSON.
//
// There is deliberately no flow-level score. How far a flow can be trusted is
// said step by step, by each `Step.status`; a ratio over those averaged claims
// that are not comparable, hid the only actionable one (`unresolved`), and —
// once alt branches are counted — divided by a number no single execution ever
// reaches.
// ---------------------------------------------------------------------------

/** Depth-first walk over every Step in a node list, in numbering order. */
export function walkSteps(nodes: FlowNode[]): Step[] {
  const out: Step[] = [];
  const visit = (list: FlowNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case "step":
          out.push(node);
          break;
        case "parallel":
          for (const branch of node.branches) visit(branch);
          break;
        case "alt":
          for (const branch of node.branches) visit(branch.steps);
          break;
        case "loop":
          visit(node.steps);
          break;
      }
    }
  };
  visit(nodes);
  return out;
}

/**
 * One frame enclosing a step: the alt, parallel or loop it sits inside.
 *
 * This is what the rail and the detail panel need in order to say *under what
 * condition* a step runs. Without it a step is just a line in a sequence, and
 * a reader cannot tell an alternative apart from a consequence.
 */
export interface StepFrame {
  kind: "parallel" | "alt" | "loop";
  /** Id of the Parallel / Alt / Loop node. */
  id: string;
  /** Loop or parallel title. An alt carries its condition on the branch. */
  title?: string;
  /** Alt: the branch condition. Parallel: the 1-based branch number. */
  branch?: string;
  /** Alt only: this branch ends the flow rather than rejoining it. */
  terminal?: boolean;
}

/**
 * The frames around every step, outermost first. Steps not inside any frame
 * map to an empty list, so callers never have to special-case the flat case.
 */
export function stepFrames(nodes: FlowNode[]): Map<string, StepFrame[]> {
  const out = new Map<string, StepFrame[]>();
  const visit = (list: FlowNode[], stack: StepFrame[]): void => {
    for (const node of list) {
      switch (node.type) {
        case "step":
          out.set(node.id, stack);
          break;
        case "parallel":
          node.branches.forEach((branch, i) =>
            visit(branch, [
              ...stack,
              {
                kind: "parallel",
                id: node.id,
                title: node.title,
                branch: String(i + 1),
              },
            ]),
          );
          break;
        case "alt":
          for (const branch of node.branches) {
            visit(branch.steps, [
              ...stack,
              {
                kind: "alt",
                id: node.id,
                branch: branch.title,
                terminal: branch.terminal,
              },
            ]);
          }
          break;
        case "loop":
          visit(node.steps, [
            ...stack,
            { kind: "loop", id: node.id, title: node.title },
          ]);
          break;
      }
    }
  };
  visit(nodes, []);
  return out;
}

/**
 * The conditions a step runs under, outermost first — the alt branches around
 * it and nothing else. A step with none of these runs on every path.
 */
export function stepConditions(frames: readonly StepFrame[]): StepFrame[] {
  return frames.filter((f) => f.kind === "alt");
}

/** Contexts touched by a flow, in participant order, ignoring null-context lanes. */
export function flowContexts(flow: Flow): string[] {
  const seen: string[] = [];
  for (const p of flow.participants) {
    if (p.context && !seen.includes(p.context)) seen.push(p.context);
  }
  return seen;
}
