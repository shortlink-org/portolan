import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import type { ActivityEvidence, ActivityLink, SpecActivityEvent } from "../lib/spec-activity";
import { SectionTitle } from "./PageHeader";

const EVIDENCE: Record<ActivityEvidence, { label: string; tone: string }> = {
  "author-intent": { label: "Author intent", tone: "status-declared" },
  "catalog-diff": { label: "Catalog diff", tone: "border-accent/30 text-accent" },
  "git-history": { label: "Git history", tone: "status-verified" },
  "changed-with": { label: "Changed with", tone: "border-declared/30 text-declared" },
};

const SEVERITY = { breaking: "Breaking", addition: "Added", change: "Changed" } as const;

function EventLink({ link }: { link: ActivityLink }) {
  if (!link.href) return <span>{link.label}</span>;
  if (link.external) {
    return <a href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{link.label}<ExternalLink size={11} aria-hidden /></a>;
  }
  return <Link to={link.href} className="text-accent hover:underline">{link.label}</Link>;
}

export function ActivityFeed({ events, title = "Activity", className = "" }: { events: readonly SpecActivityEvent[]; title?: string; className?: string }) {
  if (events.length === 0) return null;
  return (
    <section className={className}>
      <SectionTitle right={<span className="mono text-muted">{events.length}</span>}>{title}</SectionTitle>
      <div className="overflow-hidden rounded-card border border-line">
        {events.map((event) => {
          const evidence = EVIDENCE[event.evidence];
          return (
            <article key={event.key} className="border-b border-line px-3 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${evidence.tone}`}>{evidence.label}</span>
                {event.severity ? <span className="chip border-line-strong">{SEVERITY[event.severity]}</span> : null}
                <span className="mono text-xs text-muted">{event.kind}</span>
                {event.timestamp ? <time dateTime={event.timestamp} className="mono ml-auto text-xs text-muted">{event.timestamp.slice(0, 10)}</time> : null}
              </div>
              <p className="mt-2 text-sm text-ink">{event.summary}</p>
              {event.source || event.architecture ? (
                <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {event.source ? <span>source · <EventLink link={event.source} /></span> : null}
                  {event.architecture ? <span>architecture · <EventLink link={event.architecture} /></span> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
