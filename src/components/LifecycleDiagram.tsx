import { Link } from "react-router";
import type { Aggregate } from "../catalog";
import { layoutLifecycle, METRICS } from "../lib/lifecycle";
import { KindIcon } from "./kind";

/**
 * The aggregate's state machine, as the code wrote it down. Boxes and arrows
 * are SVG; the labels are HTML laid over it, because a label holds a link to
 * the event the move publishes, and a link belongs in the document, not in a
 * picture of one.
 */
export function LifecycleDiagram({
  aggregate,
  eventPath,
}: {
  aggregate: Aggregate;
  eventPath: (eventId: string) => string | null;
}) {
  const lifecycle = aggregate.lifecycle;
  if (!lifecycle) return null;
  const { width, height, boxes, edges } = layoutLifecycle(lifecycle);
  const eventName = (id: string) => aggregate.events.find((e) => e.id === id)?.name ?? id;

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden className="absolute inset-0">
          <defs>
            <marker id="lc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--fg-muted)" />
            </marker>
          </defs>
          {edges.map((e) => (
            <path
              key={`${e.from}-${e.to}-${e.on}`}
              d={e.path}
              fill="none"
              stroke="var(--fg-muted)"
              strokeWidth={1.25}
              strokeDasharray={e.back ? "4 3" : undefined}
              markerEnd="url(#lc-arrow)"
            />
          ))}
          {boxes.map((b) => (
            <g key={b.state}>
              <rect
                x={b.x}
                y={b.y}
                width={METRICS.boxWidth}
                height={METRICS.boxHeight}
                rx={6}
                fill={b.terminal ? "var(--surface)" : "var(--bg)"}
                stroke={b.initial ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={b.initial ? 1.5 : 1}
              />
              {/* A terminal state carries a second, inner edge: the record it becomes. */}
              {b.terminal ? (
                <rect
                  x={b.x + 3}
                  y={b.y + 3}
                  width={METRICS.boxWidth - 6}
                  height={METRICS.boxHeight - 6}
                  rx={4}
                  fill="none"
                  stroke="var(--border)"
                />
              ) : null}
            </g>
          ))}
        </svg>
        {boxes.map((b) => (
          <div
            key={b.state}
            className="mono absolute flex items-center justify-center text-ink"
            style={{ left: b.x, top: b.y, width: METRICS.boxWidth, height: METRICS.boxHeight }}
            title={b.initial ? "where a new one starts" : b.terminal ? "nothing leads out of here" : undefined}
          >
            {b.state}
          </div>
        ))}
        {edges.map((e) => {
          const to = e.emits ? eventPath(e.emits) : null;
          return (
            <div
              key={`${e.from}-${e.to}-${e.on}-label`}
              className="mono absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-control bg-bg px-1 text-muted"
              style={{ left: e.labelX, top: e.labelY }}
              title={e.source ? `made at ${e.source}` : undefined}
            >
              {e.on}
              {e.emits ? (
                <>
                  <span aria-hidden>·</span>
                  {to ? (
                    <Link to={to} className="flex items-center gap-0.5 rounded-control text-ink hover:underline">
                      <KindIcon kind="event" size={11} />
                      {eventName(e.emits)}
                    </Link>
                  ) : (
                    <span>{eventName(e.emits)}</span>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
