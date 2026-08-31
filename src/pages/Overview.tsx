import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { catalog } from "../data";
import { flowCoverage } from "../catalog";
import { contextStats, flowsByReach } from "../lib/derive";
import { contextVar, ctxStyle } from "../lib/context-color";
import { absoluteTime, relativeTime } from "../lib/format";
import { paths } from "../routes";
import { SectionTitle } from "../components/PageHeader";
import {
  ContextPill,
  CoverageBar,
  ProvenanceBadge,
} from "../components/primitives";

export function Overview() {
  const reach = flowsByReach(catalog);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[15px] font-semibold">portolan</h1>
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

      <div className="mt-5">
        <SectionTitle>Contexts</SectionTitle>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {catalog.contexts.map((context) => {
            const stats = contextStats(context);
            return (
              <Link
                key={context.id}
                to={paths.context(context.id)}
                className="card"
                style={{
                  borderColor: "var(--border)",
                  borderLeft: `3px solid ${contextVar(context.id)}`,
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{context.name}</span>
                  <span className="mono ctx" style={ctxStyle(context.id)}>
                    {context.id}
                  </span>
                  {stats.unresolved > 0 ? (
                    <span
                      className="mono ml-auto flex items-center gap-1 border px-1.5"
                      style={{
                        color: "var(--status-unresolved)",
                        borderColor: "var(--status-unresolved)",
                      }}
                      title="unresolved rpc calls and unresolved event consumers"
                    >
                      <AlertTriangle size={10} aria-hidden />
                      {stats.unresolved}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-muted">{context.summary}</p>
                <div className="mono mt-2.5 flex gap-4 text-muted">
                  <span>{stats.services} services</span>
                  <span>{stats.aggregates} aggregates</span>
                  <span>{stats.events} events</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle
          right={
            <Link to={paths.flows()} className="mono text-accent">
              all flows →
            </Link>
          }
        >
          Flows by reach
        </SectionTitle>
        <div className="flex flex-col gap-1">
          {reach.map(({ flow, contexts }) => {
            const cov = flowCoverage(flow);
            return (
              <Link
                key={flow.slug}
                to={paths.flow(flow.slug)}
                className="row flex-wrap"
                style={{
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
                <span className="font-semibold">{flow.name}</span>
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
