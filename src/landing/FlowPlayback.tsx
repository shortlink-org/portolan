// The tour's second stop: one real flow, played.
//
// The steps on the left are the flow's own, in order, with the status each
// one has in the catalog. The canvas on the right is the flow's participants,
// placed by elk, with one line per direction a message travels. The playback
// walks the steps: the current one is lit on the list, and its line and its
// two ends are lit on the canvas while everything else dims - the reading a
// finger would do down a sequence diagram, done for the reader.
//
// It plays while it is on screen and stops when it is not, when the reader
// pauses it, when they pick a step, and when they asked for less motion.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useInView } from "motion/react";
import { ArrowRight, Pause, Play } from "lucide-react";
import type { Flow, FlowNode, Step } from "../catalog";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { catalog } from "../data";
import { nodeTypes } from "../graph/nodes";
import type { ServiceNodeData } from "../graph/nodes";
import { EDGE_W, EDGE_W_LIT } from "../graph/theme";
import { useElkFlow } from "../graph/useElkFlow";
import type { FlowSpec } from "../graph/useElkFlow";
import { worstStatus } from "../lib/event-graph";
import { LayoutGroup, m, transitions, useReducedMotion } from "../lib/motion";
import { paths } from "../routes";
import { catalogTo } from "./catalog";

const FLOW_ID = "flow.cart-checkout";
const STEP_MS = 1600;
const LANE_NODE_W = 144;

/** The steps in reading order, whatever frames they sit in. */
function flatSteps(nodes: readonly FlowNode[]): Step[] {
  const out: Step[] = [];
  for (const node of nodes) {
    if (node.type === "step") out.push(node);
    else if (node.type === "parallel")
      for (const branch of node.branches) out.push(...flatSteps(branch));
    else if (node.type === "alt")
      for (const branch of node.branches) out.push(...flatSteps(branch.steps));
    else out.push(...flatSteps(node.steps));
  }
  return out;
}

const laneId = (step: Step): string => `${step.from}->${step.to}`;

/** What the box says under the eyebrow: a service by its id, anything else by what it is. */
function participantData(
  participant: Flow["participants"][number],
): ServiceNodeData {
  return {
    label: participant.label ?? participant.id,
    context: participant.context,
    ghost: participant.kind === "unknown",
    kind: "service",
    role: participant.kind,
  };
}

function Canvas({ flow, steps, at }: { flow: Flow; steps: Step[]; at: number }) {
  const spec = useMemo<FlowSpec>(() => {
    const lanes = new Map<string, Step[]>();
    for (const step of steps) {
      const lane = lanes.get(laneId(step));
      if (lane) lane.push(step);
      else lanes.set(laneId(step), [step]);
    }
    // Narrow boxes and no labels for elk to leave room for: the label a lane
    // shows is the current step's, put on at render time, and the whole
    // picture has to fit a box half the width of the graph page's.
    return {
      nodes: flow.participants.map((p) => ({
        id: p.id,
        width: LANE_NODE_W,
        data: participantData(p),
      })),
      edges: [...lanes.entries()].map(([id, lane]) => ({
        id,
        source: lane[0]!.from,
        target: lane[0]!.to,
        label: "",
        status: worstStatus(lane.map((s) => s.status)),
      })),
      direction: "RIGHT",
      layerSpacing: 48,
    };
  }, [flow, steps]);
  const state = useElkFlow(spec);

  const active = steps[at] ?? null;
  const lit = active ? laneId(active) : null;

  const nodes = useMemo(
    () =>
      state.nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity:
            !active || node.id === active.from || node.id === active.to
              ? 1
              : 0.4,
        },
      })),
    [state.nodes, active],
  );

  const edges: Edge[] = useMemo(
    () =>
      state.edges.map((edge) => {
        const on = edge.id === lit;
        return {
          ...edge,
          label: on ? (active?.label ?? "") : "",
          style: {
            ...edge.style,
            opacity: lit && !on ? 0.3 : 1,
            strokeWidth: on ? EDGE_W_LIT : EDGE_W,
          },
          zIndex: on ? 10 : 0,
        };
      }),
    [state.edges, lit, active],
  );

  return (
    <div className="canvas-motion relative h-[340px] overflow-hidden rounded-card border border-line">
      {state.ready ? null : <DiagramSkeleton />}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        minZoom={0.3}
        maxZoom={1.6}
        key={state.ready ? `fit-${state.nodes.length}` : "pending"}
      >
        <Background gap={20} size={2} />
      </ReactFlow>
    </div>
  );
}

export function FlowPlayback() {
  const flow = useMemo(
    () => catalog.flows.find((f) => f.id === FLOW_ID) ?? catalog.flows[0] ?? null,
    [],
  );
  const steps = useMemo(() => (flow ? flatSteps(flow.steps) : []), [flow]);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { amount: 0.4 });
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!playing || !inView || reduced || steps.length < 2) return;
    const every = window.setInterval(
      () => setAt((i) => (i + 1) % steps.length),
      STEP_MS,
    );
    return () => window.clearInterval(every);
  }, [playing, inView, reduced, steps.length]);

  if (!flow) {
    return (
      <div className="p-6 text-sm text-muted">
        The example catalog has no flows to play.
      </div>
    );
  }

  const verified = steps.filter((s) => s.status === "verified").length;
  const health =
    verified === steps.length
      ? "status-verified"
      : steps.some((s) => s.status === "unresolved")
        ? "status-unresolved"
        : "status-declared";

  return (
    <div ref={box} className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono truncate text-faint">flow / {flow.slug}</div>
          <div className="mt-1 text-md font-semibold text-ink">{flow.name}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`chip ${health}`}>
            {verified} / {steps.length} verified
          </span>
          <button
            type="button"
            className="tbtn size-8 justify-center p-0"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause playback" : "Play the flow"}
            aria-pressed={playing}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <LayoutGroup id="flow-playback">
          <ol
            className="overflow-hidden rounded-card border border-line bg-canvas"
            aria-label={`Steps of ${flow.name}`}
          >
            {steps.map((step, index) => {
              const on = index === at;
              return (
                <li key={step.id} className="relative border-b border-line last:border-b-0">
                  {on ? (
                    <m.span
                      layoutId="flow-cursor"
                      transition={transitions.settle}
                      className="absolute inset-0 bg-accent/8"
                      aria-hidden
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setAt(index);
                      setPlaying(false);
                    }}
                    aria-current={on ? "step" : undefined}
                    className={`relative grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left t-narrative ${
                      on ? "opacity-100" : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <span className="mono tnum text-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {step.label ?? step.ref ?? step.kind}
                      </span>
                      <span className="mono block truncate text-muted">
                        {step.from} → {step.to}
                      </span>
                    </span>
                    <span className={`chip status-${step.status}`}>
                      {step.kind}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </LayoutGroup>
        <ReactFlowProvider>
          <Canvas flow={flow} steps={steps} at={at} />
        </ReactFlowProvider>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="mono truncate text-faint">
          {steps[at]?.line ?? flow.source ?? ""}
        </span>
        <Link
          to={catalogTo(paths.flow(flow.slug))}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline"
        >
          Open the flow <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
