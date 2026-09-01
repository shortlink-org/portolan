import { useMemo, useState } from "react";
import { catalog } from "../data";
import { plural } from "../lib/format";
import {
  bundles,
  edgeCount,
  eventGraph,
  filterEventGraph,
} from "../lib/event-graph";
import { contextVar } from "../lib/context-color";
import { statusColor, statusDash } from "../graph/theme";
import { DependencyGraphPane } from "../graph/DependencyGraph";
import type { GraphMode } from "../graph/dependency-layout";
import type { Status } from "../catalog";

const STATUSES: { status: Status; note: string }[] = [
  { status: "verified", note: "consumption observed" },
  { status: "declared", note: "handler registered, not observed" },
  { status: "unresolved", note: "consumer not in the catalog" },
];

export function GraphPage() {
  const [contexts, setContexts] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<Status>>(new Set());
  const [mode, setMode] = useState<GraphMode>("bipartite");

  const whole = useMemo(() => eventGraph(catalog), []);
  const graph = useMemo(
    () => filterEventGraph(whole, { contexts, statuses }),
    [whole, contexts, statuses],
  );

  const counts = useMemo(() => {
    const drawn = mode === "compact" ? bundles(graph).length : edgeCount(graph);
    const total =
      mode === "compact" ? bundles(whole).length : edgeCount(whole);
    const consumptions = graph.events.reduce(
      (n, e) => n + e.consumers.length,
      0,
    );
    return {
      services: graph.services.length,
      events: graph.events.length,
      drawn,
      hidden: Math.max(0, total - drawn),
      consumptions,
    };
  }, [graph, whole, mode]);

  // The shape a catalog has on its first day: something publishes, nothing has
  // been seen to listen. Worth saying out loud, because a canvas of pills with
  // no lines out of them otherwise reads as a rendering failure.
  const thin = counts.events > 0 && counts.consumptions === 0;

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  // Filters and mode both replace the layout wholesale, so both refit. Nothing
  // else does: a selection or a focus leaves the viewport where the reader put
  // it.
  const fitKey = `${[...contexts].sort().join(",")}|${[...statuses].sort().join(",")}|${mode}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-gutter py-3 border-line">
        <h1 className="text-lg font-semibold">Dependency graph</h1>
        <span className="mono text-muted">
          {counts.services} {plural(counts.services, "service")} ·{" "}
          {counts.events} {plural(counts.events, "event")} · {counts.drawn}{" "}
          {plural(counts.drawn, mode === "compact" ? "bundle" : "edge")}
          {counts.hidden > 0 ? (
            <span className="text-muted"> · {counts.hidden} hidden</span>
          ) : null}
        </span>
        {thin ? (
          <span className="chip status-declared">no consumers indexed yet</span>
        ) : null}

        <div className="seg" role="group" aria-label="Filter by context">
          {catalog.contexts.map((context) => {
            const on = contexts.has(context.id);
            return (
              <button
                key={context.id}
                type="button"
                onClick={() => setContexts((prev) => toggle(prev, context.id))}
                aria-pressed={on}
                className="flex items-center gap-1.5"
                /* No border of its own - the group draws one. A pressed member
                   keeps its context colour rather than collapsing to accent:
                   the colour is the thing being filtered. */
                style={{
                  color: on ? contextVar(context.id) : "var(--fg-muted)",
                  background: on
                    ? `color-mix(in srgb, ${contextVar(context.id)} 12%, transparent)`
                    : undefined,
                }}
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-[1px]"
                  style={{ background: contextVar(context.id) }}
                />
                {context.id}
              </button>
            );
          })}
        </div>

        <div className="mono ml-auto flex flex-wrap items-center gap-3">
          {/* The legend IS the filter. Three swatches that explain the three
              dashes and three buttons that turn them off are the same three
              things twice, and a header with room for one of them. */}
          <div className="seg" role="group" aria-label="Filter by status">
            {STATUSES.map((item) => {
              const on = statuses.has(item.status);
              return (
                <button
                  key={item.status}
                  type="button"
                  onClick={() =>
                    setStatuses((prev) => toggle(prev, item.status))
                  }
                  aria-pressed={on}
                  title={item.note}
                  className="flex items-center gap-1.5"
                  style={{
                    color: on ? statusColor(item.status) : "var(--fg-muted)",
                    background: on
                      ? `color-mix(in srgb, ${statusColor(item.status)} 12%, transparent)`
                      : undefined,
                  }}
                >
                  <svg width={20} height={6} aria-hidden>
                    <line
                      x1={0}
                      y1={3}
                      x2={20}
                      y2={3}
                      stroke={statusColor(item.status)}
                      strokeWidth={1.5}
                      strokeDasharray={statusDash(item.status)}
                    />
                  </svg>
                  {item.status}
                </button>
              );
            })}
          </div>

          <span className="flex items-center gap-1.5 text-muted">
            <svg width={14} height={12} aria-hidden>
              <rect
                x={0.5}
                y={0.5}
                width={13}
                height={11}
                rx={2}
                fill="none"
                stroke="var(--status-unresolved)"
                strokeDasharray="3 3"
              />
            </svg>
            not in catalog
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DependencyGraphPane
          graph={graph}
          mode={mode}
          onMode={setMode}
          fitKey={fitKey}
        />
      </div>
    </div>
  );
}
