// Explainable path impact for a branch draft. "Changed with" is deliberate:
// path co-change is useful navigation, never implementation evidence.

import { Link } from "react-router";
import { SectionTitle } from "../components/PageHeader";
import { index } from "../data";
import type { PathImpact } from "../lib/path-impact";
import { paths } from "../routes";

function ServiceLink({ id }: { id: string }) {
  const service = index.serviceById.get(id);
  const context = index.serviceContext.get(id);
  return service && context ? (
    <Link to={paths.service(context.id, service.slug)} className="text-accent hover:underline">{id}</Link>
  ) : <span>{id}</span>;
}

function Owner({ impact }: { impact: PathImpact }) {
  if (impact.level === "service") {
    return <><ServiceLink id={impact.service} /> <span className="text-muted">via {impact.servicePath || "repository root"}</span></>;
  }
  if (impact.reason === "ambiguous") {
    return (
      <>
        <span className="text-unresolved">repository · ambiguous</span>
        <span className="text-muted">{impact.candidates.map((id, at) => <span key={id}>{at > 0 ? ", " : ""}<ServiceLink id={id} /></span>)}</span>
      </>
    );
  }
  return <span className="text-muted">repository · no service path matched</span>;
}

export function ChangedWith({ impact, className = "" }: { impact: readonly PathImpact[]; className?: string }) {
  if (impact.length === 0) return null;
  return (
    <section className={className}>
      <SectionTitle right={<span className="mono text-muted">{impact.length} path{impact.length === 1 ? "" : "s"}</span>}>
        Changed with
      </SectionTitle>
      <p className="mb-2 max-w-prose text-xs text-muted">
        Derived from paths changed between the branch base and tip. This is impact, not implementation evidence.
      </p>
      <div className="overflow-hidden rounded-card border border-line">
        {impact.map((item) => (
          <div key={item.path} className="grid gap-1 border-b border-line px-3 py-2 last:border-b-0 md:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)] md:gap-4">
            <span className="mono min-w-0 break-all text-ink">{item.path}</span>
            <span className="mono flex min-w-0 flex-wrap gap-x-2 text-xs"><Owner impact={item} /></span>
          </div>
        ))}
      </div>
    </section>
  );
}
