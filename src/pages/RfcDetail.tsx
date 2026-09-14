import { ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import { catalog, index } from "../data";
import { allRepos, type AdrCommit, type Rfc } from "../catalog";
import { Markdown } from "../components/Markdown";
import { Ident } from "../components/Ident";
import { SourcePreviewLink } from "../components/SourcePreview";
import { CommitLink } from "../components/CommitLink";
import { WorkItems } from "../components/WorkItems";
import { AdrScopePill, AdrStatusChip, RfcDisplayId, RfcStatusChip } from "../components/primitives";
import { eventPath, paths, servicePath } from "../routes";
import { sourceLocation } from "../lib/source-link";
import { NotFound } from "./NotFound";

function withoutLeadingTitle(body: string): string {
  return body.replace(/^\s*#\s+.*\n+/, "");
}

function CommitLine({ label, commit, repository }: { label: string; commit: AdrCommit; repository?: string }) {
  return (
    <span>
      {label} by <span className="text-ink">{commit.author || "unknown"}</span>
      {" · "}{commit.date.slice(0, 10)}{" · "}
      <CommitLink commit={commit.commit} repository={repository} />
    </span>
  );
}

function RecordLinks({ rfc }: { rfc: Rfc }) {
  if (!rfc.links?.length) return null;
  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs">
      <h2 className="label border-b border-line bg-surface px-4 py-2">Related records</h2>
      <div className="flex flex-col gap-2 p-4">
        {rfc.links.map((record) => {
          if (record.kind === "adr") {
            const adr = index.adrById.get(record.id);
            return adr ? (
              <Link key={`${record.relation}:${record.id}`} to={paths.adr(adr.slug)} className="row flex-wrap gap-2">
                <span className="label">{record.relation}</span>
                <span className="mono">{record.id}</span>
                <span className="min-w-0 grow truncate">{adr.title}</span>
                <AdrStatusChip status={adr.status} />
              </Link>
            ) : null;
          }
          const linked = index.rfcById.get(record.id);
          return linked ? (
            <Link key={`${record.relation}:${record.id}`} to={paths.rfc(linked.slug)} className="row flex-wrap gap-2">
              <span className="label">{record.relation}</span>
              <RfcDisplayId rfc={linked} />
              <span className="min-w-0 grow truncate">{linked.title}</span>
              <RfcStatusChip rfc={linked} />
            </Link>
          ) : null;
        })}
      </div>
    </section>
  );
}

function ArchitectureLinks({ rfc }: { rfc: Rfc }) {
  const services = rfc.relates.services ?? [];
  const events = rfc.relates.events ?? [];
  const flows = rfc.relates.flows ?? [];
  if (services.length + events.length + flows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs">
      <h2 className="label border-b border-line bg-surface px-4 py-2">Affected architecture</h2>
      <div className="flex flex-col gap-4 p-4">
        {services.length ? <div><div className="label mb-2">Services</div><div className="flex flex-wrap gap-1.5">{services.map((id) => {
          const to = servicePath(id);
          return to ? <Link key={id} className="chip border-line-strong" to={to}>{id}</Link> : <span key={id} className="chip status-unresolved">{id}</span>;
        })}</div></div> : null}
        {events.length ? <div><div className="label mb-2">Events</div><div className="flex flex-wrap gap-1.5">{events.map((id) => {
          const to = eventPath(id);
          return to ? <Link key={id} className="chip border-line-strong" to={to}>{index.eventById.get(id)?.name ?? id}</Link> : <span key={id} className="chip status-unresolved">{id}</span>;
        })}</div></div> : null}
        {flows.length ? <div><div className="label mb-2">Flows</div><div className="flex flex-wrap gap-1.5">{flows.map((slug) => <Link key={slug} className="chip border-line-strong" to={paths.flow(slug)}>{slug}</Link>)}</div></div> : null}
      </div>
    </section>
  );
}

export function RfcDetail() {
  const { rfc: slug } = useParams();
  const rfc = slug ? index.rfcBySlug.get(slug) : undefined;
  useDocumentTitle(rfc?.title ?? "RFC not found");
  if (!rfc) return <NotFound kind="RFC" id={slug} />;
  const source = sourceLocation(
    rfc.source,
    rfc.repository ? { repo: rfc.repository } : null,
    allRepos(catalog),
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line px-gutter py-5">
        <div className="label">request for comments</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <RfcDisplayId rfc={rfc} className="text-md" />
          <h1 className="text-md font-semibold" title={rfc.title}>{rfc.title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {rfc.discussionUrl ? (
              <a className="tbtn" href={rfc.discussionUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> Open discussion
              </a>
            ) : null}
            <RfcStatusChip rfc={rfc} />
            <AdrScopePill scope={rfc.scope} />
          </div>
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-x-4 text-muted">
          <span title="normalized lifecycle">{rfc.lifecycle}</span>
          {rfc.updatedAt ? <span title="last activity">updated {rfc.updatedAt.slice(0, 10)}</span> : null}
          {rfc.createdAt ? <span title="created">created {rfc.createdAt.slice(0, 10)}</span> : null}
          {rfc.repository ? <span>repository · <Ident value={rfc.repository} title={`${rfc.repository} — click to copy`} /></span> : null}
          <SourcePreviewLink location={source} className="hover:text-accent">{rfc.source}</SourcePreviewLink>
          {source?.kind === "remote" ? <span title="repository revision">at {source.ref.slice(0, 12)}</span> : null}
          <Ident value={rfc.id} />
          <WorkItems catalog={catalog} target={{ kind: "rfc", id: rfc.id }} />
        </div>
        {rfc.authors?.length ? <div className="mono mt-1 text-muted">authors · {rfc.authors.join(", ")}</div> : null}
        {rfc.shepherds?.length ? <div className="mono mt-1 text-muted">shepherds · {rfc.shepherds.join(", ")}</div> : null}
        {rfc.created || rfc.revised ? (
          <div className="mono mt-1 flex flex-wrap items-center gap-x-4 text-muted">
            {rfc.created ? <CommitLine label="committed" commit={rfc.created} repository={rfc.repository} /> : null}
            {rfc.revised ? <CommitLine label="revised" commit={rfc.revised} repository={rfc.repository} /> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-section p-gutter">
        <div className="min-w-0 grow basis-[40rem]">
          <Markdown mermaid>{withoutLeadingTitle(rfc.body)}</Markdown>
        </div>
        {(rfc.links?.length ?? 0) + (rfc.relates.services?.length ?? 0) + (rfc.relates.events?.length ?? 0) + (rfc.relates.flows?.length ?? 0) > 0 ? (
          <div className="flex min-w-[280px] max-w-prose grow basis-[280px] flex-col gap-4">
            <ArchitectureLinks rfc={rfc} />
            <RecordLinks rfc={rfc} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
