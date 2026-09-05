import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { allRepos, stepFrames } from "../catalog";
import type { Flow, Step, StepFrame } from "../catalog";
import { catalog, index } from "../data";
import { Ident } from "../components/Ident";
import { flowRepoService } from "../lib/derive";
import { sourceHref } from "../lib/source-link";
import { AdrNumber, StatusChip } from "../components/primitives";
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
          <Ident block value={latest.source} className="text-muted" />
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
    <>
      <Ident block value={method} className="text-ink" />

      {answer ? (
        <>
          <Label>Answers with</Label>
          <div className="mono text-muted">{answer}</div>
        </>
      ) : null}

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
          <Ident block value={call.source} className="text-muted" />
        </>
      ) : (
        <>
          <Label>Source</Label>
          <Where step={step} flow={flow} />
        </>
      )}
    </>
  );
}

const FRAME_KEYWORD: Record<StepFrame["kind"], string> = {
  alt: "alt",
  parallel: "par",
  loop: "loop",
};

/**
 * The frames this step sits inside, outermost first. Selecting a step from a
 * graph or the palette gives no sense of where in the flow it is, and a step
 * pulled out of an alt is the one most likely to be misread: it does not run
 * on every path, and nothing else on this panel would say so.
 */
function Frames({ step, flow }: { step: Step; flow: Flow }) {
  const frames = useMemo(
    () => stepFrames(flow.steps).get(step.id) ?? [],
    [flow, step.id],
  );
  if (frames.length === 0) return null;

  const conditional = frames.some((f) => f.kind === "alt");

  return (
    <div className="mb-3">
      <div className="label mb-1">
        {conditional ? "Runs only when" : "Runs inside"}
      </div>
      <div className="flex flex-col gap-1">
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
              className="flex items-baseline gap-1.5 border-l-2 py-0.5 pl-2"
              style={{
                borderColor: alt ? "var(--border-strong)" : "var(--border)",
              }}
            >
              <span
                className="mono shrink-0 border px-1 uppercase"
                style={{
                  borderColor: alt ? "var(--border-strong)" : "var(--border)",
                  color: alt ? "var(--fg)" : "var(--fg-muted)",
                }}
              >
                {FRAME_KEYWORD[frame.kind]}
              </span>
              <span className="mono min-w-0 flex-1" title={text}>
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
function Where({ step, flow }: { step: Step; flow: Flow }) {
  if (!step.line) return <div className="mono text-muted">not recorded</div>;
  const href = sourceHref(step.line, flowRepoService(catalog, flow), allRepos(catalog));
  return (
    <div className="mono flex flex-wrap items-center gap-2 break-all text-muted">
      <Ident block value={step.line} className="text-muted" />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="rounded-control text-accent hover:underline"
          title="Open on the forge, at the built commit"
        >
          open ↗
        </a>
      ) : null}
    </div>
  );
}

export function StepDetailBody({ step, flow }: { step: Step; flow: Flow }) {
  const decisions = step.ref ? (index.adrsByEvent.get(step.ref) ?? []) : [];

  return (
    <>
      <div className="mono mb-3 flex items-center gap-1.5 text-muted">
        <span>{step.from}</span>
        <span>&rarr;</span>
        <span>{step.to}</span>
      </div>

      <Frames step={step} flow={flow} />

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

      {step.line && step.kind !== "call" ? (
        <>
          <Label>Observed at</Label>
          <Where step={step} flow={flow} />
        </>
      ) : null}
    </>
  );
}
