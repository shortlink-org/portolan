// The right rail. One panel, one selection, every page that draws a diagram.
//
// It renders by kind rather than by page, so an event opened from a flow reads
// exactly the same as an event opened from the dependency graph. Nothing here
// navigates on its own: every route change is a link the reader chose.

import { Link } from "react-router";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { catalog, index } from "../data";
import { coverageRatio, flowCoverage } from "../catalog";
import { usesOfDef } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { StatusChip } from "../components/primitives";
import { StepDetailBody } from "../flow/StepDetail";
import { paths } from "../routes";
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
      className="mono truncate text-left text-accent hover:underline"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function EventBody({ resolved }: { resolved: Extract<Resolved, { kind: "event" }> }) {
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
            className="mono border px-1.5 py-px"
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
                {f.ref ? (
                  <SelectLink id={f.ref}>{f.type}</SelectLink>
                ) : (
                  f.type
                )}
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
      <div className="mono break-all text-muted">
        {latest?.source ?? "not recorded"}
      </div>
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
      <div className="mono mt-1.5 text-muted">
        {service.repo}/{service.path}
      </div>

      <Label>Provides</Label>
      <div className="mono text-muted">
        {methods} method{methods === 1 ? "" : "s"} over{" "}
        {service.provides.length} service
        {service.provides.length === 1 ? "" : "s"}
      </div>
      {service.provides.map((p) => (
        <div key={p.id} className="mono truncate text-muted" title={p.id}>
          {p.id}
        </div>
      ))}

      <Label>Consumes</Label>
      {service.consumes.length === 0 ? (
        <div className="mono text-muted">this service calls nobody</div>
      ) : null}
      {service.consumes.map((call) => (
        <Row key={call.id}>
          <span className="mono truncate" title={call.id}>
            {call.id}
          </span>
          <span className="ml-auto shrink-0">
            <StatusChip status={call.status} title={call.note} />
          </span>
        </Row>
      ))}
      {unresolved.length > 0 ? (
        <div className="mono mt-1 text-unresolved">
          {unresolved.length} call{unresolved.length === 1 ? "" : "s"} resolve to
          nothing in the catalog
        </div>
      ) : null}

      <Label>Publishes</Label>
      {events.length === 0 ? (
        <div className="mono text-muted">no events</div>
      ) : null}
      {events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">
            {e.consumers.length}
          </span>
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
  const { aggregate, service } = resolved;
  const commands = aggregate.operations.filter((o) => o.kind === "command");
  const queries = aggregate.operations.filter((o) => o.kind === "query");

  return (
    <>
      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Operations</Label>
      <div className="mono text-muted">
        {commands.length} command{commands.length === 1 ? "" : "s"} ·{" "}
        {queries.length} quer{queries.length === 1 ? "y" : "ies"}
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
          <span className="mono ml-auto shrink-0 text-muted">
            {s.aggregates.reduce((n, a) => n + a.events.length, 0)} events
          </span>
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
  const cov = flowCoverage(resolved.flow);
  return (
    <>
      <div className="mono mt-1 mb-2 flex items-center gap-2 text-muted">
        <Link to={paths.flow(resolved.flow.slug)} className="text-accent">
          {resolved.flow.slug}
        </Link>
        <span className="ml-auto">
          {Math.round(coverageRatio(cov) * 100)}% verified
        </span>
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
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-canvas"
      aria-label="Selection detail"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 border-line">
        <span className="label">{kindLabel(selection, resolved)}</span>
        {resolved?.kind === "flow-step" ? (
          <StatusChip status={resolved.step.status} />
        ) : null}
        <button
          type="button"
          onClick={() => clear("panel")}
          aria-label="Close selection detail (Esc)"
          title="Esc"
          className="ml-auto p-1 hover:bg-surface text-muted"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="mono break-all text-[13px] text-ink">
            {resolved?.kind === "event"
              ? resolved.event.name
              : resolved?.kind === "flow-step"
                ? (resolved.step.label ?? resolved.step.ref ?? resolved.step.kind)
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
          <div className="mono mt-0.5 break-all text-muted">{selection.id}</div>
        ) : null}

        {page ? (
          <Link to={page} className="mono mt-2 inline-block text-accent">
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

/** Page shell for the routes that embed a diagram. */
export function WithDetail({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">{children}</div>
      <DetailPanel />
    </div>
  );
}
