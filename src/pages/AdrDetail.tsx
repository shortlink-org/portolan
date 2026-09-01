import { Link, useParams } from "react-router";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { index } from "../data";
import type { Adr } from "../catalog";
import { adrNumber } from "../lib/adr";
import { Markdown } from "../components/Markdown";
import { Empty } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import {
  AdrNumber,
  AdrScopePill,
  AdrStatusChip,
} from "../components/primitives";
import { eventPath, paths, servicePath } from "../routes";
import { PinButton } from "../app/pins";
import { NotFound } from "./NotFound";

/**
 * The body's own H1 repeats the title in the header of this page; MADR files
 * carry it because they are read as files. Dropping it here changes nothing
 * about the record, only about the duplication on screen.
 */
function withoutLeadingTitle(body: string): string {
  return body.replace(/^\s*#\s+.*\n+/, "");
}

function Banner({
  direction,
  adr,
}: {
  direction: "forward" | "back";
  adr: Adr;
}) {
  const forward = direction === "forward";
  const Icon = forward ? ArrowRight : ArrowLeft;
  return (
    <Link
      to={paths.adr(adr.slug)}
      className="flex flex-wrap items-center gap-2 rounded-control border px-3 py-2 t-micro transition-colors hover:bg-surface"
      style={{
        borderColor: forward ? "var(--status-declared)" : "var(--border)",
        background: forward
          ? "color-mix(in srgb, var(--status-declared) 10%, transparent)"
          : undefined,
      }}
    >
      <Icon
        size={13}
        aria-hidden
        style={{ color: forward ? "var(--status-declared)" : undefined }}
        className={forward ? "" : "text-muted"}
      />
      <span
        className="mono"
        style={{ color: forward ? "var(--status-declared)" : undefined }}
      >
        {forward ? "Superseded by" : "Supersedes"} {adrNumber(adr)}
      </span>
      <span className={forward ? "" : "text-muted"}>{adr.title}</span>
      <AdrStatusChip status={adr.status} />
    </Link>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function RelatedPanel({ adr }: { adr: Adr }) {
  const services = adr.relates.services ?? [];
  const events = adr.relates.events ?? [];
  const flows = adr.relates.flows ?? [];
  const empty =
    services.length === 0 && events.length === 0 && flows.length === 0;

  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs">
      <h2 className="label border-b border-line bg-surface px-4 py-2">
        Related
      </h2>
      <div className="flex flex-col gap-4 p-4">
        {empty ? <Empty>this decision names nothing</Empty> : null}

        {services.length > 0 ? (
          <div>
            <div className="label mb-2">Services</div>
            <Chips>
              {services.map((id) => {
                const to = servicePath(id);
                return to ? (
                  <Link key={id} to={to} className="chip border-line-strong">
                    {id}
                  </Link>
                ) : (
                  <span key={id} className="chip status-unresolved">
                    {id}
                  </span>
                );
              })}
            </Chips>
          </div>
        ) : null}

        {events.length > 0 ? (
          <div>
            <div className="label mb-2">Events</div>
            <Chips>
              {events.map((id) => {
                const to = eventPath(id);
                const name = index.eventById.get(id)?.name ?? id;
                return to ? (
                  <Link
                    key={id}
                    to={to}
                    title={id}
                    className="chip border-line-strong"
                  >
                    {name}
                  </Link>
                ) : (
                  <span key={id} className="chip status-unresolved">
                    {id}
                  </span>
                );
              })}
            </Chips>
          </div>
        ) : null}

        {flows.length > 0 ? (
          <div>
            <div className="label mb-2">Flows</div>
            <Chips>
              {flows.map((slug) => (
                <Link
                  key={slug}
                  to={paths.flow(slug)}
                  className="chip border-line-strong"
                >
                  {slug}
                </Link>
              ))}
            </Chips>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function AdrDetail() {
  const { adr: slug } = useParams();
  const adr = slug ? index.adrBySlug.get(slug) : undefined;
  if (!adr) return <NotFound kind="Decision" id={slug} />;

  const successor = adr.supersededBy
    ? index.adrById.get(adr.supersededBy)
    : undefined;
  const predecessors = (adr.supersedes ?? [])
    .map((id) => index.adrById.get(id))
    .filter((a): a is Adr => a !== undefined);

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line px-gutter py-5">
        <div className="label">decision record</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <AdrNumber adr={adr} className="text-md" />
          <h1 className="text-md font-semibold" title={adr.title}>
            {adr.title}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <PinButton kind="adr" id={adr.id} label={adr.title} />
            <AdrStatusChip status={adr.status} />
            <AdrScopePill scope={adr.scope} />
          </div>
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-x-4 text-muted">
          <span title="decision date">{adr.date}</span>
          <Ident value={adr.source} title={`${adr.source} — click to copy`} />
          <Ident value={adr.id} />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-section p-gutter">
        <div className="min-w-0 flex-1">
          {successor || predecessors.length > 0 ? (
            <div className="mb-section flex max-w-prose flex-col gap-1.5">
              {successor ? (
                <Banner direction="forward" adr={successor} />
              ) : null}
              {predecessors.map((p) => (
                <Banner key={p.id} direction="back" adr={p} />
              ))}
            </div>
          ) : null}

          {/* Rendered exactly as written, mermaid fences included. No LikeC4
              view belongs here: a decision record must not redraw itself from
              a model that has moved on since it was taken. */}
          <Markdown mermaid>{withoutLeadingTitle(adr.body)}</Markdown>
        </div>

        <div className="w-[280px] shrink-0">
          <RelatedPanel adr={adr} />
        </div>
      </div>
    </div>
  );
}
