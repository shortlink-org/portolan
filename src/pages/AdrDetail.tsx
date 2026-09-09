import { useDocumentTitle } from "../app/title";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { index } from "../data";
import type { Adr, AdrCommit } from "../catalog";
import { adrNumber } from "../lib/adr";
import { Markdown } from "../components/Markdown";
import { Ident } from "../components/Ident";
import {
  AdrNumber,
  AdrScopePill,
  AdrStatusChip,
} from "../components/primitives";
import { eventPath, paths, servicePath } from "../routes";
import { PinButton } from "../app/pins";
import { NotFound } from "./NotFound";
import { buildInfo, repositoryCommitHref } from "../lib/build-info";
import { forgeRepoFromUrl } from "../lib/github-catalog";
import type { ForgeCommit } from "../lib/github-catalog";
import { forgeCommitQuery } from "../lib/queries";
import { useForgeAccess } from "../app/forge-access";
import { absoluteTime, relativeTime } from "../lib/format";

const buildRepo = forgeRepoFromUrl(buildInfo.repoUrl, buildInfo.forge);

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

/** Whether a record names anything at all; a panel with nothing in it is not shown. */
function relatesToSomething(adr: Adr): boolean {
  return (
    (adr.relates.services?.length ?? 0) > 0 ||
    (adr.relates.events?.length ?? 0) > 0 ||
    (adr.relates.flows?.length ?? 0) > 0
  );
}

function RelatedPanel({ adr }: { adr: Adr }) {
  const services = adr.relates.services ?? [];
  const events = adr.relates.events ?? [];
  const flows = adr.relates.flows ?? [];

  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs">
      <h2 className="label border-b border-line bg-surface px-4 py-2">
        Related
      </h2>
      <div className="flex flex-col gap-4 p-4">

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
  useDocumentTitle(adr?.title ?? "Decision not found");
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
        {adr.created || adr.revised ? (
          <div className="mono mt-1 flex flex-wrap items-center gap-x-4 text-muted">
            {adr.created ? <CommitLine label="committed" commit={adr.created} /> : null}
            {adr.revised ? <CommitLine label="revised" commit={adr.revised} /> : null}
          </div>
        ) : null}
      </div>

      {/* The record first. It asks for a column of prose; the related panel
          sits beside it only when there is room for both, and drops below
          otherwise, so the record is never squeezed to make room for a list
          of chips. A record that names nothing has no panel at all. */}
      <div className="flex flex-wrap items-start gap-section p-gutter">
        <div className="min-w-0 grow basis-[40rem]">
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

        {relatesToSomething(adr) ? (
          <div className="min-w-[280px] max-w-prose grow basis-[280px]">
            <RelatedPanel adr={adr} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Who wrote the record down and when, from git: "committed by Ada Lovelace · 2026-01-01 · 0a1b2c3". */
function CommitLine({ label, commit }: { label: string; commit: AdrCommit }) {
  const href = repositoryCommitHref(commit.commit);
  if (!href || !buildRepo) {
    return (
      <span title={`${label} in ${commit.commit}`}>
        {label} by <span className="text-ink">{commit.author || "unknown"}</span>
        {" · "}
        {commit.date.slice(0, 10)}
        {" · "}
        <Ident value={commit.commit}>{commit.commit.slice(0, 7)}</Ident>
      </span>
    );
  }

  return (
    <span>
      {label} by <span className="text-ink">{commit.author || "unknown"}</span>
      {" · "}
      {commit.date.slice(0, 10)}
      {" · "}
      <CommitHoverLink commit={commit} href={href} />
    </span>
  );
}

function CommitHoverLink({ commit, href }: { commit: AdrCommit; href: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const access = useForgeAccess();
  const token = access.tokenFor(buildRepo!);
  const details = useQuery({
    ...forgeCommitQuery(buildRepo, token, commit.commit),
    enabled: open,
  });

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open commit ${commit.commit} on the forge`}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="rounded-[4px] text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        {commit.commit.slice(0, 7)}
      </a>
      {open ? (
        <span className="absolute left-0 top-full z-50 block pt-1">
          <span
            id={id}
            role="tooltip"
            className="palette-in pointer-events-none block w-80 max-w-[calc(100vw-2rem)] rounded-control border bg-canvas p-3 normal-case border-line-strong shadow-md"
          >
            <span className="label block">commit</span>
            {details.isPending ? (
              <span className="mt-2 block text-muted">loading commit…</span>
            ) : details.isError ? (
              <span className="mt-2 block text-muted">commit details unavailable</span>
            ) : (
              <CommitHoverContent commit={details.data} />
            )}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function CommitHoverContent({ commit }: { commit: ForgeCommit }) {
  const hasStats = commit.additions !== null || commit.deletions !== null;
  const body = commit.body.replace(/\s+/g, " ").trim();
  const summary = body.length > 180 ? `${body.slice(0, 177).trimEnd()}…` : body;
  return (
    <span className="mt-2 block">
      <span className="flex items-center gap-2">
        {commit.avatarUrl ? <img src={commit.avatarUrl} alt="" className="size-7 rounded-full" /> : null}
        <span className="min-w-0">
          <span className="block truncate text-ink">{commit.author}</span>
          {commit.authoredAt ? <span className="block text-faint" title={absoluteTime(commit.authoredAt)}>{relativeTime(commit.authoredAt)}</span> : null}
        </span>
      </span>
      <span className="mt-2 block font-sans font-medium text-ink">{commit.title}</span>
      {summary ? <span className="mt-1 block font-sans text-muted">{summary}</span> : null}
      <span className="mt-2 flex items-center gap-3 border-t pt-2 border-line text-faint">
        <span className="truncate" title={commit.sha}>{commit.sha}</span>
        {hasStats ? <span className="ml-auto shrink-0"><span className="text-verified">+{commit.additions ?? 0}</span>{" "}<span className="text-unresolved">−{commit.deletions ?? 0}</span></span> : null}
      </span>
    </span>
  );
}
