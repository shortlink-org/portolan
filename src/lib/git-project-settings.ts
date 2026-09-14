import { gitRepositoryAddress, mergeGitRepositories } from "./git-fetch-config.mjs";
import type { GitFetchState, SaveGitFetch } from "./local-api";
import type { GitFetchRepo } from "./git-fetch-config.mjs";

/** The page owns one project; discovery elsewhere is only a source of suggestions. */
export function projectGitSettings(state: GitFetchState, catalog: string | null) {
  const belongs = (item: { catalogs: string[] }) => catalog === null ? !state.catalogs.length : item.catalogs.includes(catalog);
  const entries = state.entries.filter(belongs);
  const candidates = [...state.catalogRepositories, ...state.remotes];
  const configured = entries.flatMap((entry) => entry.repos.map((repo) => ({ repo: repo.repo, source: "Configured connection" })));
  const repositories = mergeGitRepositories([...candidates.filter(belongs), ...configured]);
  const identities = new Set(repositories.map((repo) => repo.identity));
  const available = mergeGitRepositories([...candidates, ...state.entries.flatMap((entry) => entry.repos.map((repo) => ({ repo: repo.repo, source: "Existing connection" })))]).filter((repo) => !identities.has(repo.identity));
  const connected = new Set(mergeGitRepositories(configured).map((repo) => repo.identity));
  return { entries, repositories, available, connected };
}

export function projectGitOutput(state: GitFetchState, catalog: string | null, url?: string) {
  const slug = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80);
  const base = `vendor/repos/${slug(catalog ?? "project")}-${url ? slug(gitRepositoryAddress(url).identity) : "git-sources"}`;
  let output = base;
  for (let suffix = 2; state.entries.some((entry) => entry.output && (entry.output === output || output.startsWith(`${entry.output}/`) || entry.output.startsWith(`${output}/`))); suffix++) output = `${base}-${suffix}`;
  return output;
}

export function updateGitDraftRepos(state: GitFetchState, draft: Omit<SaveGitFetch, "revision" | "generate">, repos: GitFetchRepo[]) {
  const existing = state.entries.find((entry) => entry.step === draft.step);
  const automatic = draft.step === null || existing?.catalogs.some((id) => id !== draft.catalog);
  let output = draft.output;
  if (automatic) {
    let url: string | undefined;
    try { if (repos[0]?.repo) { gitRepositoryAddress(repos[0].repo); url = repos[0].repo; } } catch { /* The address is still being typed; validation handles it. */ }
    output = projectGitOutput(state, draft.catalog, url);
  }
  return { ...draft, repos, output };
}
