import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { catalog } from "../data";
import { flowCoverage } from "../catalog";
import { contextStats, flowsByReach } from "../lib/derive";
import { contextVar, ctxStyle } from "../lib/context-color";
import { absoluteTime, relativeTime } from "../lib/format";
import { useCountUp, staggerStyle } from "../lib/motion";
import { paths } from "../routes";
import { SectionTitle } from "../components/PageHeader";
import {
  ContextPill,
  CoverageBar,
  ProvenanceBadge,
} from "../components/primitives";

/** A measurement that arrives rather than appears. 200ms, linear, once. */
function Count({ value, unit }: { value: number; unit: string }) {
  const shown = useCountUp(value);
  return (
    <span className="tnum">
      {shown} {unit}
    </span>
  );
}

export function Overview() {
  const reach = flowsByReach(catalog);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold">portolan</h1>
        <span className="text-muted">
          the chart is drawn from measurements; the code is the territory
        </span>
        <span
          className="mono ml-auto text-muted"
          title={absoluteTime(catalog.generatedAt)}
        >
          {catalog.commit} · {relativeTime(catalog.generatedAt)}
        </span>
      </div>

      <div className="mt-section">
        <SectionTitle>Contexts</SectionTitle>
        <div className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {catalog.contexts.map((context, i) => {
            const stats = contextStats(context);
            return (
              <Link
                key={context.id}
                to={paths.context(context.id)}
                className="card stagger-in"
                /* Longhands only: React warns when a shorthand and a longhand
                   for the same edge disagree across renders. */
                style={{
                  ...staggerStyle(i),
                  borderLeftWidth: 3,
                  borderLeftColor: contextVar(context.id),
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold" title={context.name}>
                    {context.name}
                  </span>
                  <span className="mono ctx" style={ctxStyle(context.id)}>
                    {context.id}
                  </span>
                  {stats.unresolved > 0 ? (
                    <span
                      className="chip ml-auto status-unresolved"
                      title="unresolved rpc calls and unresolved event consumers"
                    >
                      <AlertTriangle size={12} aria-hidden />
                      {stats.unresolved}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-muted">{context.summary}</p>
                <div className="mono mt-4 flex gap-4 text-muted">
                  <Count value={stats.services} unit="services" />
                  <Count value={stats.aggregates} unit="aggregates" />
                  <Count value={stats.events} unit="events" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-section">
        <SectionTitle
          right={
            <Link
              to={paths.flows()}
              className="mono rounded-control px-1 text-accent hover:underline"
            >
              all flows →
            </Link>
          }
        >
          Flows by reach
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {reach.map(({ flow, contexts }, i) => {
            const cov = flowCoverage(flow);
            return (
              <Link
                key={flow.slug}
                to={paths.flow(flow.slug)}
                className="row stagger-in flex-wrap"
                style={{
                  ...staggerStyle(i),
                  borderColor:
                    cov.unresolved > 0
                      ? "var(--status-unresolved)"
                      : "var(--border)",
                }}
              >
                <span
                  className="mono w-6 shrink-0 text-right text-muted"
                  title={`${contexts.length} contexts crossed`}
                >
                  {contexts.length}×
                </span>
                <span className="font-semibold" title={flow.name}>
                  {flow.name}
                </span>
                <div className="flex flex-wrap gap-1">
                  {contexts.map((c) => (
                    <ContextPill key={c} id={c} />
                  ))}
                </div>
                <ProvenanceBadge
                  provenance={flow.provenance}
                  source={flow.source}
                  verifiedAt={flow.verifiedAt}
                />
                <div className="ml-auto w-48">
                  <CoverageBar coverage={cov} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
