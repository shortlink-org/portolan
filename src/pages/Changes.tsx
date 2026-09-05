import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  GitCompare,
  RefreshCw,
  Search,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { Catalog } from "../catalog";
import { catalog } from "../data";
import { branchCompareHref } from "../lib/branch-compare";
import { buildInfo } from "../lib/build-info";
import { diffCatalogs, SEVERITIES } from "../lib/catalog-diff";
import type { Change, Severity } from "../lib/catalog-diff";
import { rememberComparison, rememberedComparison } from "../lib/comparison-memory";
import {
  clearForgeCatalogCache,
  forgeRepoFromUrl,
  listForgeBranches,
  loadForgeCatalog,
} from "../lib/github-catalog";
import type { ForgeBranch, ForgeRepo } from "../lib/github-catalog";
import { plural } from "../lib/format";
import { useForgeAccess } from "../app/forge-access";

const LABEL: Record<Severity, string> = {
  breaking: "Breaking",
  addition: "Added",
  change: "Changed",
};

const TONE: Record<Severity, string> = {
  breaking: "text-unresolved border-unresolved/30 bg-unresolved/5",
  addition: "text-declared border-declared/30 bg-declared/5",
  change: "text-accent border-accent/30 bg-accent/5",
};

type Loaded = {
  changes: Change[];
  baseSha: string;
  headSha: string;
};

function short(sha: string): string {
  return sha.slice(0, 7) || "unknown";
}

async function catalogFor(
  name: string,
  current: string,
  repo: ForgeRepo,
  branches: ForgeBranch[],
  token: string,
): Promise<{ catalog: Catalog; sha: string }> {
  if (name === current) return { catalog, sha: buildInfo.commit };
  const branch = branches.find((candidate) => candidate.name === name);
  if (!branch) throw new Error(`Branch “${name}” no longer exists on ${repo.provider === "gitlab" ? "GitLab" : "GitHub"}.`);
  return {
    catalog: await loadForgeCatalog(repo, branch.commit, { token }),
    sha: branch.commit,
  };
}

function RepositoryAccess({ repo, reveal }: { repo: ForgeRepo; reveal: boolean }) {
  const access = useForgeAccess();
  const [draft, setDraft] = useState("");
  const provider = repo.provider === "gitlab" ? "GitLab" : "GitHub";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    access.connect(draft);
    setDraft("");
  };

  return (
    <details
      className="mt-4 rounded-control border border-line bg-surface px-3 py-2"
      open={reveal && !access.connected ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink">
        Repository access
        <span className={`chip ml-auto ${access.connected ? "status-verified" : "text-muted"}`}>
          {access.connected ? "token in memory" : "public access"}
        </span>
      </summary>
      <div className="mt-3 border-t border-line pt-3">
        <p className="max-w-prose text-sm text-muted">
          {access.connected
            ? `${provider} requests from this tab are authenticated. The token is never persisted or included in a URL.`
            : `For a private ${provider} repository, provide a read-only access token. It is kept only in this tab's memory and private catalogs are not written to Cache Storage.`}
        </p>
        {access.connected ? (
          <button
            type="button"
            onClick={access.disconnect}
            className="mono mt-3 rounded-control border border-line px-3 py-2 text-sm text-muted hover:border-line-strong hover:text-ink"
          >
            Forget token
          </button>
        ) : (
          <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{provider} access token</span>
              <input
                type="password"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={`${provider} read-only access token`}
                className="mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="mono rounded-control border border-accent px-3 py-2 text-sm text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Use token
            </button>
          </form>
        )}
      </div>
    </details>
  );
}

export function Changes() {
  const [params, setParams] = useSearchParams();
  const current = buildInfo.branch || "main";
  const base = params.get("base") || current;
  const head = params.get("head") || "";
  const repo = forgeRepoFromUrl(buildInfo.repoUrl, buildInfo.forge);
  const access = useForgeAccess();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [active, setActive] = useState<Set<Severity>>(() => new Set(SEVERITIES));

  useEffect(() => {
    if (head) {
      rememberComparison(base, head);
      return;
    }
    const previous = rememberedComparison();
    if (previous) setParams(previous, { replace: true });
  }, [base, head, setParams]);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setError("");
    if (!head) return;
    if (!repo) {
      setError("Runtime comparison needs a GitHub or GitLab repository URL in the build metadata.");
      return;
    }
    setLoading(true);
    listForgeBranches(repo, { token: access.token })
      .then(async (branches) => {
        const [before, after] = await Promise.all([
          catalogFor(base, current, repo, branches, access.token),
          catalogFor(head, current, repo, branches, access.token),
        ]);
        return {
          changes: diffCatalogs(before.catalog, after.catalog),
          baseSha: before.sha,
          headSha: after.sha,
        };
      })
      .then((result) => {
        if (live) setLoaded(result);
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
  }, [access.token, base, current, head, repo?.provider, repo?.webUrl, retry]);

  const shown = useMemo(() => {
    if (!loaded) return [];
    return loaded.changes.filter((change) => {
      if (!active.has(change.severity)) return false;
      if (!deferredQuery) return true;
      return `${change.where} ${change.kind} ${change.summary}`.toLowerCase().includes(deferredQuery);
    });
  }, [active, deferredQuery, loaded]);

  const toggle = (severity: Severity) => {
    setActive((previous) => {
      const next = new Set(previous);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  const reload = () => {
    clearForgeCatalogCache();
    setRetry((value) => value + 1);
  };

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <div className="label">Architecture diff</div>
            <h1 className="mt-1 text-lg font-semibold">Changes</h1>
          </div>
          {head ? (
            <div className="mono ml-auto flex min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm">
              <span className="truncate text-muted">{base}</span>
              <ArrowRight size={14} aria-hidden className="shrink-0 text-line-strong" />
              <span className="truncate text-ink">{head}</span>
              {branchCompareHref(base, head) ? (
                <a
                  href={branchCompareHref(base, head) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open comparison on GitHub"
                  title="Open comparison on GitHub"
                  className="ml-1 shrink-0 text-muted hover:text-accent"
                >
                  <ExternalLink size={14} aria-hidden />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {repo ? <RepositoryAccess repo={repo} reveal={Boolean(error)} /> : null}

        {!head ? (
          <div className="empty mt-section">
            <GitCompare size={24} aria-hidden className="mx-auto mb-3 text-muted" />
            <div className="font-medium text-ink">Choose a branch in the header</div>
            <p className="mx-auto mt-1 max-w-prose text-muted">
              Portolan will load that branch from {repo?.provider === "gitlab" ? "GitLab" : "GitHub"} and compare its catalog with {current}.
            </p>
          </div>
        ) : loading ? (
          <div className="empty mt-section" role="status">
            <RefreshCw size={20} aria-hidden className="mx-auto mb-3 animate-spin text-accent" />
            Loading the catalog at <span className="mono text-ink">{head}</span>…
          </div>
        ) : error ? (
          <div className="mt-section rounded-control border border-unresolved/30 bg-unresolved/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-unresolved" />
              <div className="min-w-0">
                <div className="font-medium text-ink">Comparison could not be loaded</div>
                <p className="mt-1 text-muted">{error}</p>
                <button type="button" onClick={reload} className="mono mt-3 text-accent hover:underline">
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : loaded ? (
          <>
            <div className="mt-section grid grid-cols-3 gap-2">
              {SEVERITIES.map((severity) => {
                const count = loaded.changes.filter((change) => change.severity === severity).length;
                return (
                  <button
                    key={severity}
                    type="button"
                    aria-pressed={active.has(severity)}
                    onClick={() => toggle(severity)}
                    className={`rounded-control border p-3 text-left transition-opacity ${TONE[severity]} ${active.has(severity) ? "" : "opacity-40"}`}
                  >
                    <span className="tnum block text-xl font-semibold">{count}</span>
                    <span className="mono text-xs">{LABEL[severity]}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-line pb-3">
              <label className="relative min-w-52 flex-1">
                <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <span className="sr-only">Filter changes</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter changes"
                  className="mono w-full rounded-control border border-line bg-canvas py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
                />
              </label>
              <span className="mono text-muted">
                {shown.length} of {loaded.changes.length} {plural(loaded.changes.length, "change")}
              </span>
            </div>

            {loaded.changes.length === 0 ? (
              <div className="empty mt-4">
                No architectural change between these branch heads.
              </div>
            ) : shown.length === 0 ? (
              <div className="empty mt-4">No changes match these filters.</div>
            ) : (
              <div className="mt-3 flex flex-col gap-1" data-nav-list>
                {shown.map((change, index) => (
                  <div
                    key={`${change.kind}:${change.where}:${change.summary}:${index}`}
                    className="row items-start gap-3 rounded-control px-3 py-2.5"
                  >
                    <span className={`mono mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] ${TONE[change.severity]}`}>
                      {LABEL[change.severity]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-ink">{change.summary}</div>
                      <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span>{change.where}</span>
                        <span>{change.kind}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mono mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
              <span>{base} · {short(loaded.baseSha)}</span>
              <span>{head} · {short(loaded.headSha)}</span>
              <span className="ml-auto">loaded from {repo?.provider === "gitlab" ? "GitLab" : "GitHub"} at runtime</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
