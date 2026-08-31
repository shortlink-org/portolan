import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Columns3, Filter, Rows3 } from "lucide-react";
import { flowContexts, flowCoverage, walkSteps } from "../catalog";
import type { Flow, FlowNode, Step } from "../catalog";
import { index } from "../data";
import { contextName } from "../lib/context-color";
import { hiddenStepIds } from "../flow/cross-context";
import { StepRail } from "../flow/StepRail";
import type { RailItem } from "../flow/StepRail";
import { FlowView } from "../likec4/FlowView";
import { flowCrossViewId, flowViewId } from "../likec4/ids";
import { flowStepId, parseFlowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";
import {
  ContextPill,
  CoverageBar,
  ProvenanceBadge,
} from "../components/primitives";

/** Depth of each step in the frame tree, for indenting the rail. */
function stepDepths(nodes: FlowNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (list: FlowNode[], depth: number): void => {
    for (const node of list) {
      switch (node.type) {
        case "step":
          out.set(node.id, depth);
          break;
        case "parallel":
          for (const b of node.branches) visit(b, depth + 1);
          break;
        case "alt":
          for (const b of node.branches) visit(b.steps, depth + 1);
          break;
        case "loop":
          visit(node.steps, depth + 1);
          break;
      }
    }
  };
  visit(nodes, 0);
  return out;
}

function Toggle({
  on,
  onClick,
  icon: Icon,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof Filter;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className="tbtn"
      style={{
        borderColor: on ? "var(--accent)" : "var(--border)",
        color: on ? "var(--accent)" : "var(--fg-muted)",
        background: on
          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
          : undefined,
      }}
    >
      <Icon size={11} aria-hidden />
      {children}
    </button>
  );
}

export function FlowDetail() {
  const { flow: slug } = useParams();
  const flow: Flow | undefined = slug ? index.flowBySlug.get(slug) : undefined;

  const [crossOnly, setCrossOnly] = useState(false);
  const [compact, setCompact] = useState(false);

  const selection = useSelectionStore((s) => s.selection);
  const select = useSelectionStore((s) => s.select);

  const allSteps = useMemo(() => (flow ? walkSteps(flow.steps) : []), [flow]);
  const numberOf = useMemo(() => {
    const m = new Map<string, number>();
    allSteps.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [allSteps]);
  const stepById = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of allSteps) m.set(s.id, s);
    return m;
  }, [allSteps]);

  const hidden = useMemo(
    () => (flow ? hiddenStepIds(flow) : new Set<string>()),
    [flow],
  );
  const depths = useMemo(
    () => (flow ? stepDepths(flow.steps) : new Map()),
    [flow],
  );

  const railItems: RailItem[] = useMemo(
    () =>
      allSteps
        .filter((s) => !crossOnly || !hidden.has(s.id))
        .map((s) => ({
          step: s,
          number: numberOf.get(s.id) ?? 0,
          depth: depths.get(s.id) ?? 0,
          hidden: hidden.has(s.id),
        })),
    [allSteps, crossOnly, hidden, numberOf, depths],
  );

  // --- what the selection means to this page -------------------------------

  /** The step selected on this flow, if the selection is one. */
  const selectedStepId = useMemo(() => {
    if (!flow || selection?.kind !== "flow-step") return null;
    const parsed = parseFlowStepId(selection.id);
    if (!parsed || parsed.flowSlug !== flow.slug) return null;
    return stepById.has(parsed.stepId) ? parsed.stepId : null;
  }, [flow, selection, stepById]);

  /**
   * An event selected anywhere at all — sidebar, palette, another panel — lights
   * every step of this flow that carries it.
   */
  const matches = useMemo(() => {
    if (selection?.kind !== "event") return [];
    return allSteps.filter((s) => s.ref === selection.id).map((s) => s.id);
  }, [selection, allSteps]);

  const [matchAt, setMatchAt] = useState(0);
  useEffect(() => setMatchAt(0), [selection?.id]);

  const matchIds = useMemo(
    () => (matches.length > 0 ? new Set(matches) : null),
    [matches],
  );
  const focusedMatch = matches[Math.min(matchAt, matches.length - 1)] ?? null;
  const activeId = selectedStepId ?? focusedMatch;

  const litSteps = useMemo(
    () => (selectedStepId ? [selectedStepId] : matches),
    [selectedStepId, matches],
  );

  const selectStep = useCallback(
    (stepId: string) => {
      if (flow) select(flowStepId(flow.slug, stepId), "rail");
    },
    [flow, select],
  );

  // Arrow keys walk the rail. Stepping the picture itself is LikeC4's
  // walkthrough, in the canvas, so there is only ever one animator.
  const move = useCallback(
    (delta: number) => {
      if (railItems.length === 0) return;
      const at = railItems.findIndex((item) => item.step.id === activeId);
      const nextIndex =
        at < 0
          ? delta > 0
            ? 0
            : railItems.length - 1
          : Math.min(railItems.length - 1, Math.max(0, at + delta));
      const next = railItems[nextIndex];
      if (next) selectStep(next.step.id);
    },
    [railItems, activeId, selectStep],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  if (!flow) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Flow not found</h1>
        <p className="mono mt-2 text-muted">
          no flow with slug “{slug}” in the catalog
        </p>
        <Link to="/flows" className="mono mt-4 inline-block text-accent">
          ← all flows
        </Link>
      </div>
    );
  }

  const coverage = flowCoverage(flow);
  const contexts = flowContexts(flow);
  const viewId = crossOnly ? flowCrossViewId(flow) : flowViewId(flow);
  const hiddenCount = crossOnly ? hidden.size : 0;

  const cycle = (delta: number): void => {
    if (matches.length === 0) return;
    setMatchAt((n) => (n + delta + matches.length) % matches.length);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3 border-line bg-canvas">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[15px] font-semibold">{flow.name}</h1>
          <span className="mono text-muted">{flow.id}</span>
          <div className="ml-auto flex items-center gap-2">
            <ProvenanceBadge
              provenance={flow.provenance}
              source={flow.source}
              verifiedAt={flow.verifiedAt}
            />
            {flow.source ? (
              <span className="mono text-muted" title={flow.source}>
                {flow.source}
              </span>
            ) : null}
          </div>
        </div>

        <p className="mt-1 max-w-[900px] text-muted">{flow.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1">
            {contexts.map((c) => (
              <ContextPill key={c} id={c} name={contextName(c)} />
            ))}
          </div>
          {/* Status lives here regardless of what the picture can express. */}
          <div className="w-56">
            <CoverageBar coverage={coverage} />
          </div>
          {hiddenCount > 0 ? (
            <span className="mono text-muted">
              {hiddenCount} step{hiddenCount === 1 ? "" : "s"} hidden
            </span>
          ) : null}
          <span className="mono text-muted" title="LikeC4 view id">
            {viewId}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Toggle
              on={crossOnly}
              onClick={() => setCrossOnly((v) => !v)}
              icon={Filter}
              title="Switch to the declared crossings-only view"
            >
              cross-context only
            </Toggle>
            <Toggle
              on={compact}
              onClick={() => setCompact((v) => !v)}
              icon={compact ? Rows3 : Columns3}
              title="Replace the view with the numbered step list"
            >
              compact
            </Toggle>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {compact ? (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <MatchPill
              selection={selection}
              matches={matches}
              at={matchAt}
              onCycle={cycle}
            />
            <StepRail
              items={railItems}
              activeId={activeId}
              matchIds={matchIds}
              onSelect={selectStep}
              full
            />
          </div>
        ) : (
          <>
            <div className="w-[280px] shrink-0 overflow-y-auto border-r border-line">
              <MatchPill
                selection={selection}
                matches={matches}
                at={matchAt}
                onCycle={cycle}
              />
              <StepRail
                items={railItems}
                activeId={activeId}
                matchIds={matchIds}
                onSelect={selectStep}
              />
            </div>
            <div className="min-w-0 flex-1">
              <FlowView
                flow={flow}
                crossOnly={crossOnly}
                litSteps={litSteps}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * How much of this flow the selected event actually touches. It sits above the
 * rail because that is where the answer is read, and it cycles rather than
 * scrolls so a flow with three matches forty steps apart is still walkable.
 */
function MatchPill({
  selection,
  matches,
  at,
  onCycle,
}: {
  selection: { kind: string; id: string } | null;
  matches: string[];
  at: number;
  onCycle: (delta: number) => void;
}) {
  if (selection?.kind !== "event") return null;

  if (matches.length === 0) {
    return (
      <div className="pill-rail text-muted">
        no step here carries this event
      </div>
    );
  }

  return (
    <div className="pill-rail">
      <span className="text-accent">
        {matches.length} matching step{matches.length === 1 ? "" : "s"}
      </span>
      <span className="ml-auto text-muted">
        {Math.min(at, matches.length - 1) + 1}/{matches.length}
      </span>
      <button
        type="button"
        onClick={() => onCycle(-1)}
        aria-label="Previous matching step"
        className="border px-1 border-line hover:bg-surface"
      >
        <ChevronLeft size={11} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onCycle(1)}
        aria-label="Next matching step"
        className="border px-1 border-line hover:bg-surface"
      >
        <ChevronRight size={11} aria-hidden />
      </button>
    </div>
  );
}
