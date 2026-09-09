import { useState } from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useForgeAccess } from "../app/forge-access";
import { buildInfo, repositoryCommitHref } from "../lib/build-info";
import { forgeRepoFromUrl } from "../lib/github-catalog";
import type { ForgeCommit, ForgeRepo } from "../lib/github-catalog";
import { forgeCommitQuery } from "../lib/queries";
import { absoluteTime, relativeTime } from "../lib/format";
import { Ident } from "./Ident";

const buildRepo = forgeRepoFromUrl(buildInfo.repoUrl, buildInfo.forge);

function repoFrom(value: string): ForgeRepo | null {
  const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return forgeRepoFromUrl(url);
}

function commitHref(repo: ForgeRepo, commit: string): string {
  const route = repo.provider === "gitlab" ? "/-/commit/" : "/commit/";
  return `${repo.webUrl.replace(/\/$/, "")}${route}${encodeURIComponent(commit)}`;
}

export function CommitLink({
  commit,
  repo,
  repository,
  href,
  length = 7,
  className = "",
}: {
  commit: string;
  /** Pass null when the repository is known to be unavailable. */
  repo?: ForgeRepo | null;
  /** A repository URL or host/owner/name, used when a ForgeRepo is not already available. */
  repository?: string;
  href?: string | null;
  length?: number;
  className?: string;
}) {
  const parsed = repository === undefined ? undefined : repoFrom(repository);
  const resolvedRepo = repo !== undefined ? repo : parsed !== undefined ? parsed : buildRepo;
  const hasExplicitRepo = repo !== undefined || repository !== undefined;
  const resolvedHref = href !== undefined
    ? href
    : resolvedRepo
      ? commitHref(resolvedRepo, commit)
      : hasExplicitRepo
        ? null
        : repositoryCommitHref(commit);
  const label = commit.slice(0, length);

  if (!resolvedHref) return <Ident value={commit} className={className}>{label}</Ident>;
  if (!resolvedRepo) {
    return <a href={resolvedHref} target="_blank" rel="noreferrer" className={`rounded-[4px] text-accent underline-offset-4 hover:underline ${className}`}>{label}</a>;
  }

  return <CommitPopover commit={commit} repo={resolvedRepo} href={resolvedHref} label={label} className={className} />;
}

function CommitPopover({ commit, repo, href, label, className }: { commit: string; repo: ForgeRepo; href: string; label: string; className: string }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, delay: { open: 100, close: 80 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const access = useForgeAccess();
  const token = access.tokenFor(repo);
  const details = useQuery({
    ...forgeCommitQuery(repo, token, commit),
    enabled: open,
  });

  return (
    <>
      <a
        ref={refs.setReference}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open commit ${commit} on the forge`}
        className={`rounded-[4px] text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${className}`}
        {...getReferenceProps()}
      >
        {label}
      </a>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-50"
            {...getFloatingProps()}
          >
            <div className="palette-in pointer-events-none w-80 max-w-[calc(100vw-1rem)] rounded-control border bg-canvas p-3 mono text-xs normal-case border-line-strong text-muted shadow-md">
              <div className="label">commit</div>
              {details.isPending ? (
                <div className="mt-2">loading commit…</div>
              ) : details.isError ? (
                <div className="mt-2">commit details unavailable</div>
              ) : (
                <CommitHoverContent commit={details.data} />
              )}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

function CommitHoverContent({ commit }: { commit: ForgeCommit }) {
  const hasStats = commit.additions !== null || commit.deletions !== null;
  const body = commit.body.replace(/\s+/g, " ").trim();
  const summary = body.length > 180 ? `${body.slice(0, 177).trimEnd()}…` : body;
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        {commit.avatarUrl ? <img src={commit.avatarUrl} alt="" className="size-7 rounded-full" /> : null}
        <div className="min-w-0">
          <div className="truncate text-ink">{commit.author}</div>
          {commit.authoredAt ? <div className="text-faint" title={absoluteTime(commit.authoredAt)}>{relativeTime(commit.authoredAt)}</div> : null}
        </div>
      </div>
      <div className="mt-2 font-sans font-medium text-ink">{commit.title}</div>
      {summary ? <div className="mt-1 font-sans text-muted">{summary}</div> : null}
      <div className="mt-2 flex items-center gap-3 border-t pt-2 border-line text-faint">
        <span className="truncate" title={commit.sha}>{commit.sha}</span>
        {hasStats ? <span className="ml-auto shrink-0"><span className="text-verified">+{commit.additions ?? 0}</span>{" "}<span className="text-unresolved">−{commit.deletions ?? 0}</span></span> : null}
      </div>
    </div>
  );
}
