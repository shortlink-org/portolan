// Everywhere the chart draws an arrow into open water.
//
// There is no score and no severity column. An edge either lands somewhere the
// catalog knows about or it does not, and the only useful ordering is the one
// the reader can act on: by the service that owns the near end.

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { catalog } from "../data";
import { edgeCount, problems } from "../lib/derive";
import type { Problem } from "../lib/derive";
import { contextVar, ctxStyle } from "../lib/context-color";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { staggerStyle } from "../lib/motion";
import { KindIcon } from "../components/kind";
import { Ident } from "../components/Ident";
import { SectionTitle } from "../components/PageHeader";
import { eventPath, servicePath } from "../routes";

const KIND_NOTE: Record<Problem["kind"], string> = {
  rpc: "the provider of this call is not in the catalog",
  consumer: "this consumer of the event is not in the catalog",
};

export function Problems() {
  const [active, setActive] = useState<Set<string>>(new Set());
  const all = useMemo(() => problems(catalog), []);
  // How many edges there were to resolve at all. Zero problems out of zero
  // edges is not a clean bill of health - nothing crossed a boundary, so
  // nothing was checked, and saying "every edge resolved" there is a green
  // tick the catalog has not earned.
  const edges = useMemo(() => edgeCount(catalog), []);
  const rows = useMemo(
    () => (active.size === 0 ? all : all.filter((p) => active.has(p.context))),
    [all, active],
  );

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const countIn = (contextId: string) =>
    all.filter((p) => p.context === contextId).length;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Problems</h1>
        {/* "0 of 0" is a ratio of nothing to nothing; the line below says it
            in words. */}
        {all.length > 0 ? (
          <span className="mono text-muted">
            {rows.length} of {all.length}
          </span>
        ) : null}

        {all.length > 0 ? (
          <div
            className="seg ml-auto"
            role="group"
            aria-label="Filter by context"
          >
            {catalog.contexts
              .filter((c) => countIn(c.id) > 0)
              .map((c) => {
                const on = active.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className="flex items-center gap-1.5"
                    style={{
                      color: on ? contextVar(c.id) : "var(--fg-muted)",
                      background: on
                        ? `color-mix(in srgb, ${contextVar(c.id)} 12%, transparent)`
                        : undefined,
                    }}
                  >
                    <span
                      aria-hidden
                      className="size-1.5 rounded-[1px]"
                      style={{ background: contextVar(c.id) }}
                    />
                    {c.id}
                    <span className="tnum">{countIn(c.id)}</span>
                  </button>
                );
              })}
          </div>
        ) : null}
      </div>

      {all.length === 0 ? (
        <ClearSkies checked={edges} />
      ) : (
        <div className="mt-section max-w-table">
          <SectionTitle
            right={
              <span
                className="mono text-muted"
                title={absoluteTime(catalog.generatedAt)}
              >
                last checked {relativeTime(catalog.generatedAt)}
              </span>
            }
          >
            Unresolved edges
          </SectionTitle>
          <div className="flex flex-col gap-1" data-nav-list>
            {rows.map((problem, i) => (
              <ProblemRow
                key={`${problem.kind}:${problem.id}:${problem.peer}`}
                problem={problem}
                index={i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The one line the reader wants to see. Nothing else earns the space. */
function ClearSkies({ checked }: { checked: number }) {
  return (
    <div className="empty mt-section max-w-table">
      {checked === 0
        ? "Nothing to resolve yet — no service calls another, and no event has a consumer."
        : `Clear skies — all ${checked} ${plural(checked, "edge")} resolved.`}
      <span className="ml-2" title={absoluteTime(catalog.generatedAt)}>
        last checked {relativeTime(catalog.generatedAt)}
      </span>
    </div>
  );
}

function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
  const near =
    problem.kind === "rpc"
      ? servicePath(problem.service)
      : eventPath(problem.id);

  return (
    <div
      className="stagger-in flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border px-3 py-2"
      style={{
        ...staggerStyle(index),
        borderColor: "var(--status-unresolved)",
      }}
    >
      <KindIcon kind={problem.kind === "rpc" ? "service" : "event"} />
      {near ? (
        <Link
          to={near}
          data-nav-item
          className="mono rounded-control text-accent hover:underline"
          title={problem.id}
        >
          {problem.id}
        </Link>
      ) : (
        <Ident value={problem.id} />
      )}
      <span aria-hidden className="text-muted">
        →
      </span>
      <Ident
        value={problem.peer}
        className="text-unresolved"
        title={`${problem.peer} — ${KIND_NOTE[problem.kind]}. Click to copy.`}
      />
      <span className="chip ctx" style={ctxStyle(problem.context)}>
        <span aria-hidden className="dot" />
        {problem.context}
      </span>
      <span className="mono ml-auto text-muted">{KIND_NOTE[problem.kind]}</span>
      {problem.note ? (
        <p className="w-full border-l-2 pl-2 border-line-strong text-muted">
          {problem.note}
        </p>
      ) : null}
      {problem.source ? (
        <div className="mono w-full text-muted">
          <Ident value={problem.source} />
        </div>
      ) : null}
    </div>
  );
}
