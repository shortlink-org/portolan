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
import { useNarrow } from "../app/responsive";
import { useUiStore } from "../app/ui-store";
import { catalog, index } from "../data";
import { usesOfDef } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { Ident } from "../components/Ident";
import { StatusChip } from "../components/primitives";
import { StepDetailBody } from "../flow/StepDetail";
import {
  AGGREGATE_ANCHOR,
  EVENT_ANCHOR,
  SERVICE_ANCHOR,
  eventPath as eventPathOf,
  paths,
} from "../routes";
import type { Resolved, Selection } from "./model";
import { resolveSelection } from "./model";
import { selectionPath } from "./pages";
import { useSelectionStore } from "./store";

function Label({ children }: { children: ReactNode }) {
  return <div className="label mt-3 mb-1">{children}</div>;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 py-0.5">{children}</div>;
}

/** The panel's own way of moving the selection, without leaving the page. */
function SelectLink({ id, children }: { id: string; children: ReactNode }) {
  const select = useSelectionStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(id, "panel")}
      title={id}
      className="mono trunc rounded-control text-left text-accent hover:underline"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function EventBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "event" }>;
}) {
  const { event, service } = resolved;
  const latest = event.versions[event.versions.length - 1];
  const flows = index.flowsByEvent.get(event.id) ?? [];
  const decisions = index.adrsByEvent.get(event.id) ?? [];

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {event.versions.map((v) => (
          <span
            key={v.version}
            className="mono rounded-control border px-1.5 py-px"
            style={{
              borderColor: v === latest ? "var(--accent)" : "var(--border)",
              color: v === latest ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {v.version}
          </span>
        ))}
      </div>

      <Label>Producer</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Schema · {latest?.version ?? "—"}</Label>
      <table className="w-full">
        <tbody>
          {(latest?.fields ?? []).map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 text-muted">
                {f.ref ? <SelectLink id={f.ref}>{f.type}</SelectLink> : f.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Label>Consumers</Label>
      {event.consumers.length === 0 ? (
        <div className="mono text-muted">nothing consumes this event</div>
      ) : null}
      {event.consumers.map((c) => (
        <Row key={c.service}>
          <SelectLink id={c.service}>{c.service}</SelectLink>
          <span className="ml-auto shrink-0">
            <StatusChip status={c.status} title={c.note} />
          </span>
        </Row>
      ))}

      <Label>Appears in flows</Label>
      {flows.length === 0 ? (
        <div className="mono text-muted">no flow references this event</div>
      ) : (
        <div className="flex flex-col gap-1">
          {flows.map((slug) => (
            <Link key={slug} to={paths.flow(slug)} className="mono text-accent">
              {slug} →
            </Link>
          ))}
        </div>
      )}

      {decisions.length > 0 ? (
        <>
          <Label>Decisions</Label>
          <div className="flex flex-col gap-1">
            {decisions.map((adr) => (
              <Link
                key={adr.id}
                to={paths.adr(adr.slug)}
                className="mono truncate text-accent"
                title={adr.title}
              >
                {adr.id} · {adr.title}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <Label>Source</Label>
      {latest?.source ? (
        <Ident block value={latest.source} className="text-muted" />
      ) : (
        <div className="mono text-muted">not recorded</div>
      )}
    </>
  );
}

function ServiceBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "service" }>;
}) {
  const { service, context } = resolved;
  const methods = service.provides.reduce((n, p) => n + p.methods.length, 0);
  const events = service.aggregates.flatMap((a) => a.events);
  const unresolved = service.consumes.filter((c) => c.status === "unresolved");

  return (
    <>
      <Ident
        block
        value={`${service.repo}/${service.path}`}
        className="mt-1.5 text-muted"
      />

      <Label>Provides</Label>
      {/* The count opens the tab that lists the methods it counted. */}
      <Link
        to={`${paths.service(context.id, service.slug)}?tab=provides`}
        className="mono rounded-control text-muted hover:text-ink"
      >
        <span className="tnum">{methods}</span> method
        {methods === 1 ? "" : "s"} over{" "}
        <span className="tnum">{service.provides.length}</span> service
        {service.provides.length === 1 ? "" : "s"}
      </Link>
      {service.provides.map((p) => (
        <Ident block key={p.id} value={p.id} className="text-muted" />
      ))}

      <Label>Consumes</Label>
      {service.consumes.length === 0 ? (
        <div className="mono text-muted">this service calls nobody</div>
      ) : null}
      {service.consumes.map((call) => (
        <Row key={call.id}>
          <Ident value={call.id} />
          <span className="ml-auto shrink-0">
            <StatusChip status={call.status} title={call.note} />
          </span>
        </Row>
      ))}
      {unresolved.length > 0 ? (
        <Link
          to={paths.problems()}
          className="mono mt-1 block rounded-control text-unresolved hover:underline"
        >
          <span className="tnum">{unresolved.length}</span> call
          {unresolved.length === 1 ? "" : "s"} resolve to nothing in the catalog
          →
        </Link>
      ) : null}

      <Label>Publishes</Label>
      {events.length === 0 ? (
        <div className="mono text-muted">no events</div>
      ) : null}
      {events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
          <Link
            to={`${eventPathOf(e.id) ?? paths.service(context.id, service.slug)}#${EVENT_ANCHOR.consumers}`}
            title={`${e.consumers.length} consumers of ${e.name}`}
            className="mono tnum ml-auto shrink-0 rounded-control text-muted hover:text-ink"
          >
            {e.consumers.length}
          </Link>
        </Row>
      ))}

      <Label>Context</Label>
      <SelectLink id={context.id}>{context.id}</SelectLink>
    </>
  );
}

function AggregateBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "aggregate" }>;
}) {
  const { aggregate, service, context } = resolved;
  const commands = aggregate.operations.filter((o) => o.kind === "command");
  const queries = aggregate.operations.filter((o) => o.kind === "query");
  const aggregatePath = paths.aggregate(
    context.id,
    service.slug,
    aggregate.slug,
  );

  return (
    <>
      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Operations</Label>
      <div className="mono flex gap-3 text-muted">
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.commands}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{commands.length}</span> command
          {commands.length === 1 ? "" : "s"}
        </Link>
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.queries}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{queries.length}</span> quer
          {queries.length === 1 ? "y" : "ies"}
        </Link>
      </div>

      <Label>Events</Label>
      {aggregate.events.length === 0 ? (
        <div className="mono text-muted">this aggregate publishes nothing</div>
      ) : null}
      {aggregate.events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
        </Row>
      ))}
    </>
  );
}

function ContextBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "context" }>;
}) {
  const { context } = resolved;
  return (
    <>
      <p className="mt-1.5 text-muted">{context.summary}</p>
      <Label>Services</Label>
      {context.services.map((s) => (
        <Row key={s.id}>
          <SelectLink id={s.id}>{s.slug}</SelectLink>
          <Link
            to={`${paths.service(context.id, s.slug)}#${SERVICE_ANCHOR.events}`}
            className="mono ml-auto shrink-0 rounded-control text-muted hover:text-ink"
          >
            <span className="tnum">
              {s.aggregates.reduce((n, a) => n + a.events.length, 0)}
            </span>{" "}
            events
          </Link>
        </Row>
      ))}
    </>
  );
}

function ValueObjectBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "value-object" }>;
}) {
  const uses = usesOfDef(catalog, resolved.id);
  return (
    <>
      <Label>Fields</Label>
      <table className="w-full">
        <tbody>
          {resolved.def.fields.map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 pr-2 text-muted">
                {f.ref ? <SelectLink id={f.ref}>{f.type}</SelectLink> : f.type}
              </td>
              <td className="py-0.5 text-muted">{f.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Label>Used in</Label>
      {uses.events.length === 0 && uses.defs.length === 0 ? (
        <div className="mono text-muted">nothing carries this type</div>
      ) : null}
      {uses.events.map((use) => (
        <Row key={use.eventId}>
          <SelectLink id={use.eventId}>{use.eventId}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">
            {use.versions.join(" ")}
          </span>
        </Row>
      ))}
      {uses.defs.map((id) => (
        <Row key={id}>
          <SelectLink id={id}>{id}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">type</span>
        </Row>
      ))}
    </>
  );
}

function FlowStepBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "flow-step" }>;
}) {
  return (
    <>
      <div className="mono mt-1 mb-2 flex items-center gap-2 text-muted">
        <Link to={paths.flow(resolved.flow.slug)} className="text-accent">
          {resolved.flow.slug}
        </Link>
      </div>
      <StepDetailBody step={resolved.step} flow={resolved.flow} />
    </>
  );
}

/**
 * A node the model draws but the catalog has never heard of — an external
 * participant, most often. Saying so beats saying nothing.
 */
function UnknownBody({ selection }: { selection: Selection }) {
  const consumers = catalog.contexts.flatMap((c) =>
    c.services.flatMap((s) =>
      s.aggregates.flatMap((a) =>
        a.events
          .filter((e) => e.consumers.some((x) => x.service === selection.id))
          .map((e) => e),
      ),
    ),
  );
  const flows = catalog.flows.filter((f) =>
    f.participants.some((p) => p.id === selection.id),
  );

  return (
    <>
      <p className="mono mt-1.5 text-unresolved">
        nothing in the catalog owns this id
      </p>
      {consumers.length > 0 ? (
        <>
          <Label>Named as a consumer of</Label>
          {consumers.map((e) => (
            <Row key={e.id}>
              <SelectLink id={e.id}>{e.name}</SelectLink>
            </Row>
          ))}
        </>
      ) : null}
      {flows.length > 0 ? (
        <>
          <Label>Appears in flows</Label>
          {flows.map((f) => (
            <Link
              key={f.slug}
              to={paths.flow(f.slug)}
              className="mono block text-accent"
            >
              {f.slug} →
            </Link>
          ))}
        </>
      ) : null}
      {consumers.length === 0 && flows.length === 0 ? (
        <p className="mono mt-3 text-muted">
          it is not referenced anywhere else either
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function kindLabel(selection: Selection, resolved: Resolved | null): string {
  if (!resolved) return "unknown";
  if (resolved.kind === "flow-step") return `step ${resolved.number}`;
  return selection.kind;
}

export function DetailPanel() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  if (!selection) return null;

  const resolved = resolveSelection(selection.id);
  const page = selectionPath(selection);

  return (
    <aside
      /* Slides 16px and fades in when the panel appears - not on every change
         of selection, which would set the whole rail moving each time the
         reader clicked a step. There is no exit: it unmounts on clear. */
      className="panel-in pane flex h-full w-full flex-col border-l border-line bg-canvas"
      aria-label="Selection detail"
    >
      <div className="sticky-bar flex shrink-0 items-center gap-2 border-b px-4 py-2.5 border-line">
        <span className="label">{kindLabel(selection, resolved)}</span>
        {resolved?.kind === "flow-step" ? (
          <StatusChip status={resolved.step.status} />
        ) : null}
        <button
          type="button"
          onClick={() => clear("panel")}
          aria-label="Close selection detail (Esc)"
          title="Esc"
          className="ml-auto rounded-control p-1 text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="mono break-all text-sm text-ink">
            {resolved?.kind === "event"
              ? resolved.event.name
              : resolved?.kind === "flow-step"
                ? (resolved.step.label ??
                  resolved.step.ref ??
                  resolved.step.kind)
                : selection.id}
          </span>
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
        {resolved?.kind !== "flow-step" && resolved !== null ? (
          <Ident block value={selection.id} className="mt-0.5 text-muted" />
        ) : null}

        {page ? (
          <Link
            to={page}
            className="mono mt-3 inline-block rounded-control text-accent hover:underline"
          >
            open page →
          </Link>
        ) : null}

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
        {open ? (
          <div
            className="overlay-in fixed inset-0 z-40 flex justify-end"
            style={{ background: "color-mix(in srgb, #000 45%, transparent)" }}
            onMouseDown={() => clear("panel")}
          >
            <div
              className="sheet-in h-full w-[85%] shadow-md"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <DetailPanel />
            </div>
          </div>
        ) : null}
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
