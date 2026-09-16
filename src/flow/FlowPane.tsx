// One followed flow, as a document of its own.
//
// The page the reader came to is the first document; a continuation they
// opened is another, in the column beside it, drawn by the view that flow
// already has (portolan.0028). Nothing is composed and nothing is laid out
// here: a flow's picture is its picture, whether it is read on its own page
// or beside the one that calls it.
//
// The rail comes folded. A document opened to see where a call lands is
// looked at before it is read, and a list of steps under every window would
// leave no room for the pictures that are the point of opening them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, ExternalLink, Maximize2, X } from "lucide-react";
import { catalog } from "../data";
import type { Flow, Step } from "../catalog";
import { paths } from "../routes";
import { Ident } from "../components/Ident";
import { FlowView } from "../likec4/FlowView";
import type { CanvasHandle } from "../likec4/CanvasBridge";
import { buildChapters, groupRows } from "./chapters";
import { continuationIndex } from "./continues";
import { contextResolver, isCrossContext } from "./cross-context";
import { flowService } from "./journey";
import { journeyGroups } from "./journey";
import { buildOutline } from "./outline";
import { StepRail } from "./StepRail";
import { flowStepId, parseFlowStepId } from "../selection/model";
import { useSelectionStore } from "../selection/store";
import type { Variant } from "./prefs";

export function FlowPane({
  paneKey,
  flow,
  variant,
  openKeys,
  active,
  onOpenDoor,
  onClose,
}: {
  /** The door this document was opened through; its rows' doors hang off it. */
  paneKey: string;
  flow: Flow;
  variant: Variant;
  /** Every door the reader has open, so this one's rows know their own. */
  openKeys: ReadonlySet<string>;
  /** The step being pointed at is this flow's: the window says so. */
  active: boolean;
  onOpenDoor: (key: string) => void;
  onClose: () => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const canvas = useRef<CanvasHandle | null>(null);
  const select = useSelectionStore((s) => s.select);
  const selection = useSelectionStore((s) => s.selection);

  const contextOf = useMemo(() => contextResolver(flow), [flow]);
  const continuations = useMemo(() => continuationIndex(flow, catalog.flows), [flow]);
  const groups = useMemo(() => {
    const rows = buildOutline(flow, { hidden: new Set<string>(), crossOnly: false, path: null, statuses: null });
    return journeyGroups(groupRows(rows, buildChapters(flow)), {
      flow,
      flows: catalog.flows,
      continuations,
      // The doors of this document are named from it, so what a reader opens
      // here is closed with it.
      opened: new Set([...openKeys].flatMap((key) => (key.startsWith(`${paneKey}/`) ? [key.slice(paneKey.length + 1)] : []))),
    });
  }, [flow, continuations, openKeys, paneKey]);

  /** The step selected on this flow, when the selection is one of its own. */
  const activeKey = useMemo(() => {
    if (selection?.kind !== "flow-step") return null;
    const parsed = parseFlowStepId(selection.id);
    return parsed?.flowSlug === flow.slug ? parsed.stepId : null;
  }, [selection, flow.slug]);

  const onSelect = useCallback((key: string) => select(flowStepId(flow.slug, key), "rail"), [select, flow.slug]);
  const crossContextOf = useCallback(
    (step: Step) => (isCrossContext(step, contextOf) ? contextOf(step.to) : undefined),
    [contextOf],
  );

  // A document opens showing the whole picture: it was opened to see where a
  // call lands, and a corner of the sequence is not that.
  useEffect(() => {
    const at = window.setTimeout(() => canvas.current?.fit(), 300);
    return () => window.clearTimeout(at);
  }, [flow.slug]);

  // Pointing at a step of this flow — on the rail of the document that opened
  // it, or anywhere else — brings its window into view. Several documents can
  // stand open, and the one being talked about should not be the one scrolled
  // past.
  const frame = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (active) frame.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const Chevron = railOpen ? ChevronDown : ChevronRight;
  return (
    <section
      ref={frame}
      className={`flex min-h-0 flex-1 flex-col border-b last:border-b-0 ${active ? "border-accent/40" : "border-line"}`}
      aria-current={active ? "true" : undefined}
    >
      <header
        className={`mono flex shrink-0 items-center gap-2 border-b px-2 py-1 ${
          active ? "border-accent/40 bg-accent/5" : "border-line bg-surface"
        }`}
      >
        <button
          type="button"
          onClick={() => setRailOpen(!railOpen)}
          aria-expanded={railOpen}
          className="flex shrink-0 items-center gap-1 text-muted hover:text-ink"
          title={railOpen ? "Fold the steps away" : "Read the steps"}
        >
          <Chevron size={12} aria-hidden />
          steps
        </button>
        <Link to={paths.flow(flow.slug)} className="min-w-0 truncate text-ink hover:underline" title={flow.name}>
          {flow.name}
        </Link>
        <Ident value={flowService(flow)} className="shrink-0 text-muted" />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => canvas.current?.fit()} className="text-muted hover:text-ink" title="Fit the picture">
            <Maximize2 size={12} aria-hidden />
          </button>
          <Link to={paths.flow(flow.slug)} className="text-muted hover:text-ink" title="Open this flow on its own page">
            <ExternalLink size={12} aria-hidden />
          </Link>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" title="Close this document">
            <X size={12} aria-hidden />
          </button>
        </span>
      </header>

      {railOpen ? (
        <div className="pane max-h-[40%] shrink-0 overflow-y-auto border-b border-line">
          <StepRail
            groups={groups}
            answers={NO_ANSWERS}
            activeId={activeKey}
            collapsed={collapsed}
            onToggleChapter={(id) =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelect={onSelect}
            onHover={NOTHING}
            onToggleEntry={(key) => onOpenDoor(`${paneKey}/${key}`)}
            crossContextOf={crossContextOf}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <FlowView
          flow={flow}
          picture="flow"
          variant={variant}
          canvas={canvas}
          litSteps={activeKey ? [activeKey] : []}
          onWalkthroughStep={NOTHING}
        />
      </div>
    </section>
  );
}

const NO_ANSWERS: ReadonlyMap<string, string> = new Map();
const NOTHING = (): void => {};
