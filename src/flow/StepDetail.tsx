import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import type { Flow, Step } from "../catalog";
import { index } from "../data";
import { AdrNumber, StatusChip } from "../components/primitives";
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
      <div className="mono text-[13px] text-ink">{event.name}</div>
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
          <div className="mono break-all text-muted">{latest.source}</div>
        </>
      ) : null}
    </>
  );
}

function RpcDetail({ step }: { step: Step }) {
  const method = step.ref ?? step.label ?? "(unknown method)";
  const call = step.ref ? index.rpcById.get(step.ref) : undefined;
  const provider = step.ref
    ? index.rpcProviderByMethod.get(step.ref)
    : undefined;
  const providerPath = provider ? servicePath(provider.id) : null;

  return (
    <>
      <div className="mono break-all text-[13px] text-ink">{method}</div>

      <Label>Provider</Label>
      {provider && providerPath ? (
        <Link to={providerPath} className="mono text-accent">
          {provider.id} →
        </Link>
      ) : (
        <div className="mono inline-flex items-center gap-1.5 border px-1.5 py-0.5 status-unresolved">
          <AlertTriangle size={11} aria-hidden />
          no provider found
        </div>
      )}

      {call ? (
        <>
          <Label>Declared by</Label>
          <div className="mono text-muted">peer: {call.peer}</div>
          <Label>Source</Label>
          <div className="mono break-all text-muted">{call.source}</div>
        </>
      ) : (
        <>
          <Label>Source</Label>
          <div className="mono break-all text-muted">
            {step.line ?? "not recorded"}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Everything a step is, minus the frame. The frame belongs to the detail panel,
 * which draws the same header for every kind of selection.
 */
export function StepDetailBody({ step, flow }: { step: Step; flow: Flow }) {
  const decisions = step.ref ? (index.adrsByEvent.get(step.ref) ?? []) : [];

  return (
    <>
      <div className="mono mb-3 flex items-center gap-1.5 text-muted">
        <span>{step.from}</span>
        <span>&rarr;</span>
        <span>{step.to}</span>
      </div>

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
        <RpcDetail step={step} />
      ) : (
        <>
          <div className="mono text-[13px]">{step.label ?? "internal call"}</div>
          <Label>Source</Label>
          <div className="mono break-all text-muted">
            {step.line ?? "not recorded"}
          </div>
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

      {step.line && step.kind !== "call" ? (
        <>
          <Label>Observed at</Label>
          <div className="mono break-all text-muted">{step.line}</div>
        </>
      ) : null}
    </>
  );
}
