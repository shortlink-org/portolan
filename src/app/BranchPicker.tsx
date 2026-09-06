import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, ExternalLink, GitBranch, LoaderCircle, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { branchCompareHref } from "../lib/branch-compare";
import { buildInfo } from "../lib/build-info";
import { findRef, sortRefs } from "../lib/forge-refs";
import { forgeRepoFromUrl, listForgeRefs } from "../lib/github-catalog";
import type { ForgeRef } from "../lib/github-catalog";
import { forgetComparison, rememberComparison } from "../lib/comparison-memory";
import { paths } from "../routes";
import { useForgeAccess } from "./forge-access";

function refNote(ref: ForgeRef, current: string): string {
  if (ref.kind === "branch" && ref.name === current) return `${ref.commit.slice(0, 7)} · current catalog`;
  return `${ref.commit.slice(0, 7)}${ref.protected ? " · protected" : ""}`;
}

/**
 * Selects the comparison head. Branches and tags are read from the configured forge at
 * runtime; a choice opens the first-class changes route, whose URL carries both heads.
 */
export function BranchPicker({ compact = false }: { compact?: boolean }) {
  const current = buildInfo.branch || "main";
  const repo = forgeRepoFromUrl(buildInfo.repoUrl, buildInfo.forge);
  const access = useForgeAccess();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const [remote, setRemote] = useState<ForgeRef[]>([]);
  const [loading, setLoading] = useState(Boolean(repo));
  const [error, setError] = useState("");
  const token = repo ? access.tokenFor(repo) : "";

  useEffect(() => {
    let live = true;
    if (!repo) {
      setRemote([]);
      setLoading(false);
      return;
    }
    setRemote([]);
    setLoading(true);
    setError("");
    listForgeRefs(repo, { token })
      .then((refs) => {
        if (live) setRemote(refs);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [repo?.provider, repo?.webUrl, token]);

  const refs = useMemo(() => {
    const known = remote.some((ref) => ref.kind === "branch" && ref.name === current)
      ? remote
      : [...remote, { name: current, commit: buildInfo.commit, protected: false, kind: "branch" as const }];
    return sortRefs(known, current);
  }, [current, remote]);
  const branches = refs.filter((ref) => ref.kind === "branch");
  const tags = refs.filter((ref) => ref.kind === "tag");

  const requested = pathname === paths.changes() ? search.get("head") ?? "" : "";
  const selected = findRef(refs, requested) ? requested : current;
  const comparing = selected !== current;
  const compareHref = branchCompareHref(current, selected);

  const choose = (name: string) => {
    if (name === current) {
      forgetComparison();
      navigate(paths.changes());
      return;
    }
    rememberComparison(current, name);
    const next = new URLSearchParams({ base: current, head: name });
    navigate(`${paths.changes()}?${next}`);
  };

  return (
    <Listbox value={selected} onChange={choose}>
      <ListboxButton
        aria-label={comparing ? `Compare ${current} with ${selected}` : `Branch ${current}`}
        title={comparing ? `${current} compared with ${selected}` : `Branch ${current}`}
        className={({ open }) =>
          compact
            ? `flex size-8 shrink-0 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${open || comparing ? "text-accent" : "text-muted hover:text-ink"}`
            : `mono flex max-w-56 shrink-0 items-center gap-1.5 rounded-control border px-2 py-1.5 t-micro transition-colors ${open || comparing ? "border-accent text-accent" : "border-line text-muted hover:border-line-strong hover:bg-surface hover:text-ink"}`
        }
      >
        {({ open }) => (
          <>
            <GitBranch size={16} aria-hidden className="shrink-0" />
            {!compact ? <span className="min-w-0 truncate">{comparing ? `${current} → ${selected}` : current}</span> : null}
            {!compact ? (
              <ChevronDown size={13} aria-hidden className={`shrink-0 t-micro transition-transform ${open ? "rotate-180" : ""}`} />
            ) : null}
          </>
        )}
      </ListboxButton>

      <ListboxOptions
        aria-label="Comparison head branch or tag"
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="branch-options palette-in z-50 w-80 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label px-3 pt-2 pb-1">compare {current} with</div>
        {branches.map((ref) => <RefOption key={`branch:${ref.name}`} item={ref} current={current} />)}
        {/* A tag and a branch can share a name; the option's value is the
            name, which the changes route resolves branch-first, so a tag
            shadowed that way is listed but selects the branch. */}
        {tags.length > 0 ? (
          <div className="label flex items-center gap-1.5 border-t border-line px-3 pt-2 pb-1">
            <Tag size={11} aria-hidden /> tags
          </div>
        ) : null}
        {tags.map((ref) => <RefOption key={`tag:${ref.name}`} item={ref} current={current} />)}
        {loading ? (
          <div className="mono flex items-center gap-2 border-t border-line px-3 py-2 text-muted" role="status">
            <LoaderCircle size={13} aria-hidden className="animate-spin" /> Loading {repo?.provider === "gitlab" ? "GitLab" : "GitHub"} branches and tags…
          </div>
        ) : error ? (
          <div className="border-t border-line px-3 py-2 text-sm">
            <div className="text-unresolved">{error}</div>
            <Link to={paths.changes()} className="mt-1 inline-block text-accent hover:underline">
              repository access →
            </Link>
          </div>
        ) : !repo ? (
          <div className="border-t border-line px-3 py-2 text-sm text-muted">Runtime comparison needs a GitHub or GitLab repository.</div>
        ) : null}
        {compareHref ? (
          <div className="sticky bottom-0 mt-1 border-t border-line bg-canvas px-3 py-2">
            <a href={compareHref} target="_blank" rel="noreferrer" className="mono flex items-center gap-1.5 rounded-control text-accent hover:underline">
              open comparison on {repo?.provider === "gitlab" ? "GitLab" : "GitHub"} <ExternalLink size={12} aria-hidden />
            </a>
          </div>
        ) : null}
      </ListboxOptions>
    </Listbox>
  );
}

function RefOption({ item, current }: { item: ForgeRef; current: string }) {
  return (
    <ListboxOption
      value={item.name}
      className={({ focus }) => `mono flex cursor-pointer items-start gap-2 px-3 py-2 ${focus ? "bg-raised" : ""}`}
    >
      {({ selected: on }) => (
        <>
          <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-accent" style={{ opacity: on ? 1 : 0 }} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${on ? "text-accent" : "text-ink"}`}>{item.name}</span>
            <span className="block truncate text-muted">{refNote(item, current)}</span>
          </span>
        </>
      )}
    </ListboxOption>
  );
}
