import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, ExternalLink, GitBranch, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { branchCompareHref } from "../lib/branch-compare";
import { buildInfo } from "../lib/build-info";
import { githubRepoFromUrl, listGitHubBranches } from "../lib/github-catalog";
import type { GitHubBranch } from "../lib/github-catalog";
import { forgetComparison, rememberComparison } from "../lib/comparison-memory";
import { paths } from "../routes";

function branchNote(branch: GitHubBranch, current: string): string {
  if (branch.name === current) return `${branch.commit.slice(0, 7)} · current catalog`;
  return `${branch.commit.slice(0, 7)}${branch.protected ? " · protected" : ""}`;
}

/**
 * Selects the comparison head. Branches are read from GitHub at runtime; a
 * choice opens the first-class changes route, whose URL carries both heads.
 */
export function BranchPicker({ compact = false }: { compact?: boolean }) {
  const current = buildInfo.branch || "main";
  const repo = githubRepoFromUrl(buildInfo.repoUrl);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const [remote, setRemote] = useState<GitHubBranch[]>([]);
  const [loading, setLoading] = useState(Boolean(repo));
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    if (!repo) {
      setLoading(false);
      return;
    }
    listGitHubBranches(repo)
      .then((branches) => {
        if (live) setRemote(branches);
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
  }, [repo?.owner, repo?.repo]);

  const branches = useMemo(() => {
    const byName = new Map(remote.map((branch) => [branch.name, branch]));
    if (!byName.has(current)) {
      byName.set(current, { name: current, commit: buildInfo.commit, protected: false });
    }
    return [...byName.values()].sort((a, b) => {
      if (a.name === current) return -1;
      if (b.name === current) return 1;
      if (a.name === "main") return -1;
      if (b.name === "main") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [current, remote]);

  const requested = pathname === paths.changes() ? search.get("head") ?? "" : "";
  const selected = branches.some((branch) => branch.name === requested) ? requested : current;
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
        aria-label="Comparison head branch"
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="branch-options palette-in z-50 w-80 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label px-3 pt-2 pb-1">compare {current} with</div>
        {branches.map((branch) => (
          <ListboxOption
            key={branch.name}
            value={branch.name}
            className={({ focus }) => `mono flex cursor-pointer items-start gap-2 px-3 py-2 ${focus ? "bg-raised" : ""}`}
          >
            {({ selected: on }) => (
              <>
                <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-accent" style={{ opacity: on ? 1 : 0 }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${on ? "text-accent" : "text-ink"}`}>{branch.name}</span>
                  <span className="block truncate text-muted">{branchNote(branch, current)}</span>
                </span>
              </>
            )}
          </ListboxOption>
        ))}
        {loading ? (
          <div className="mono flex items-center gap-2 border-t border-line px-3 py-2 text-muted" role="status">
            <LoaderCircle size={13} aria-hidden className="animate-spin" /> Loading GitHub branches…
          </div>
        ) : error ? (
          <div className="border-t border-line px-3 py-2 text-sm text-unresolved">{error}</div>
        ) : !repo ? (
          <div className="border-t border-line px-3 py-2 text-sm text-muted">Runtime comparison needs a github.com repository.</div>
        ) : null}
        {compareHref ? (
          <div className="sticky bottom-0 mt-1 border-t border-line bg-canvas px-3 py-2">
            <a href={compareHref} target="_blank" rel="noreferrer" className="mono flex items-center gap-1.5 rounded-control text-accent hover:underline">
              open comparison on GitHub <ExternalLink size={12} aria-hidden />
            </a>
          </div>
        ) : null}
      </ListboxOptions>
    </Listbox>
  );
}
