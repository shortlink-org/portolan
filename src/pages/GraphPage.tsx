import { useMemo, useState } from "react";
import { catalog } from "../data";
import { filterGraph, serviceGraph } from "../lib/derive";
import { contextVar } from "../lib/context-color";
import { statusColor, statusDash } from "../graph/theme";
import { DependencyGraphPane } from "../graph/DependencyGraph";
import type { Status } from "../catalog";

const LEGEND: { status: Status; note: string }[] = [
  { status: "verified", note: "consumption observed" },
  { status: "declared", note: "handler registered, not observed" },
  { status: "unresolved", note: "consumer not in the catalog" },
];

export function GraphPage() {
  const [active, setActive] = useState<Set<string>>(new Set());

  const graph = useMemo(
    () => filterGraph(serviceGraph(catalog), active),
    [active],
  );

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-gutter py-3 border-line">
        <h1 className="text-lg font-semibold">Dependency graph</h1>
        <span className="mono text-muted">
          {graph.nodes.length} services · {graph.edges.length} event edges
        </span>

        <div className="seg" role="group" aria-label="Filter by context">
          {catalog.contexts.map((context) => {
            const on = active.has(context.id);
            return (
              <button
                key={context.id}
                type="button"
                onClick={() => toggle(context.id)}
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
          {LEGEND.map((item) => (
            <span
              key={item.status}
              className="flex items-center gap-1.5 text-muted"
              title={item.note}
            >
              <svg width={22} height={6} aria-hidden>
                <line
                  x1={0}
                  y1={3}
                  x2={22}
                  y2={3}
                  stroke={statusColor(item.status)}
                  strokeWidth={1.5}
                  strokeDasharray={statusDash(item.status)}
                />
              </svg>
              {item.status}
            </span>
          ))}
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
        <DependencyGraphPane graph={graph} />
      </div>
    </div>
  );
}
