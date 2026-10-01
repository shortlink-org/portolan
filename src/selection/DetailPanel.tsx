// The right rail. One panel, one selection, every page that draws a diagram.
//
// It renders by kind rather than by page, so an event opened from a flow reads
// exactly the same as an event opened from the dependency graph. Nothing here
// navigates on its own: every route change is a link the reader chose.

import { Link } from "react-router";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import {
  Panel,
  ResizeHandle,
  SavedGroup,
  useCanvasResize,
  usePanelRef,
} from "../app/panels";
import { SidePanel } from "../components/Overlay";
import { useNarrow } from "../app/responsive";
import { useUiStore } from "../app/ui-store";
import { stepLabel } from "../flow/labels";
import { ctxStyle } from "../lib/context-color";
import { Ident } from "../components/Ident";
import { StatusChip } from "../components/primitives";
import { PinButton } from "../app/pins";
import type { PinKind } from "../lib/pins";
import type { Resolved, Selection } from "./model";
import { resolveSelection } from "./model";
import { selectionPath } from "./pages";
import { useSelectionStore } from "./store";
import { EventBody } from "./detail/EventDetail";
import { ServiceBody } from "./detail/ServiceDetail";
import { ModuleBody } from "./detail/ModuleDetail";
import {
  AggregateBody,
  ContextBody,
  ValueObjectBody,
} from "./detail/DomainDetail";
import {
  ColumnBody,
  StoreBody,
  TableBody,
  ViewBody,
} from "./detail/PersistenceDetail";
import {
  BundleBody,
  FlowStepBody,
  UnknownBody,
} from "./detail/DiagramDetail";

/**
 * What the panel calls the thing it is showing.
 *
 * Most kinds are their id, which the line underneath already prints. These are
 * the ones with a name a reader would say out loud instead - and it is a
 * function rather than a ternary chain because it was nine levels deep before
 * a tenth kind existed.
 */
function titleOf(resolved: Resolved | null, selection: Selection): string {
  if (!resolved) return selection.id;

  switch (resolved.kind) {
    case "event":
      return resolved.event.name;
    case "service":
      return resolved.service.name;
    case "table":
      return resolved.table.name;
    case "view":
      return resolved.view.name;
    case "column":
      return `${resolved.view?.name ?? resolved.table?.name ?? resolved.store.slug}.${resolved.column.name}`;
    case "flow-step":
      return stepLabel(resolved.step);
    case "bundle":
      return `${resolved.bundle.from} → ${resolved.bundle.to}`;
    // `acme/shop`, not the registry host as well: the host is the same for
    // every module in almost every estate.
    case "module":
      return resolved.module.name;
    default:
      return selection.id;
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function kindLabel(selection: Selection, resolved: Resolved | null): string {
  if (!resolved) return "unknown";
  if (resolved.kind === "flow-step") return `step ${resolved.number}`;
  return selection.kind;
}

/**
 * What pinning the open selection would pin, or null when the selection is not
 * a thing a reader can come back to. A column, a view and a store are read
 * inside the canvas that holds them; a step is read inside its flow. Pinning
 * one of those would bookmark a scroll position rather than an entity.
 */
function pinFor(
  resolved: Resolved | null,
): { kind: PinKind; id: string } | null {
  if (!resolved) return null;
  switch (resolved.kind) {
    case "event":
      return { kind: "event", id: resolved.event.id };
    case "service":
      return { kind: "service", id: resolved.service.id };
    case "aggregate":
      return { kind: "aggregate", id: resolved.aggregate.id };
    case "table":
      return { kind: "table", id: resolved.table.id };
    default:
      return null;
  }
}

function DetailNavigation({
  resolved,
  page,
}: {
  resolved: Resolved | null;
  page: string | null;
}) {
  if (!page) return null;

  const flowStep = resolved?.kind === "flow-step" ? resolved : null;
  const destination =
    flowStep?.flow.slug ??
    (resolved?.kind === "service" ? "service page" : "catalog page");

  return (
    <nav
      aria-label="Selection navigation"
      className="my-3 flex min-w-0 items-center gap-2 rounded-control border px-2.5 py-2 border-line bg-surface"
    >
      <span className="label shrink-0">{flowStep ? "Flow" : "Page"}</span>
      <span className="mono trunc text-muted" title={destination}>
        {destination}
      </span>
      <Link
        to={page}
        className="mono ml-auto inline-flex shrink-0 items-center rounded-control border px-2 py-1 border-line-strong bg-canvas text-accent t-micro transition-colors hover:bg-raised"
      >
        {flowStep ? "open flow" : "open"}
        <span aria-hidden className="ml-1">
          →
        </span>
      </Link>
    </nav>
  );
}

export function DetailPanel() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  if (!selection) return null;

  const resolved = resolveSelection(selection.id);
  const page = selectionPath(selection);
  const pin = pinFor(resolved);

  return (
    <aside
      /* Slides 16px and fades in when the panel appears - not on every change
         of selection, which would set the whole rail moving each time the
         reader clicked a step. There is no exit: it unmounts on clear. */
      className="panel-in pane flex h-full w-full flex-col border-l border-line bg-canvas"
      aria-label="Selection detail"
    >
      <div className="sticky-bar sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b px-4 py-2 border-line">
        <span className="label">{kindLabel(selection, resolved)}</span>
        {resolved?.kind === "flow-step" ? (
          <StatusChip status={resolved.step.status} />
        ) : null}
        {/* Panel controls own the far edge even when this selection cannot be
            pinned. The close button used to sit immediately after the status
            in that case, which made it look attached to the status itself. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {pin ? <PinButton kind={pin.kind} id={pin.id} size={14} /> : null}
          <button
            type="button"
            onClick={() => clear("panel")}
            aria-label="Close selection detail (Esc)"
            title="Close · Esc"
            className="inline-flex size-7 items-center justify-center rounded-control border border-transparent text-muted t-micro transition-colors hover:border-line hover:bg-surface hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="mono break-all text-sm font-medium text-ink">
            {titleOf(resolved, selection)}
          </h2>
          {resolved?.kind === "event" ||
          resolved?.kind === "service" ||
          resolved?.kind === "aggregate" ? (
            <span
              className="mono ctx"
              style={ctxStyle(
                "context" in resolved ? resolved.context.id : null,
              )}
            >
              {resolved.context.id}
            </span>
          ) : null}
        </div>
        {/* A synthetic id is not something a reader can paste anywhere, so a
            step and a bundle keep theirs to themselves. */}
        {resolved !== null &&
        resolved.kind !== "flow-step" &&
        resolved.kind !== "bundle" ? (
          <Ident block value={selection.id} className="mt-0.5 text-muted" />
        ) : null}

        <DetailNavigation resolved={resolved} page={page} />

        {resolved === null ? (
          <UnknownBody selection={selection} />
        ) : resolved.kind === "event" ? (
          <EventBody resolved={resolved} />
        ) : resolved.kind === "service" ? (
          <ServiceBody resolved={resolved} />
        ) : resolved.kind === "aggregate" ? (
          <AggregateBody resolved={resolved} />
        ) : resolved.kind === "context" ? (
          <ContextBody resolved={resolved} />
        ) : resolved.kind === "value-object" ? (
          <ValueObjectBody resolved={resolved} />
        ) : resolved.kind === "store" ? (
          <StoreBody resolved={resolved} />
        ) : resolved.kind === "table" ? (
          <TableBody resolved={resolved} />
        ) : resolved.kind === "view" ? (
          <ViewBody resolved={resolved} />
        ) : resolved.kind === "column" ? (
          <ColumnBody resolved={resolved} />
        ) : resolved.kind === "bundle" ? (
          <BundleBody resolved={resolved} />
        ) : resolved.kind === "module" ? (
          <ModuleBody resolved={resolved} />
        ) : (
          <FlowStepBody resolved={resolved} />
        )}
      </div>
    </aside>
  );
}

/**
 * Page shell for the routes that embed a diagram: the page on the left, the
 * selection detail on the right.
 *
 * The detail panel is not opened by dragging. It is collapsed to nothing while
 * there is no selection and expanded the moment there is one, driven from the
 * store rather than from the handle - the handle only decides how wide it is
 * once open, and that width is what gets remembered.
 */
export function WithDetail({
  id,
  children,
}: {
  /** Page name for the persisted layout: "portolan:<page>". */
  id: string;
  children: ReactNode;
}) {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  const hidden = useUiStore((s) => s.detailHidden);
  const setHidden = useUiStore((s) => s.setDetailHidden);
  const detailRef = usePanelRef();
  const settle = useCanvasResize();
  const narrow = useNarrow();
  const open = selection !== null && !hidden;

  // Picking something new is a request to see it. "]" means "not now", not
  // "never again", so the next selection brings the rail back rather than
  // landing silently behind a panel the reader forgot they folded away.
  const selectedId = selection?.id ?? null;
  useEffect(() => {
    if (selectedId !== null) setHidden(false);
  }, [selectedId, setHidden]);

  useEffect(() => {
    const panel = detailRef.current;
    if (!panel) return;
    if (open) panel.expand();
    else panel.collapse();
    // `narrow` is in the list because the Group unmounts across the
    // breakpoint: the panel that comes back has to be told again.
  }, [open, narrow, detailRef]);

  // Below the breakpoint there is no room for a third pane, so the rail becomes
  // a sheet over the page. Esc is already the app's "clear the selection", and
  // clearing the selection is exactly what closes this.
  if (narrow) {
    return (
      <div className="relative h-full min-h-0">
        {children}
        <SidePanel
          open={open}
          onClose={() => clear("panel")}
          side="right"
          label="Selection detail"
          width="85%"
        >
          <DetailPanel />
        </SidePanel>
      </div>
    );
  }

  return (
    <SavedGroup
      id={`portolan:${id}`}
      orientation="horizontal"
      className="h-full min-h-0"
    >
      <Panel id="content" className="h-full min-w-0" onResize={settle}>
        {children}
      </Panel>

      <ResizeHandle id="detail" />

      <Panel
        id="detail"
        defaultSize="24"
        minSize="16"
        collapsible
        collapsedSize="0"
        panelRef={detailRef}
        className="h-full"
        onResize={settle}
      >
        <DetailPanel />
      </Panel>
    </SavedGroup>
  );
}
