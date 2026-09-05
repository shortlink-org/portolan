import { validateCatalog } from "../catalog";
import type { Catalog } from "../catalog";
import { enrichCatalog } from "../enrich";
import { mergeCatalogs } from "../merge";
import type { CatalogSource, SourceCatalog } from "../merge";

const API_VERSION = "2026-03-10";
const PAGE_SIZE = 100;
const MAX_BRANCH_PAGES = 10;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_BYTES = 25 * 1024 * 1024;
const CATALOG_CACHE = "portolan-runtime-catalogs-v1";
const CATALOG_CACHE_LIMIT = 8;
const CACHED_AT = "x-portolan-cached-at";
let lastCacheOrder = 0;

export type GitHubRepo = { owner: string; repo: string };

export type GitHubBranch = {
  name: string;
  commit: string;
  protected: boolean;
};

type TreeItem = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
};

type TreeResponse = {
  tree: TreeItem[];
  truncated: boolean;
};

const branchCache = new Map<string, Promise<GitHubBranch[]>>();
const catalogCache = new Map<string, Promise<Catalog>>();

/** A github.com repository page, reduced to the two API path segments. */
export function githubRepoFromUrl(value: string): GitHubRepo | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, rawRepo] = parts;
    const repo = rawRepo?.replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function repoKey(repo: GitHubRepo): string {
  return `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
}

function apiUrl(repo: GitHubRepo, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${path}`;
}

function rawUrl(repo: GitHubRepo, sha: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${sha}/${encoded}`;
}

function cacheKey(repo: GitHubRepo, sha: string): string {
  return `https://portolan.invalid/catalog/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${sha}`;
}

function nextCacheOrder(): string {
  lastCacheOrder = Math.max(Date.now() * 1000, lastCacheOrder + 1);
  return String(lastCacheOrder);
}

async function cachedCatalog(repo: GitHubRepo, sha: string): Promise<Catalog | null> {
  if (typeof caches === "undefined") return null;
  try {
    const store = await caches.open(CATALOG_CACHE);
    const response = await store.match(cacheKey(repo, sha));
    if (!response) return null;
    try {
      const catalog = validateCatalog(await response.json() as Catalog);
      // A hit becomes the newest entry, so pruning below is genuinely LRU
      // rather than just removing the oldest commit we happened to fetch.
      await rememberCatalog(repo, sha, catalog);
      return catalog;
    } catch {
      await store.delete(cacheKey(repo, sha));
      return null;
    }
  } catch {
    // Private browsing and quota policies may disable Cache Storage. Runtime
    // comparison still works; it just has to ask GitHub again next time.
    return null;
  }
}

async function rememberCatalog(repo: GitHubRepo, sha: string, catalog: Catalog): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const store = await caches.open(CATALOG_CACHE);
    await store.put(
      cacheKey(repo, sha),
      new Response(JSON.stringify(catalog), {
        headers: {
          "content-type": "application/json",
          [CACHED_AT]: nextCacheOrder(),
        },
      }),
    );

    const keys = await store.keys();
    if (keys.length <= CATALOG_CACHE_LIMIT) return;
    const dated = await Promise.all(keys.map(async (request) => ({
      request,
      at: Number((await store.match(request))?.headers.get(CACHED_AT)) || 0,
    })));
    dated.sort((a, b) => b.at - a.at);
    await Promise.all(dated.slice(CATALOG_CACHE_LIMIT).map(({ request }) => store.delete(request)));
  } catch {
    // A full or unavailable cache must never turn a successful diff into an
    // error. The in-memory cache still covers the current page load.
  }
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  if (!response.ok) throw githubError(response);
  return response.json() as Promise<T>;
}

function githubError(response: Response): Error {
  if (response.status === 404) {
    return new Error("GitHub repository or branch was not found. Private repositories need an authenticated integration.");
  }
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) && reset > 0
      ? ` until ${new Date(reset * 1000).toLocaleTimeString()}`
      : "";
    return new Error(`GitHub API rate limit reached${when}.`);
  }
  return new Error(`GitHub API request failed (${response.status}).`);
}

async function fetchText(url: string, label: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`${label} does not exist at this commit.`);
    }
    throw new Error(`Could not read ${label} (${response.status}).`);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_SOURCE_BYTES) {
    throw new Error(`${label} is larger than 5 MB.`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`${label} is larger than 5 MB.`);
  }
  return text;
}

/** Branch heads as they exist on GitHub now, not when the site was built. */
export function listGitHubBranches(repo: GitHubRepo): Promise<GitHubBranch[]> {
  const key = repoKey(repo);
  const cached = branchCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const branches: GitHubBranch[] = [];
    for (let page = 1; page <= MAX_BRANCH_PAGES; page++) {
      const found = await githubJson<Array<{
        name: string;
        commit: { sha: string };
        protected: boolean;
      }>>(apiUrl(repo, `/branches?per_page=${PAGE_SIZE}&page=${page}`));
      branches.push(...found.map((branch) => ({
        name: branch.name,
        commit: branch.commit.sha,
        protected: branch.protected,
      })));
      if (found.length < PAGE_SIZE) break;
    }
    return branches;
  })();

  branchCache.set(key, pending);
  pending.catch(() => branchCache.delete(key));
  return pending;
}

/** A manifest glob as an anchored regular expression. */
export function catalogGlob(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] ?? "";
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    out += /[a-zA-Z0-9/_-]/.test(char) ? char : `\\${char}`;
  }
  return new RegExp(`^${out}$`);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function inBatches<T, R>(
  values: T[],
  size: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < values.length; i += size) {
    results.push(...await Promise.all(values.slice(i, i + size).map(task)));
  }
  return results;
}

/**
 * The merged catalog at an immutable commit. Nothing is written to storage;
 * this cache only prevents duplicate network work in the current page load.
 */
export function loadGitHubCatalog(repo: GitHubRepo, sha: string): Promise<Catalog> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    return Promise.reject(new Error("GitHub returned an invalid commit SHA."));
  }
  const key = `${repoKey(repo)}@${sha}`;
  const cached = catalogCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const remembered = await cachedCatalog(repo, sha);
    if (remembered) return remembered;

    const manifestText = await fetchText(rawUrl(repo, sha, "portolan.json"), "portolan.json");
    const manifest = parseJson(manifestText, "portolan.json") as { sources?: unknown };
    if (!Array.isArray(manifest.sources) || !manifest.sources.every((source) => typeof source === "string")) {
      throw new Error("portolan.json has no valid sources list.");
    }
    const patterns = (manifest.sources as string[]).map(catalogGlob);
    const tree = await githubJson<TreeResponse>(apiUrl(repo, `/git/trees/${sha}?recursive=1`));
    if (tree.truncated) {
      throw new Error("The GitHub tree is too large to load safely; its recursive response was truncated.");
    }
    const files = tree.tree
      .filter((item) => item.type === "blob" && patterns.some((pattern) => pattern.test(item.path)))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (files.length === 0) {
      throw new Error("This branch has no catalog sources matching portolan.json.");
    }
    const declaredBytes = files.reduce((total, file) => total + (file.size ?? 0), 0);
    if (declaredBytes > MAX_CATALOG_BYTES) {
      throw new Error("The catalog is larger than the 25 MB runtime limit.");
    }

    const sources = await inBatches(files, 8, async (file): Promise<CatalogSource> => {
      const text = await fetchText(rawUrl(repo, sha, file.path), file.path);
      return { path: file.path, catalog: parseJson(text, file.path) as SourceCatalog };
    });
    const merged = mergeCatalogs(sources);
    const enriched = enrichCatalog(merged.catalog);
    const catalog = validateCatalog(enriched.catalog);
    await rememberCatalog(repo, sha, catalog);
    return catalog;
  })();

  catalogCache.set(key, pending);
  pending.catch(() => catalogCache.delete(key));
  return pending;
}

/** Test-only: runtime caches must never leak between isolated cases. */
export function clearGitHubCatalogCache(): void {
  branchCache.clear();
  catalogCache.clear();
}
