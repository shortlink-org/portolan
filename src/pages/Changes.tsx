import { useDocumentTitle } from "../app/title";
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  GitCompare,
  RefreshCw,
  Search,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { catalog, index } from "../data";
import type { ChangeSpec } from "../catalog";
import { pathForId } from "../app/canonical";
import { branchCompareHref } from "../lib/branch-compare";
import { buildInfo } from "../lib/build-info";
import { SEVERITIES } from "../lib/catalog-diff";
import type { Severity } from "../lib/catalog-diff";
import { rememberComparison, rememberedComparison } from "../lib/comparison-memory";
import { forgeRepoFromUrl } from "../lib/github-catalog";
import type { ForgeRepo } from "../lib/github-catalog";
import { plural } from "../lib/format";
import { comparisonQuery, comparisonSide, forgeKeys, forgeRefsQuery } from "../lib/queries";
import { useForgeAccess } from "../app/forge-access";
import { CatEmptyState } from "../components/CatIllustration";
import { CommitLink } from "../components/CommitLink";
import { ActivityFeed } from "../components/ActivityFeed";
import { projectSpecActivity } from "../lib/spec-activity";
import type { Change } from "../lib/catalog-diff";
import { paths, specRequirementAnchor, specScenarioAnchor, specTaskAnchor } from "../routes";

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

function forgeName(repo: ForgeRepo): string {
  return repo.provider === "gitlab" ? "GitLab" : "GitHub";
}

function specForChange(change: Change, specs: readonly ChangeSpec[]): ChangeSpec | undefined {
  if (change.kind.startsWith("spec.")) return specs.find((spec) => spec.id === change.where);
  if (change.kind.startsWith("task.")) {
    const specId = change.where.split("#task:")[0]!;
    return specs.find((spec) => spec.id === specId);
  }
  if (change.kind.startsWith("requirement.") || change.kind.startsWith("scenario.")) {
    const requirementId = change.where.split("#scenario:")[0]!;
    return specs.find((spec) => spec.requirements.some((requirement) => requirement.id === requirementId));
  }
  return undefined;
}

function activityHref(change: Change, before: readonly ChangeSpec[], after: readonly ChangeSpec[]): string | undefined {
  const spec = specForChange(change, after) ?? specForChange(change, before);
  if (!spec) return pathForId(index, change.where);
  const root = paths.spec(spec.slug);
  if (change.kind.startsWith("task.")) {
    const task = change.where.split("#task:")[1];
    return task ? `${root}#${specTaskAnchor(task)}` : root;
  }
  if (change.kind.startsWith("requirement.") || change.kind.startsWith("scenario.")) {
    const [requirement, scenario] = change.where.split("#scenario:");
    return change.kind.startsWith("scenario.") && scenario
      ? `${root}#${specScenarioAnchor(requirement!, scenario)}`
      : `${root}#${specRequirementAnchor(requirement!)}`;
  }
  return root;
}

function RepositoryAccess({ repo, reveal }: { repo: ForgeRepo; reveal: boolean }) {
  const access = useForgeAccess();
  const [draft, setDraft] = useState("");
  const provider = repo.provider === "gitlab" ? "GitLab" : "GitHub";
  const connected = access.connectedTo(repo);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    access.connect(repo, draft);
    setDraft("");
  };

  return (
    <details
      className="mt-4 rounded-control border border-line bg-surface px-3 py-2"
      open={reveal && !connected ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink">
        Repository access
        <span className={`chip ml-auto ${connected ? "status-verified" : "text-muted"}`}>
          {connected ? "token in memory" : "public access"}
        </span>
      </summary>
      <div className="mt-3 border-t border-line pt-3">
        <p className="max-w-prose text-sm text-muted">
          {connected
            ? `${provider} requests from this tab are authenticated. The token is never persisted or included in a URL.`
            : `For a private ${provider} repository, provide a read-only access token. It is kept only in this tab's memory and private catalogs are not written to Cache Storage.`}
        </p>
        {connected ? (
          <button
            type="button"
            onClick={() => access.disconnect(repo)}
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
  useDocumentTitle("Changes");
  const [params, setParams] = useSearchParams();
  const current = buildInfo.branch || "main";
  const base = params.get("base") || current;
  const head = params.get("head") || "";
  const repo = forgeRepoFromUrl(buildInfo.repoUrl, buildInfo.forge);
  const access = useForgeAccess();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [active, setActive] = useState<Set<Severity>>(() => new Set(SEVERITIES));
  const token = repo ? access.tokenFor(repo) : "";

  useEffect(() => {
    if (head) {
      rememberComparison(base, head);
      return;
    }
    const previous = rememberedComparison();
    if (previous) setParams(previous, { replace: true });
  }, [base, head, setParams]);

  // Refs first, shared with the header's picker; then the two catalogs and
  // their diff, keyed by the commits the names resolved to. A name that no
  // longer exists is not a request that failed but a side that did not
  // resolve, so it is reported here and the second query never starts.
  const refsQuery = useQuery({ ...forgeRefsQuery(repo, token), enabled: repo !== null && Boolean(head) });
  const refs = refsQuery.data;
  const bundled = { name: current, sha: buildInfo.commit, catalog };
  const baseSide = refs && head ? comparisonSide(base, refs, bundled) : null;
  const headSide = refs && head ? comparisonSide(head, refs, bundled) : null;
  const missing = refs && head ? (!baseSide ? base : !headSide ? head : "") : "";
  const comparison = useQuery(comparisonQuery(repo, token, baseSide, headSide));
  const loaded = comparison.data ?? null;
  const loading = refsQuery.isLoading || comparison.isLoading;
  const error = !head
    ? ""
    : !repo
      ? "Runtime comparison needs a GitHub or GitLab repository URL in the build metadata."
      : refsQuery.error
        ? refsQuery.error.message
        : missing
          ? `Branch or tag “${missing}” no longer exists on ${forgeName(repo)}.`
          : comparison.error?.message ?? "";

  const shown = useMemo(() => {
    if (!loaded) return [];
    const events = projectSpecActivity({
      changes: loaded.changes,
      hrefForSpecSubject: (change) => activityHref(change, loaded.beforeSpecs, loaded.afterSpecs),
    });
    return events.filter((event) => {
      if (!event.severity || !active.has(event.severity)) return false;
      if (!deferredQuery) return true;
      return `${event.source?.label ?? ""} ${event.kind} ${event.summary}`.toLowerCase().includes(deferredQuery);
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

  // Forget every forge answer and ask again. Cache Storage is left alone:
  // it holds catalogs by commit, and a commit does not change.
  const reload = () => {
    void queryClient.resetQueries({ queryKey: forgeKeys.all });
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
              <CatEmptyState scene="unchanged" title="No architectural changes" className="mt-4 max-w-prose">
                These branch heads describe the same catalog.
              </CatEmptyState>
            ) : shown.length === 0 ? (
              <div className="empty mt-4">No changes match these filters.</div>
            ) : (
              <ActivityFeed events={shown} title="Activity" className="mt-3" />
            )}

            <div className="mono mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
              <span>{base} · <CommitLink commit={loaded.baseSha} repo={repo} /></span>
              <span>{head} · <CommitLink commit={loaded.headSha} repo={repo} /></span>
              <span className="ml-auto">loaded from {repo?.provider === "gitlab" ? "GitLab" : "GitHub"} at runtime</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
