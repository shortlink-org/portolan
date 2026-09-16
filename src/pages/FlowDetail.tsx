import { usePickedDraft } from "../drafts/store";
import { useActiveFlows } from "../drafts/active-flows";
import { addedFlow, branchFlow } from "../drafts/branch-flow";
import { draftFlowView } from "../drafts/branch-view";
import type { Draft, DraftEntity } from "../drafts/model";
import { DraftOnlyStrip } from "../drafts/DraftOnlyStrip";
import { DraftBanner } from "../drafts/DraftBanner";
import { useDocumentTitle } from "../app/title";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { saveCanvasImage } from "../lib/export-canvas";
import { allRepos, flowContexts, walkSteps } from "../catalog";
import type { Flow, Status, Step } from "../catalog";
import { catalog, index } from "../data";
import { contextName, ctxStyle } from "../lib/context-color";
import { toClipboard } from "../lib/clipboard";
import { flowRepoService } from "../lib/derive";
import { statusCounts } from "../lib/flow-tree";
import { sourceLocation } from "../lib/source-link";
import { FlowEvidence } from "../flow/FlowEvidence";
import { flowAnswers } from "../flow/answers";
import { flowMermaid } from "../flow/mermaid";
import { useToastStore } from "../app/toast";
import {
  contextResolver,
  hiddenStepIds,
  isCrossContext,
} from "../flow/cross-context";
import { StepRail } from "../flow/StepRail";
import { stepsShownBy } from "../flow/examples";
import { FlowTable } from "../flow/FlowTable";
import { FlowToolbar } from "../flow/FlowToolbar";
import { buildChapters, groupRows } from "../flow/chapters";
import { continuationIndex } from "../flow/continues";
import { useFlowPrefs } from "../flow/prefs";
import { flowService, journeyFlow, journeyGroups, journeySteps, journeyReach } from "../flow/journey";
import { FlowPane } from "../flow/FlowPane";
import { closePane, openPane, paneDoor, panesOf, readPanes, writePanes } from "../flow/panes";
import { buildOutline } from "../flow/outline";
import { findPath, flowPaths } from "../flow/paths";
import { FlowView } from "../likec4/FlowView";
import type { CanvasHandle } from "../likec4/CanvasBridge";
import { flowPictureViewId } from "../likec4/ids";
import type { FlowPicture } from "../likec4/ids";
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
import { ContextPill } from "../components/primitives";
import { NotFound } from "./NotFound";
import { useChatAvailable } from "../chat/prefs";
import { useChatUi } from "../chat/store";

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

export function FlowDetail({
  draftOnly,
}: {
  /** A flow only this branch has, shown on the same page (portolan.0019). */
  draftOnly?: { draft: Draft; entity: DraftEntity } | undefined;
} = {}) {
  const { flow: routeSlug } = useParams();
  // Keyed on the entity, the store's own object: the prop around it is rebuilt
  // every time the route re-renders, and a flow rebuilt with it would be a new
  // flow to every memo and effect below.
  const draftOnlyEntity = draftOnly?.entity;
  const onlyInBranch = useMemo(() => (draftOnlyEntity ? addedFlow(draftOnlyEntity) : null), [draftOnlyEntity]);
  const slug = onlyInBranch?.flow.slug ?? routeSlug;
  const mainFlow: Flow | undefined = onlyInBranch
    ? undefined
    : slug
      ? index.flowBySlug.get(slug)
      : undefined;
  // With a branch version picked, the whole page reads the branch's flow -
  // rail, table, walkthrough, detail panel - and the canvas draws the view
  // saved with the draft. What changed is a mark on the rows, nothing more.
  // The draft and its entity are the store's own objects, so they are what
  // the memo keys on - the pair around them is rebuilt every render.
  const picked = usePickedDraft(mainFlow?.id ?? "");
  const draftEntity = picked?.entity;
  const pickedDraft = draftOnly?.draft ?? picked?.draft;
  const branch = useMemo(
    () => (mainFlow && draftEntity ? branchFlow(mainFlow, draftEntity) : null),
    [mainFlow, draftEntity],
  );
  const shown = onlyInBranch ?? branch;
  // Both of the flow's views, since which one is on screen is decided below.
  const branchCanvases = useMemo(() => {
    if (!shown || !pickedDraft) return null;
    try {
      return {
        plain: draftFlowView(pickedDraft, shown.drawn, shown.marks, false),
        cross: draftFlowView(pickedDraft, shown.drawn, shown.marks, true),
      };
    } catch {
      return null;
    }
  }, [shown, pickedDraft]);
  const flow: Flow | undefined = shown?.flow ?? mainFlow;
  const setActiveFlow = useActiveFlows((s) => s.set);
  // Registered on one effect and withdrawn on another, keyed on the slug alone.
  // A re-render must not withdraw it even for a moment: React runs every
  // cleanup of a commit before any effect, and the selection sync reading the
  // hash in between would find no such flow and rewrite the step as unknown.
  useEffect(() => {
    if (shown) setActiveFlow(shown.flow.slug, shown.flow, onlyInBranch ? window.location.pathname : undefined);
  }, [shown, onlyInBranch, setActiveFlow]);
  const registeredSlug = shown?.flow.slug;
  useEffect(() => {
    if (!registeredSlug) return;
    return () => setActiveFlow(registeredSlug, null);
  }, [registeredSlug, setActiveFlow]);

  const [params, setParams] = useSearchParams();
  const [crossRequested, setCrossOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  /** The one status the rail is reading, or null for all of them. */
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [exporting, setExporting] = useState(false);
  const say = useToastStore((s) => s.say);
  const chatAvailable = useChatAvailable();
  /** Empty means every branch at once — the union, not a run. */
  const [pathId, setPathId] = useState("");
  /** Chapters the reader has folded away. Empty means the whole flow is open. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [hoverStep, setHoverStep] = useState<string | null>(null);
  /** The step LikeC4's walkthrough is on, when it is running. */
  const [walkStep, setWalkStep] = useState<string | null>(null);
  /** The recording whose steps are lit on the picture, when one is chosen. */
  const [exampleId, setExampleId] = useState<string | null>(null);

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
  const hasCrossings = allSteps.length > hidden.size;
  // Route changes can reuse this page while the previous flow's filter is on.
  const crossOnly = crossRequested && hasCrossings;
  const branchCanvas = (crossOnly ? branchCanvases?.cross : branchCanvases?.plain) ?? null;
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
  const statuses = useMemo(
    () => (statusFilter ? new Set<Status>([statusFilter]) : null),
    [statusFilter],
  );
  const rows = useMemo(
    () =>
      flow
        ? buildOutline(flow, {
            hidden,
            crossOnly,
            path: path ? path.stepIds : null,
            statuses,
          })
        : [],
    [flow, hidden, crossOnly, path, statuses],
  );
  /**
   * What the canvas lifts: the chosen path, narrowed to the chosen status.
   * A path also hides the other branches on the picture, while a status keeps
   * them as context and lets them recede. Both still share one highlighted set
   * on the canvas and remain separate controls on the rail.
   */
  const liftedSteps = useMemo(() => {
    if (!path && !statusFilter) return null;
    return allSteps
      .filter(
        (s) =>
          (!path || path.stepIds.has(s.id)) &&
          (!statusFilter || s.status === statusFilter),
      )
      .map((s) => s.id);
  }, [allSteps, path, statusFilter]);
  const counts = useMemo(
    () =>
      flow ? statusCounts(flow) : { verified: 0, declared: 0, unresolved: 0 },
    [flow],
  );

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

  /**
   * The documents open beside this one, in the address: a flow followed into
   * the next service is a reading worth sending to somebody, and one the back
   * button can undo (portolan.0028).
   */
  const openKeys = useMemo(() => readPanes(params.get("open")), [params]);
  const opened = useMemo(() => new Set(openKeys), [openKeys]);
  const panes = useMemo(() => panesOf(openKeys, catalog.flows), [openKeys]);
  const setOpen = useCallback(
    (next: readonly string[]) => {
      setParams(
        (current) => {
          const out = new URLSearchParams(current);
          if (next.length === 0) out.delete("open");
          else out.set("open", writePanes(next));
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  /** A door opens the flow behind it as a document, or closes it again. */
  const toggleEntry = useCallback(
    (key: string) => {
      setOpen(openKeys.includes(key) ? closePane(openKeys, key) : openPane(openKeys, key));
    },
    [openKeys, setOpen],
  );

  /**
   * The rail: this flow's steps, with a door under each step that continues
   * somewhere. A door says whether its document is open; it never unfolds the
   * other flow into this list (portolan.0028).
   */
  const journey = useMemo(
    () =>
      flow
        ? journeyGroups(groups, { flow, flows: catalog.flows, continuations, opened, expand: false })
        : [],
    [flow, groups, continuations, opened],
  );
  /** Every step of the path in rail order: what j and k walk. */
  const walkable = useMemo(() => journeySteps(journey), [journey]);
  const rowByKey = useMemo(
    () => new Map(walkable.map((row) => [row.key, row])),
    [walkable],
  );
  /**
   * What the control says: how many doors this flow has, and how many
   * documents stand open beside it with what they add.
   */
  const reach = useMemo(() => {
    const counted = journeyReach(journey);
    const services = new Set(panes.map((pane) => flowService(pane.flow)));
    const steps = panes.reduce((total, pane) => total + walkSteps(pane.flow.steps).length, 0);
    return { doors: counted.doors, open: panes.length, steps, services: services.size };
  }, [journey, panes]);
  /** Every door of this flow at once: one document per continuation. */
  const openAll = useCallback(() => {
    const doors = journey.flatMap((group) =>
      group.rows.flatMap((row) => (row.type === "entered" && !row.repeats && !row.deepest ? [row.key] : [])),
    );
    setOpen(doors.reduce<string[]>((keys, key) => openPane(keys, key), openKeys));
  }, [journey, openKeys, setOpen]);

  // What each step's callee hands back, read out of the contract rather than
  // out of the flow: the rail says it beside the step, and the Mermaid copy
  // draws it as a return.
  const answers = useMemo(
    () => (flow ? flowAnswers(index, flow) : new Map<string, string>()),
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

  /**
   * The steps a chosen recording showed. A recording is a reading of the
   * flow like a path is, and it lights the picture the same way, below
   * whatever the reader is pointing at.
   */
  const exampleSteps = useMemo(() => {
    const example = exampleId
      ? flow?.examples?.find((e) => e.id === exampleId)
      : undefined;
    return example ? stepsShownBy(example) : [];
  }, [flow, exampleId]);
  const litSteps = useMemo(
    () =>
      walkStep
        ? [walkStep]
        : selectedStepId
          ? [selectedStepId]
          : hoverStep
            ? (rowByKey.get(hoverStep)?.origin ? [] : [hoverStep])
            : matches.length > 0
              ? matches
              : exampleSteps,
    [walkStep, selectedStepId, hoverStep, rowByKey, matches, exampleSteps],
  );

  useEffect(() => {
    // Choosing a path that does not contain the selected step would leave the
    // selected step outside the focused rail. The selection is the newer
    // intent, so the path filter yields to it rather than the other way round.
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

  /**
   * Selecting a row of the path selects the step in the flow it belongs to:
   * a followed flow's step is that flow's, and the panel that opens is the
   * one that flow's page would open.
   */
  const selectRow = useCallback(
    (key: string) => {
      const row = rowByKey.get(key);
      const slug = row?.origin?.slug ?? flow?.slug;
      if (row && slug) select(flowStepId(slug, row.step.id), "rail");
    },
    [rowByKey, flow, select],
  );

  /**
   * The row the rail marks. A step of this flow is its own key; a step of a
   * followed flow is found by whose it is, so a selection made anywhere still
   * lands on the row that shows it.
   */
  const activeKey = useMemo(() => {
    if (activeId) return activeId;
    if (selection?.kind !== "flow-step") return null;
    const parsed = parseFlowStepId(selection.id);
    if (!parsed) return null;
    return (
      walkable.find((row) => row.origin?.slug === parsed.flowSlug && row.step.id === parsed.stepId)?.key ?? null
    );
  }, [activeId, selection, walkable]);

  // Arrow keys walk the rail. Stepping the picture itself is LikeC4's
  // walkthrough, in the canvas, so there is only ever one animator.
  const move = useCallback(
    (delta: number) => {
      if (walkable.length === 0) return;
      const at = walkable.findIndex((item) => item.key === activeKey);
      const nextIndex =
        at < 0
          ? delta > 0
            ? 0
            : walkable.length - 1
          : Math.min(walkable.length - 1, Math.max(0, at + delta));
      const next = walkable[nextIndex];
      if (next) selectRow(next.key);
    },
    [walkable, activeKey, selectRow],
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

  useDocumentTitle(flow?.name ?? "Flow not found");

  if (!flow) return <NotFound kind="Flow" id={slug} />;

  const contexts = flowContexts(flow);
  /**
   * The canvas draws this flow. A followed one is drawn in its own document
   * beside it (portolan.0028): a picture is laid out before it is drawn, and
   * a flow's picture is the one it already has.
   */
  const picture: FlowPicture = crossOnly ? "cross" : "flow";
  const viewId = flowPictureViewId(flow, picture);
  const hiddenCount = crossOnly ? hidden.size : 0;
  const flowSource = flow.source
    ? sourceLocation(flow.source, flowRepoService(catalog, flow), allRepos(catalog))
    : null;

  const copyMermaid = () => {
    // What is copied is every document that is open, as one sequence. A
    // Mermaid diagram is laid out where it is read, by whoever renders it, so
    // the path can be composed here even though a picture of it cannot
    // (portolan.0028) - and a diagram that stopped at this service's edge
    // would not be what the reader has on screen.
    const drawn =
      panes.length > 0
        ? journeyFlow({
            flow,
            flows: catalog.flows,
            continuations,
            opened: new Set(panes.map((pane) => paneDoor(pane.key))),
          })
        : flow;
    void toClipboard(flowMermaid(drawn, answers)).then((ok) => {
      say(
        ok
          ? reach.open > 0
            ? `Mermaid sequence copied, ${reach.services} ${reach.services === 1 ? "service" : "services"} deep`
            : "Mermaid sequence copied"
          : "could not reach the clipboard",
      );
    });
  };

  const exportImage = async (kind: "png" | "svg"): Promise<void> => {
    const viewport = canvas.current
      ?.node()
      ?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) {
      say("the canvas is not on screen; leave compact to save a picture");
      return;
    }
    setExporting(true);
    try {
      const file = await saveCanvasImage(viewport, flow.slug, kind);
      say(`${kind.toUpperCase()} downloaded — ${file}`);
    } catch (cause) {
      say(
        `could not export ${kind.toUpperCase()}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  /**
   * Steps are paired to the diagram's arrows by position, which holds only
   * while the generator and the view walk the sequence the same way. When it
   * stops holding the pairing is abandoned and highlighting silently dies —
   * so it is said out loud here instead, because a picture that quietly stops
   * answering is worse than one that admits it cannot.
   */
  const pairingBroken =
    allSteps.length - hiddenCount > 0 &&
    (branchCanvas ? branchCanvas.pairing : flowPairing(flow, crossOnly ? "cross" : "flow")).edgeOf.size === 0;

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
        marks={shown?.marks}
        groups={journey}
        answers={answers}
        activeId={activeKey}
        matchIds={matchIds}
        collapsed={collapsed}
        onToggleChapter={toggleChapter}
        onSelect={selectRow}
        onHover={setHoverStep}
        onToggleEntry={toggleEntry}
        crossContextOf={crossContextOf}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hero shrink-0 border-b px-gutter py-2.5 border-line bg-canvas">
        {/* A flow belongs to no single context, so the wash takes the first one
            it crosses - the context it starts in. */}
        <div aria-hidden className="hero-wash" style={ctxStyle(contexts[0])} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold" title={flow.name}>
            {flow.name}
          </h1>
          <Ident value={flow.id} className="text-muted" />
          <div className="flex flex-wrap items-center gap-1.5">
            {contexts.map((c) => <ContextPill key={c} id={c} name={contextName(c)} />)}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {chatAvailable ? (
              <button
                type="button"
                onClick={() => useChatUi.getState().setOpen(true)}
                className="product-primary"
                title={`Ask the catalog about ${flow.name}`}
              >
                <MessageSquare size={14} aria-hidden />
                ask this flow
              </button>
            ) : null}
            {draftOnly ? null : <PinButton kind="flow" id={flow.id} label={flow.name} />}
          </div>
        </div>

        {draftOnly ? (
          <DraftOnlyStrip draft={draftOnly.draft} entity={draftOnly.entity} className="mt-2" />
        ) : (
          <DraftBanner id={flow.id} className="mt-2" />
        )}

        <Summary
          text={flow.summary}
          expanded={prefs.expanded}
          onToggle={() => setPrefs({ expanded: !prefs.expanded })}
        />

        <FlowEvidence catalog={catalog} flow={flow} source={flowSource} exampleId={exampleId} onExample={setExampleId} />

        <FlowToolbar
          journey={reach}
          onFollowAll={openAll}
          onFollowNone={() => setOpen([])}
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
          hasCrossings={hasCrossings}
          onCrossOnly={setCrossOnly}
          compact={compact}
          onCompact={setCompact}
          viewId={viewId}
          hiddenCount={hiddenCount}
          pairingBroken={pairingBroken}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          statusCounts={counts}
          onCopyMermaid={copyMermaid}
          onExportPng={() => void exportImage("png")}
          onExportSvg={() => void exportImage("svg")}
          exporting={exporting}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* This flow is the first document; what the reader followed stands
            beside it, each in its own window, stacked in the order they were
            opened (portolan.0028). */}
        <SavedGroup
          id="portolan:flow-documents"
          orientation="horizontal"
          panelIds={panes.length > 0 ? ["document", "documents"] : ["document"]}
          className="h-full min-h-0 flex-1"
        >
          <Panel id="document" minSize="30" className="flex h-full min-w-0 flex-col" onResize={settle}>
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
                draft={branchCanvas ? { model: branchCanvas.model, pairing: branchCanvas.pairing } : undefined}
                flow={flow}
                picture={picture}
                variant={prefs.variant}
                litSteps={
                  litSteps.length > 0
                    ? litSteps
                    : statusFilter
                      ? (liftedSteps ?? [])
                      : []
                }
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
          </Panel>

          {panes.length > 0 ? (
            <>
              <ResizeHandle id="documents" />
              <Panel
                id="documents"
                defaultSize="40"
                minSize="20"
                maxSize="60"
                className="flex h-full min-w-0 flex-col overflow-y-auto border-l border-line"
                onResize={settle}
              >
                {panes.map((pane) => (
                  <FlowPane
                    key={pane.key}
                    paneKey={pane.key}
                    flow={pane.flow}
                    variant={prefs.variant}
                    openKeys={opened}
                    onOpenDoor={(key) => setOpen(openPane(openKeys, key))}
                    onClose={() => setOpen(closePane(openKeys, pane.key))}
                  />
                ))}
              </Panel>
            </>
          ) : null}
        </SavedGroup>
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
