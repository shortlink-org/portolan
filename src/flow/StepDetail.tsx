import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { allRepos, stepFrames } from "../catalog";
import type { Flow, Step, StepFrame } from "../catalog";
import { catalog, index } from "../data";
import { Ident } from "../components/Ident";
import { EditorLink } from "../components/EditorLink";
import { SourcePreviewButton } from "../components/SourcePreview";
import { flowRepoService } from "../lib/derive";
import { sourceLocation } from "../lib/source-link";
import { AdrNumber, StatusChip } from "../components/primitives";
import { ShapeRows } from "../components/ShapeRows";
import { shapeFor } from "../components/MethodRows";
import { stepAnswer } from "./answers";
import { paths, eventPath, servicePath } from "../routes";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="label mt-3 mb-1">{children}</div>;
}

function EventDetail({ step, flow }: { step: Step; flow: Flow }) {
  const event = step.ref ? index.eventById.get(step.ref) : undefined;
  if (!event || !step.ref) {
    return (
      <div className="mono text-muted">
        no event in the catalog matches this step
      </div>
    );
  }
  const owner = index.eventOwner.get(event.id);
  const latest = event.versions[event.versions.length - 1];
  const path = eventPath(event.id);
  const otherFlows = (index.flowsByEvent.get(event.id) ?? []).filter(
    (s) => s !== flow.slug,
  );
  const fields = latest?.fields.slice(0, 5) ?? [];
  const more = (latest?.fields.length ?? 0) - fields.length;

  return (
    <>
      <Ident block value={event.id} className="text-ink">
        {event.name}
      </Ident>
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
      {path ? (
        <Link to={path} className="mono mt-2 inline-block text-accent">
          {event.id} →
        </Link>
      ) : null}

      <Label>Producer</Label>
      {owner ? (
        <Link
          to={servicePath(owner.service.id) ?? "/"}
          className="mono text-accent"
        >
          {owner.service.id}
        </Link>
      ) : (
        <span className="mono text-muted">unknown</span>
      )}

      <Label>Fields · {latest?.version ?? "—"}</Label>
      <table className="w-full">
        <tbody>
          {fields.map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 text-muted">{f.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? (
        <div className="mono mt-1 text-muted">+{more} more</div>
      ) : null}

      <Label>Other consumers</Label>
      <div className="flex flex-col gap-1">
        {event.consumers.filter((c) => c.service !== step.to).length === 0 ? (
          <span className="mono text-muted">none</span>
        ) : null}
        {event.consumers
          .filter((c) => c.service !== step.to)
          .map((c) => {
            const to = servicePath(c.service);
            return (
              <div key={c.service} className="flex items-center gap-2">
                {to ? (
                  <Link to={to} className="mono truncate text-accent">
                    {c.service}
                  </Link>
                ) : (
                  <span className="mono truncate" title={c.note}>
                    {c.service}
                  </span>
                )}
                <span className="ml-auto shrink-0">
                  <StatusChip status={c.status} title={c.note} />
                </span>
              </div>
            );
          })}
      </div>

      <Label>Reuse</Label>
      <div className="mono text-muted">
        {otherFlows.length === 0 ? (
          "no other flow uses this event"
        ) : (
          <>
            {otherFlows.length} other flow
            {otherFlows.length === 1 ? " uses" : "s use"} this event:{" "}
            {otherFlows.map((slug, i) => (
              <span key={slug}>
                {i > 0 ? ", " : ""}
                <Link to={`/flows/${slug}`} className="text-accent">
                  {slug}
                </Link>
              </span>
            ))}
          </>
        )}
      </div>

      {latest ? (
        <>
          <Label>Source</Label>
          <SourceWhere where={latest.source} flow={flow} />
        </>
      ) : null}
    </>
  );
}

function RpcDetail({ step, flow }: { step: Step; flow: Flow }) {
  const method = step.ref ?? step.label ?? "(unknown method)";
  const call = step.ref ? index.rpcById.get(step.ref) : undefined;
  const provider = step.ref
    ? index.rpcProviderByMethod.get(step.ref)
    : undefined;
  const providerPath = provider ? servicePath(provider.id) : null;
  // The flow records the hop; what comes back is the contract's to say.
  const answer = stepAnswer(index, step);

  return (
    <section
      aria-label="RPC contract"
      className="overflow-hidden rounded-card border shadow-xs border-line"
    >
      <header className="border-b px-3 py-2.5 border-line bg-surface">
        <h2 className="label">RPC contract</h2>
        <div className="mt-2">
          <Ident block value={method} className="text-ink" />
        </div>
      </header>

      <DetailSection title="Contract">
        <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
          {answer ? (
            <>
              <dt className="mono text-muted">Answers with</dt>
              <dd className="mono break-all text-ink">{answer}</dd>
            </>
          ) : null}
          <dt className="mono text-muted">Provider</dt>
          <dd>
            {provider && providerPath ? (
              <Link to={providerPath} className="mono text-accent">
                {provider.id} →
              </Link>
            ) : (
              <span className="mono inline-flex items-center gap-1.5 rounded-control border px-1.5 py-0.5 status-unresolved">
                <AlertTriangle size={11} aria-hidden />
                no provider found
              </span>
            )}
          </dd>
          {call ? (
            <>
              <dt className="mono text-muted">Declared by</dt>
              <dd className="mono break-all text-ink">{call.peer}</dd>
            </>
          ) : null}
        </dl>
      </DetailSection>

      <DetailSection title="Source">
        {call ? (
          <SourceWhere where={call.source} flow={flow} structured />
        ) : step.line ? (
          <SourceWhere where={step.line} flow={flow} structured />
        ) : (
          <div className="mono text-muted">not recorded</div>
        )}
      </DetailSection>

      {step.line ? (
        <DetailSection title="Observed at">
          <SourceWhere where={step.line} flow={flow} structured />
        </DetailSection>
      ) : null}
    </section>
  );
}

function DetailSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-3 py-3 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {meta ? <span className="mono text-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ResponseDetail({ step, flow }: { step: Step; flow: Flow }) {
  const response = step.http;
  if (!response) {
    return (
      <>
        <div className="mono text-[13px]">{step.label ?? "response"}</div>
        <Label>Source</Label>
        <Where step={step} flow={flow} />
      </>
    );
  }

  const cut = response.bodyRef?.lastIndexOf("/") ?? -1;
  const interfaceId = cut >= 0 ? response.bodyRef!.slice(0, cut) : "";
  const methodName = cut >= 0 ? response.bodyRef!.slice(cut + 1) : "";
  const provider = response.bodyRef
    ? index.rpcProviderByMethod.get(response.bodyRef)
    : undefined;
  const provided = provider?.provides.find((item) => item.id === interfaceId);
  const method = provided?.methods.find((item) => item.name === methodName);
  const fields = provided
    ? shapeFor(provided, method?.response ?? response.body, method?.responseRef)
    : (response.fields ?? null);
  const providerPath = provider ? servicePath(provider.id) : null;
  const error = response.outcome === "error";
  const headerCount = response.contentType ? 1 : 0;

  return (
    <section
      aria-label="HTTP response contract"
      className="overflow-hidden rounded-card border shadow-xs"
      style={{
        borderColor: error ? "var(--response-error)" : "var(--border)",
      }}
    >
      <header
        className="border-b border-line px-3 py-2.5"
        style={{
          background: error ? "var(--response-error-bg)" : "var(--surface)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="label">Response contract</h2>
          <span
            className="mono rounded-[4px] border px-1.5 py-px"
            style={{
              borderColor: error
                ? "var(--response-error)"
                : "var(--status-verified)",
              color: error ? "var(--response-error)" : "var(--status-verified)",
            }}
          >
            {error ? "error path" : "success"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="mono text-sm font-medium text-ink">
            HTTP {response.status ?? "status unknown"}
          </span>
          <span className="mono text-muted">{response.body ?? "response"}</span>
        </div>
      </header>

      <DetailSection title="Headers" meta={headerCount}>
        {headerCount > 0 ? (
          <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="mono text-muted">Content-Type</dt>
            <dd className="mono break-all text-ink">{response.contentType}</dd>
          </dl>
        ) : (
          <div className="mono text-muted">no explicit headers detected</div>
        )}
      </DetailSection>

      <DetailSection
        title="Body"
        meta={
          fields
            ? `${fields.length} field${fields.length === 1 ? "" : "s"}`
            : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="mono text-muted">Schema</dt>
            <dd className="mono break-all text-ink">
              {response.body ?? "unknown"}
            </dd>
            {response.encoding ? (
              <>
                <dt className="mono text-muted">Encoding</dt>
                <dd className="mono text-ink">{response.encoding}</dd>
              </>
            ) : null}
          </dl>

          {fields ? (
            <div className="overflow-x-auto rounded-control border border-line bg-canvas px-2.5 py-2">
              {fields.length > 0 ? (
                <ShapeRows fields={fields} enums={provided?.enums} showHeader />
              ) : (
                <div className="mono text-muted">empty message</div>
              )}
            </div>
          ) : null}
        </div>
      </DetailSection>

      {response.bodyRef ? (
        <DetailSection title="Contract lineage">
          <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="mono text-muted">RPC response</dt>
            <dd>
              <Ident block value={response.bodyRef} className="text-ink" />
            </dd>
            {provider && providerPath ? (
              <>
                <dt className="mono text-muted">Provider</dt>
                <dd>
                  <Link to={providerPath} className="mono text-accent">
                    {provider.id} →
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
        </DetailSection>
      ) : null}

      {response.warning ? (
        <DetailSection title="Diagnostics" meta="1 issue">
          <div
            className="flex items-start gap-2 rounded-control border px-2.5 py-2"
            style={{
              borderColor: "var(--response-error)",
              color: "var(--response-error)",
              background: "var(--response-error-bg)",
            }}
          >
            <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
            <span>{response.warning}</span>
          </div>
        </DetailSection>
      ) : null}

      {step.line ? (
        <DetailSection title="Observed at">
          <SourceWhere where={step.line} flow={flow} structured />
        </DetailSection>
      ) : null}
    </section>
  );
}

const FRAME_KEYWORD: Record<StepFrame["kind"], string> = {
  alt: "alt",
  parallel: "par",
  loop: "loop",
};

/**
 * Where a step travels and the frames that allow it to run. Selecting a step
 * from a graph gives no sense of its branch, so route and condition are one
 * execution context rather than two loose lines above the contract.
 */
function ExecutionContext({ step, flow }: { step: Step; flow: Flow }) {
  const frames = useMemo(
    () => stepFrames(flow.steps).get(step.id) ?? [],
    [flow, step.id],
  );
  const conditional = frames.some((f) => f.kind === "alt");

  return (
    <section className="mb-3 overflow-hidden rounded-card border shadow-xs border-line">
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2 border-line bg-surface">
        <h2 className="label">Execution context</h2>
        {conditional ? (
          <span className="mono rounded-[4px] border px-1.5 py-px border-line-strong text-muted">
            conditional
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="label mb-1">From</div>
          <div className="mono break-all text-ink">{step.from}</div>
        </div>
        <span className="mono text-muted" aria-hidden>
          →
        </span>
        <div className="min-w-0">
          <div className="label mb-1">To</div>
          <div className="mono break-all text-ink">{step.to}</div>
        </div>
      </div>

      {frames.length > 0 ? (
        <div className="border-t px-3 py-2.5 border-line">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="label">
              {conditional ? "Runs only when" : "Runs inside"}
            </h3>
            <span className="mono text-muted">
              {frames.length} frame{frames.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {frames.map((frame, i) => {
              const alt = frame.kind === "alt";
              const text =
                frame.kind === "parallel"
                  ? [frame.title, `branch ${frame.branch}`]
                      .filter(Boolean)
                      .join(" · ")
                  : (frame.branch ?? frame.title ?? "");
              return (
                <div
                  key={`${frame.id}:${i}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-control border px-2 py-1.5 border-line bg-canvas"
                >
                  <span
                    className="mono shrink-0 rounded-[4px] border px-1.5 py-px uppercase"
                    style={{
                      borderColor: alt
                        ? "var(--border-strong)"
                        : "var(--border)",
                      color: alt ? "var(--fg)" : "var(--fg-muted)",
                    }}
                  >
                    {FRAME_KEYWORD[frame.kind]}
                  </span>
                  <span
                    className="mono min-w-0 break-words text-ink"
                    title={text}
                  >
                    {text}
                  </span>
                  {frame.terminal ? (
                    <span
                      className="mono shrink-0"
                      style={{ color: "var(--status-unresolved)" }}
                      title="This branch ends the flow — the steps drawn after it do not follow this one"
                    >
                      ends flow
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Everything a step is, minus the frame. The frame belongs to the detail panel,
 * which draws the same header for every kind of selection.
 */
/**
 * Where a step was read from, and a way there when the forge is known. A
 * `file:line` in the repository this was built from opens on the line; a
 * trace id or a path in another repository stays as it is, to copy.
 */
function SourceWhere({
  where,
  flow,
  structured = false,
}: {
  where: string;
  flow: Flow;
  structured?: boolean;
}) {
  const location = sourceLocation(
    where,
    flowRepoService(catalog, flow),
    allRepos(catalog),
  );

  const actions = (
    <>
      <SourcePreviewButton
        location={location}
        className="border px-2 py-1 border-line bg-canvas hover:bg-raised hover:no-underline"
      />
      {location?.href ? (
        <a
          href={location.href}
          target="_blank"
          rel="noreferrer"
          className="mono inline-flex items-center rounded-control border px-2 py-1 border-line bg-canvas text-accent hover:bg-raised"
          title="Open on the forge, at the built commit"
        >
          forge ↗
        </a>
      ) : null}
      <EditorLink
        location={location}
        variant="text"
        className="inline-flex items-center border px-2 py-1 border-line bg-canvas hover:bg-raised hover:no-underline"
      />
    </>
  );

  if (structured) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="mono min-w-0 break-all text-muted">
          <Ident block value={where} className="text-muted" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      </div>
    );
  }

  return (
    <div className="mono flex flex-wrap items-center gap-2 break-all text-muted">
      <Ident block value={where} className="text-muted" />
      {actions}
    </div>
  );
}

function Where({ step, flow }: { step: Step; flow: Flow }) {
  if (!step.line) return <div className="mono text-muted">not recorded</div>;
  return <SourceWhere where={step.line} flow={flow} />;
}

export function StepDetailBody({ step, flow }: { step: Step; flow: Flow }) {
  const decisions = step.ref ? (index.adrsByEvent.get(step.ref) ?? []) : [];

  return (
    <>
      <ExecutionContext step={step} flow={flow} />

      {/* A decision that names this step's event is the reason the step
          looks the way it does. It belongs next to the step, not three
          clicks away on the service page. */}
      {decisions.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1">
          {decisions.map((adr) => (
            <Link
              key={adr.id}
              to={paths.adr(adr.slug)}
              className="flex flex-wrap items-baseline gap-x-1.5 border px-2 py-1 border-line hover:bg-surface"
            >
              <span className="label">Decision</span>
              <AdrNumber adr={adr} />
              <span className="w-full truncate" title={adr.title}>
                {adr.title}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {step.kind === "event" ? (
        <EventDetail step={step} flow={flow} />
      ) : step.kind === "rpc" ? (
        <RpcDetail step={step} flow={flow} />
      ) : step.kind === "response" ? (
        <ResponseDetail step={step} flow={flow} />
      ) : (
        <>
          <div className="mono text-[13px]">
            {step.label ?? "internal call"}
          </div>
          <Label>Source</Label>
          <Where step={step} flow={flow} />
        </>
      )}

      {step.note ? (
        <>
          <Label>Note</Label>
          <p
            className="border-l-2 pl-2"
            style={{
              borderColor:
                step.status === "unresolved"
                  ? "var(--status-unresolved)"
                  : "var(--border-strong)",
              color: "var(--fg-muted)",
            }}
          >
            {step.note}
          </p>
        </>
      ) : null}

      {step.line &&
      step.kind !== "call" &&
      step.kind !== "rpc" &&
      step.kind !== "response" ? (
        <>
          <Label>Observed at</Label>
          <Where step={step} flow={flow} />
        </>
      ) : null}
    </>
  );
}
