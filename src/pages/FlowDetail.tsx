import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { flowContexts, walkSteps } from "../catalog";
import type { Flow, Step } from "../catalog";
import { catalog, index } from "../data";
import { contextName, ctxStyle } from "../lib/context-color";
import { middleTruncate } from "../lib/format";
import { contextResolver, hiddenStepIds, isCrossContext } from "../flow/cross-context";
import { StepRail } from "../flow/StepRail";
import { FlowTable } from "../flow/FlowTable";
import { FlowToolbar } from "../flow/FlowToolbar";
import { buildChapters, groupRows } from "../flow/chapters";
import { continuationIndex } from "../flow/continues";
import { useFlowPrefs } from "../flow/prefs";
import { buildOutline, outlineSteps } from "../flow/outline";
import { findPath, flowPaths } from "../flow/paths";
import { FlowView } from "../likec4/FlowView";
import type { CanvasHandle } from "../likec4/CanvasBridge";
import { flowCrossViewId, flowViewId } from "../likec4/ids";
import { flowPairing } from "../likec4/view-index";
import { flowStepId, parseFlowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";
import { PinButton } from "../app/pins";
import {
  Panel,
  ResizeHandle,
  SavedGroup,
  useCanvasResize,
} from "../app/panels";
import { Ident } from "../components/Ident";
import { ContextPill, ProvenanceBadge } from "../components/primitives";
import { WhatLinksHere } from "../components/WhatLinksHere";

/**
 * The summary, clamped to two lines.
 *
 * The header's whole job on this page is to be short: every row it keeps is a
 * row of canvas the reader does not get. Two lines is enough to say what a
 * flow is; the rest is one word away, and the word is remembered per flow
 * because whether a summary is worth ten lines is a fact about that summary.
 */
function Summary({
  text,
  expanded,
  onToggle,
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      // Measured while clamped, which is the only state the question makes
      // sense in: an expanded paragraph never overflows itself.
      if (!expanded) setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, expanded]);

  return (
    <p className="mt-1.5 flex max-w-prose items-baseline gap-1.5 text-muted">
      <span ref={ref} className={expanded ? "min-w-0" : "min-w-0 line-clamp-2"}>
        {text}
      </span>
      {clipped || expanded ? (
        <button
          type="button"
          onClick={onToggle}
          className="mono shrink-0 rounded-control text-accent hover:underline"
        >
          {expanded ? "less" : "more"}
        </button>
      ) : null}
    </p>
  );
}

export function FlowDetail() {
  const { flow: slug } = useParams();
  const flow: Flow | undefined = slug ? index.flowBySlug.get(slug) : undefined;

  const [crossOnly, setCrossOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  /** Empty means every branch at once — the union, not a run. */
  const [pathId, setPathId] = useState("");
  /** Chapters the reader has folded away. Empty means the whole flow is open. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [hoverStep, setHoverStep] = useState<string | null>(null);
  /** The step LikeC4's walkthrough is on, when it is running. */
  const [walkStep, setWalkStep] = useState<string | null>(null);

  const canvas = useRef<CanvasHandle | null>(null);

  const selection = useSelectionStore((s) => s.selection);
  const source = useSelectionStore((s) => s.source);
  const select = useSelectionStore((s) => s.select);
  const settle = useCanvasResize();

  const allSteps = useMemo(() => (flow ? walkSteps(flow.steps) : []), [flow]);
  const stepById = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of allSteps) m.set(s.id, s);
    return m;
  }, [allSteps]);

  const [prefs, setPrefs] = useFlowPrefs(slug ?? "", allSteps.length);

  const contextOf = useMemo(
    () => (flow ? contextResolver(flow) : () => null),
    [flow],
  );
  const hidden = useMemo(
    () => (flow ? hiddenStepIds(flow) : new Set<string>()),
    [flow],
  );
  const paths = useMemo(
    () => (flow ? flowPaths(flow) : { paths: [], truncated: false }),
    [flow],
  );
  const path = useMemo(
    () => (pathId ? findPath(paths.paths, pathId) : null),
    [paths, pathId],
  );

  // Frames are part of the rail, not something flattened out of it, so the
  // outline is what the rail draws and what the arrow keys step through.
  const rows = useMemo(
    () =>
      flow
        ? buildOutline(flow, {
            hidden,
            crossOnly,
            path: path ? path.stepIds : null,
          })
        : [],
    [flow, hidden, crossOnly, path],
  );
  const walkable = useMemo(() => outlineSteps(rows), [rows]);

  // Chapters come from the flow rather than from the filtered rail, so the
  // cross-context switch cannot rename or renumber them.
  const chapters = useMemo(() => (flow ? buildChapters(flow) : []), [flow]);
  const groups = useMemo(() => groupRows(rows, chapters), [rows, chapters]);
  const chapterOfStep = useMemo(() => {
    const m = new Map<string, string>();
    for (const chapter of chapters) {
      for (const stepId of chapter.stepIds) m.set(stepId, chapter.id);
    }
    return m;
  }, [chapters]);

  const continuations = useMemo(
    () => (flow ? continuationIndex(flow, catalog.flows) : new Map()),
    [flow],
  );

  const crossContextOf = useCallback(
    (step: Step) =>
      isCrossContext(step, contextOf) ? contextOf(step.to) : undefined,
    [contextOf],
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
  // Playback outranks the selection while it is running: it is the reader
  // watching rather than pointing, and the rail's job is to follow.
  const activeId = walkStep ?? selectedStepId ?? focusedMatch;

  const litSteps = useMemo(
    () =>
      walkStep
        ? [walkStep]
        : selectedStepId
          ? [selectedStepId]
          : hoverStep
            ? [hoverStep]
            : matches,
    [walkStep, selectedStepId, hoverStep, matches],
  );

  useEffect(() => {
    // Choosing a path that does not contain the selected step would leave the
    // rail marking a step it has greyed out. The selection is the newer
    // intent, so the filter yields to it rather than the other way round.
    if (path && selectedStepId && !path.stepIds.has(selectedStepId)) {
      setPathId("");
    }
  }, [path, selectedStepId]);

  useEffect(() => {
    // A step the reader is being sent to must be visible when they arrive, so
    // its chapter opens itself. Folding is a reading aid, not a filter, and it
    // never gets to hide the one row the page is pointing at.
    if (!activeId) return;
    const chapterId = chapterOfStep.get(activeId);
    if (!chapterId) return;
    setCollapsed((current) => {
      if (!current.has(chapterId)) return current;
      const next = new Set(current);
      next.delete(chapterId);
      return next;
    });
  }, [activeId, chapterOfStep]);

  const toggleChapter = useCallback((chapterId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }, []);

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
        <p className="meta mt-2">
          no flow with slug “{slug}” in the catalog
        </p>
        <Link to="/flows" className="mono mt-4 inline-block text-accent">
          ← all flows
        </Link>
      </div>
    );
  }

  const contexts = flowContexts(flow);
  const viewId = crossOnly ? flowCrossViewId(flow) : flowViewId(flow);
  const hiddenCount = crossOnly ? hidden.size : 0;

  /**
   * Steps are paired to the diagram's arrows by position, which holds only
   * while the generator and the view walk the sequence the same way. When it
   * stops holding the pairing is abandoned and highlighting silently dies —
   * so it is said out loud here instead, because a picture that quietly stops
   * answering is worse than one that admits it cannot.
   */
  const pairingBroken =
    allSteps.length > 0 && flowPairing(flow, crossOnly).edgeOf.size === 0;

  const cycle = (delta: number): void => {
    if (matches.length === 0) return;
    setMatchAt((n) => (n + delta + matches.length) % matches.length);
  };

  const rail = (
    <>
      <MatchPill
        selection={selection}
        matches={matches}
        at={matchAt}
        onCycle={cycle}
      />
      <StepRail
        groups={groups}
        activeId={activeId}
        matchIds={matchIds}
        collapsed={collapsed}
        onToggleChapter={toggleChapter}
        onSelect={selectStep}
        onHover={setHoverStep}
        crossContextOf={crossContextOf}
        continuations={continuations}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hero shrink-0 border-b px-gutter py-2.5 border-line bg-canvas">
        {/* A flow belongs to no single context, so the wash takes the first one
            it crosses - the context it starts in. */}
        <div aria-hidden className="hero-wash" style={ctxStyle(contexts[0])} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-md font-semibold" title={flow.name}>
            {flow.name}
          </h1>
          <Ident value={flow.id} className="text-muted" />
          <div className="ml-auto flex items-center gap-2">
            <PinButton kind="flow" id={flow.id} label={flow.name} />
          </div>
        </div>

        <Summary
          text={flow.summary}
          expanded={prefs.expanded}
          onToggle={() => setPrefs({ expanded: !prefs.expanded })}
        />

        {/* Everything the reader might want to know ABOUT this flow, as one
            wrapping row. Four separate rows of one chip each is four rows of
            canvas spent on decoration — and on this page every row of header
            is a row the picture does not get.

            What the row does NOT carry is anything about the picture: the view
            id and the filter's own count are facts about what is on the canvas
            right now, and they live with the controls that changed them. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {/* The badge is given no source: it would print the file name, which
              is the tail of the path standing right next to it. One of the two
              has to go, and the one that goes is the one you cannot copy. */}
          <ProvenanceBadge
            provenance={flow.provenance}
            verifiedAt={flow.verifiedAt}
          />
          {flow.source ? (
            <Ident value={flow.source} className="text-muted">
              {middleTruncate(flow.source, 40)}
            </Ident>
          ) : null}
          <WhatLinksHere
            target={{ kind: "flow", id: flow.slug }}
            variant="line"
            className="mt-0"
          />
          {contexts.map((c) => (
            <ContextPill key={c} id={c} name={contextName(c)} />
          ))}
        </div>

        <FlowToolbar
          variant={prefs.variant}
          onVariant={(variant) => setPrefs({ variant })}
          playing={walkStep !== null}
          onPlay={() => canvas.current?.start()}
          onStep={(delta) => canvas.current?.step(delta)}
          onStop={() => canvas.current?.stop()}
          onFit={() => canvas.current?.fit()}
          paths={paths.paths}
          pathId={pathId}
          onPath={setPathId}
          pathSteps={path ? path.stepIds.size : null}
          totalSteps={allSteps.length}
          crossOnly={crossOnly}
          onCrossOnly={setCrossOnly}
          compact={compact}
          onCompact={setCompact}
          viewId={viewId}
          hiddenCount={hiddenCount}
          pairingBroken={pairingBroken}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {compact ? (
          <div className="pane min-w-0 flex-1 overflow-y-auto">
            <FlowTable
              flow={flow}
              rows={walkable}
              chapters={chapters}
              contextOf={contextOf}
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
              defaultSize="320px"
              minSize="200px"
              maxSize="45"
              className="pane h-full overflow-y-auto border-r border-line"
            >
              {rail}
            </Panel>

            <ResizeHandle id="rail" />

            <Panel
              id="canvas"
              minSize="30"
              className="h-full min-w-0"
              onResize={settle}
            >
              <FlowView
                flow={flow}
                crossOnly={crossOnly}
                variant={prefs.variant}
                litSteps={litSteps}
                pathSteps={path ? [...path.stepIds] : null}
                /* What the READER is pointing at, which is not the same thing
                   as what the rail is marking: during playback the rail marks
                   the step being played, and feeding that back to the canvas
                   would have the page and the walkthrough each insisting on a
                   different step forever. A step clicked ON the canvas is left
                   out too — it is already in view, and re-centring would move
                   the picture out from under the pointer. */
                focusStep={
                  source === "diagram" ? null : (selectedStepId ?? focusedMatch)
                }
                canvas={canvas}
                onWalkthroughStep={setWalkStep}
              />
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
