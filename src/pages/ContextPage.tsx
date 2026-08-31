import { Link, useParams } from "react-router";
import { AlertTriangle } from "lucide-react";
import { catalog } from "../data";
import { contextStats } from "../lib/derive";
import { contextVar } from "../lib/context-color";
import { paths } from "../routes";
import { PageHeader, SectionTitle } from "../components/PageHeader";
import { NotFound } from "./NotFound";
import { C4View } from "../likec4/C4View";
import { contextViewId } from "../likec4/ids";

export function ContextPage() {
  const { context: contextId } = useParams();
  const context = catalog.contexts.find((c) => c.id === contextId);
  if (!context) return <NotFound kind="Context" id={contextId} />;
  const stats = contextStats(context);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind="context"
        name={context.name}
        id={context.id}
        right={
          stats.unresolved > 0 ? (
            <span className="mono flex items-center gap-1 border px-1.5 py-0.5 status-unresolved">
              <AlertTriangle size={11} aria-hidden />
              {stats.unresolved} unresolved
            </span>
          ) : null
        }
      >
        <p className="mt-1.5 max-w-[900px] text-muted">{context.summary}</p>
      </PageHeader>

      <div className="p-4">
        <SectionTitle>Model</SectionTitle>
        <C4View viewId={contextViewId(context)} height={340} />

        <div className="mt-6" />
        <SectionTitle>Services</SectionTitle>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
          {context.services.map((service) => (
            <Link
              key={service.id}
              to={paths.service(context.id, service.slug)}
              className="card"
              style={{
                borderColor: "var(--border)",
                borderLeft: `3px solid ${contextVar(context.id)}`,
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{service.name}</span>
                <span className="mono text-muted">{service.id}</span>
              </div>
              <div className="mono mt-2 flex flex-wrap gap-x-4 text-muted">
                <span>{service.aggregates.length} aggregates</span>
                <span>
                  {service.aggregates.reduce((n, a) => n + a.events.length, 0)}{" "}
                  events
                </span>
                <span>{service.consumes.length} calls out</span>
              </div>
              <div className="mono mt-1 text-muted">
                {service.repo}/{service.path}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
