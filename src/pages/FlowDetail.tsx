import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  Rows3,
} from "lucide-react";
import { flowContexts, flowCoverage, walkSteps } from "../catalog";
import type { Flow, Step } from "../catalog";
import { index } from "../data";
import { contextName, ctxStyle } from "../lib/context-color";
import { middleTruncate } from "../lib/format";
import { hiddenStepIds } from "../flow/cross-context";
import { StepRail } from "../flow/StepRail";
import { buildOutline, outlineSteps } from "../flow/outline";
import { FlowView } from "../likec4/FlowView";
import { flowCrossViewId, flowViewId } from "../likec4/ids";
import { flowStepId, parseFlowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";
import {
  Panel,
  ResizeHandle,
  SavedGroup,
  useCanvasResize,
} from "../app/panels";
import {
  ContextPill,
  CoverageBar,
  ProvenanceBadge,
} from "../components/primitives";

/**
 * A switch inside the view's segmented control. It carries no border of its
 * own: the group draws one, and the hairline between members does the rest.
 */
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
      className={`flex items-center gap-1.5 ${on ? "is-on" : ""}`}
    >
      <Icon size={14} aria-hidden />
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
  const settle = useCanvasResize();

  const allSteps = useMemo(() => (flow ? walkSteps(flow.steps) : []), [flow]);
  const stepById = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of allSteps) m.set(s.id, s);
    return m;
  }, [allSteps]);

  const hidden = useMemo(
    () => (flow ? hiddenStepIds(flow) : new Set<string>()),
    [flow],
  );
  // Frames are part of the rail, not something flattened out of it, so the
  // outline is what the rail draws and what the arrow keys step through.
  const rows = useMemo(
    () => (flow ? buildOutline(flow, { hidden, crossOnly }) : []),
    [flow, hidden, crossOnly],
  );
  const walkable = useMemo(() => outlineSteps(rows), [rows]);

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
      if (walkable.length === 0) return;
      const at = walkable.findIndex((item) => item.step.id === activeId);
      const nextIndex =
        at < 0
          ? delta > 0
            ? 0
            : walkable.length - 1
          : Math.min(walkable.length - 1, Math.max(0, at + delta));
      const next = walkable[nextIndex];
      if (next) selectStep(next.step.id);
    },
    [walkable, activeId, selectStep],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Arrow keys walk the rail only when nothing else has a claim on them.
      // A focused resize handle resizes with the same keys, and a text field
      // moves its caret; stealing either would break the widget the reader is
      // actually standing in.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="separator"]') !== null)
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
      <div className="hero shrink-0 border-b px-gutter py-5 border-line bg-canvas">
        {/* A flow belongs to no single context, so the wash takes the first one
            it crosses - the context it starts in. */}
        <div aria-hidden className="hero-wash" style={ctxStyle(contexts[0])} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-md font-semibold" title={flow.name}>
            {flow.name}
          </h1>
          <span className="mono text-muted">{flow.id}</span>
          <div className="ml-auto flex items-center gap-2">
            <ProvenanceBadge
              provenance={flow.provenance}
              source={flow.source}
              verifiedAt={flow.verifiedAt}
            />
            {flow.source ? (
              <span className="mono text-muted" title={flow.source}>
                {middleTruncate(flow.source)}
              </span>
            ) : null}
          </div>
        </div>

        <p className="mt-2 max-w-prose text-muted">{flow.summary}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
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

          <div className="seg ml-auto">
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
          <div className="pane min-w-0 flex-1 overflow-y-auto">
            <MatchPill
              selection={selection}
              matches={matches}
              at={matchAt}
              onCycle={cycle}
            />
            <StepRail
              rows={rows}
              activeId={activeId}
              matchIds={matchIds}
              onSelect={selectStep}
              full
            />
          </div>
        ) : (
          /* The rail and the picture are two readings of the same sequence, so
             which one gets the room is the reader's call, and it is remembered
             separately from the detail panel's width. */
          <SavedGroup
            id="portolan:flow-canvas"
            orientation="horizontal"
            className="h-full min-h-0 flex-1"
          >
            <Panel
              id="rail"
              defaultSize="280px"
              minSize="180px"
              maxSize="45"
              className="pane h-full overflow-y-auto border-r border-line"
            >
              <MatchPill
                selection={selection}
                matches={matches}
                at={matchAt}
                onCycle={cycle}
              />
              <StepRail
                rows={rows}
                activeId={activeId}
                matchIds={matchIds}
                onSelect={selectStep}
              />
            </Panel>

            <ResizeHandle id="rail" />

            <Panel
              id="canvas"
              minSize="30"
              className="h-full min-w-0"
              onResize={settle}
            >
              <FlowView flow={flow} crossOnly={crossOnly} litSteps={litSteps} />
            </Panel>
          </SavedGroup>
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
      <span className="seg">
        <button
          type="button"
          onClick={() => onCycle(-1)}
          aria-label="Previous matching step"
          className="!px-1"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onCycle(1)}
          aria-label="Next matching step"
          className="!px-1"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </span>
    </div>
  );
}
