import { useDocumentTitle } from "../app/title";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { catalog } from "../data";
import { plural } from "../lib/format";
import { CapabilityEmpty, Empty } from "../components/PageHeader";
import {
  bundles,
  edgeCount,
  eventGraph,
  filterEventGraph,
} from "../lib/event-graph";
import { contextVar } from "../lib/context-color";
import { narrowToEnvironments } from "../lib/environments";
import { environmentsOf } from "../likec4/ids";
import { statusColor, statusDash } from "../graph/theme";
import { DependencyGraphPane } from "../graph/DependencyGraph";
import type { GraphMode } from "../graph/dependency-layout";
import type { Status } from "../catalog";
import { paths } from "../routes";

const STATUSES: { status: Status; note: string }[] = [
  { status: "verified", note: "consumption observed" },
  { status: "declared", note: "handler registered, not observed" },
  { status: "unresolved", note: "consumer not in the catalog" },
];

export function GraphPage() {
  useDocumentTitle("Dependency graph");
  const [contexts, setContexts] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<Status>>(new Set());
  const [mode, setMode] = useState<GraphMode>("bipartite");
  // Where the estate runs, when a snapshot says. Narrowing the catalog
  // rather than the graph: a service not deployed in staging is not a node
  // to fade but a service that is not there, and every count follows.
  const environmentChips = useMemo(() => environmentsOf(catalog), []);
  const [environments, setEnvironments] = useState<Set<string>>(new Set());

  const whole = useMemo(
    () => eventGraph(narrowToEnvironments(catalog, environments)),
    [environments],
  );
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

  // Nothing to draw. A graph is its events; a canvas of one or two service
  // pills with no line between them reads as a rendering failure rather than
  // as an answer. Either the filters left no event - the common case, and the
  // reader wants the way back - or the catalog has none yet.
  const filtered =
    contexts.size > 0 || statuses.size > 0 || environments.size > 0;
  const nothing = graph.events.length === 0;

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  // Filters and mode both replace the layout wholesale, so both refit. Nothing
  // else does: a selection or a focus leaves the viewport where the reader put
  // it.
  const fitKey = `${[...contexts].sort().join(",")}|${[...statuses].sort().join(",")}|${[...environments].sort().join(",")}|${mode}`;

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

        {environmentChips.length > 0 ? (
          <div className="seg" role="group" aria-label="Filter by environment">
            {environmentChips.map((env) => {
              const on = environments.has(env);
              return (
                <button
                  key={env}
                  type="button"
                  onClick={() => setEnvironments((prev) => toggle(prev, env))}
                  aria-pressed={on}
                  title={`only the services the deployer places in ${env}`}
                  className="flex items-center gap-1.5"
                  style={{
                    color: on ? "var(--accent)" : "var(--fg-muted)",
                    background: on
                      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : undefined,
                  }}
                >
                  {env}
                </button>
              );
            })}
          </div>
        ) : null}

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
        {nothing ? (
          <div className="p-gutter">
            {filtered ? (
              <Empty>
                <>
                  no event passes these filters.{" "}
                  <button
                    type="button"
                    className="rounded-control text-accent hover:underline"
                    onClick={() => {
                      setContexts(new Set());
                      setStatuses(new Set());
                    }}
                  >
                    show everything
                  </button>
                </>
              </Empty>
            ) : (
              <CapabilityEmpty
                title={catalog.contexts.length === 0 ? "Connect a project before mapping dependencies" : "No dependency graph yet"}
                signal="Signals: domain events, message consumers, AsyncAPI channels and integration contracts."
                actions={<>
                  <Link className="product-primary" to={paths.settingsProjects()}>{catalog.contexts.length === 0 ? "Connect a project" : "Review project extraction"}</Link>
                  {catalog.contexts.length > 0 ? <Link className="tbtn" to={paths.map()}>Open context map</Link> : null}
                </>}
              >
                {catalog.contexts.length === 0
                  ? "Portolan needs at least one project before it can discover events and their consumers."
                  : "The catalog has components, but no events or consumers to connect yet. Review the selected extractors and the evidence they found."
                }
              </CapabilityEmpty>
            )}
          </div>
        ) : (
          <DependencyGraphPane
            graph={graph}
            mode={mode}
            onMode={setMode}
            fitKey={fitKey}
          />
        )}
      </div>
    </div>
  );
}
