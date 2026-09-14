export function gitSourcePath(value) {
  if (typeof value !== "string" || !value || value.length > 240 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) || value.split("/").some((part) => [".", "..", ".git"].includes(part))) throw new Error("Use a relative directory without traversal, wildcards or .git.");
  return value;
}

export function normalizeGitRepos(value) {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error("Add 1–30 repositories.");
  const directories = new Set();
  return value.map((item) => {
    const repo = typeof item?.repo === "string" ? item.repo.trim() : "";
    if (!repo || repo.length > 500 || /[\s\\%]/.test(repo) || /\/\.{1,2}(?:\/|$)/.test(repo)) throw new Error("Enter an HTTPS or SSH repository address without credentials or encoded paths.");
    let url;
    try { url = new URL(repo.startsWith("git@") ? repo.replace(/^git@([^:]+):/, "ssh://git@$1/") : repo.includes("://") ? repo : `https://${repo}`); }
    catch { throw new Error("Enter a valid repository address."); }
    if (!["https:", "http:", "ssh:"].includes(url.protocol) || !url.hostname || url.password || url.search || url.hash || (url.username && !(url.protocol === "ssh:" && url.username === "git"))) throw new Error("Use HTTP(S) or SSH without tokens, passwords, query strings or fragments. SSH user git is allowed.");
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    gitSourcePath(path);
    const parts = path.split("/");
    if (parts.length < 2) throw new Error("Include the owner/group and repository name.");
    const directory = parts.slice(-2).join("/");
    if (directories.has(directory.toLowerCase())) throw new Error("Repositories resolve to the same owner/name output directory. Put them in separate fetch steps.");
    directories.add(directory.toLowerCase());
    const commit = typeof item.commit === "string" ? item.commit.trim() : "";
    if (item.commit !== undefined && !commit) throw new Error("Enter the pinned commit SHA.");
    if (item.ref !== undefined && typeof item.ref !== "string") throw new Error("Branch or tag must be text.");
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    if (commit && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Use a full 40-character commit SHA.");
    if (ref && (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(ref) || ref.includes("..") || ref.includes("//") || ref.endsWith("/") || ref.endsWith(".") || ref.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock")))) throw new Error("Enter a valid branch or tag, for example main or refs/heads/main.");
    if (commit && ref) throw new Error("Choose either a pinned commit or a branch/tag, not both.");
    return { repo, ...(commit ? { commit } : ref ? { ref } : {}) };
  });
}

/** Matches fetch-git's current owner/name output convention, including nested groups. */
export function gitRepoDirectory(repo) {
  const value = repo.replace(/\.git\/?$/, "").replace(/\/$/, "");
  return value.split(/[/:]/).slice(-2).join("/");
}

/** Transport alternatives are suggestions, not claims about server access. */
export function gitRepositoryAddress(value) {
  const repo = normalizeGitRepos([{ repo: value }])[0].repo;
  const url = new URL(repo.startsWith("git@") ? repo.replace(/^git@([^:]+):/, "ssh://git@$1/") : repo.includes("://") ? repo : `https://${repo}`);
  if (!["https:", "ssh:"].includes(url.protocol)) throw new Error("Discovery and access checks support HTTPS or SSH URLs.");
  const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  const identity = `${url.host}/${path}`;
  const transport = url.protocol === "ssh:" ? "ssh" : "https";
  const urls = url.port
    ? { [transport]: repo.includes("://") ? repo : url.href }
    : { https: `https://${url.hostname}/${path}.git`, ssh: `git@${url.hostname}:${path}.git` };
  if (url.protocol === "ssh:") urls.ssh = repo;
  else if (url.protocol === "https:") urls.https = repo.includes("://") ? repo : `https://${repo}`;
  return { identity, transport, urls };
}

export function mergeGitRepositories(candidates) {
  const rows = new Map();
  for (const candidate of candidates) {
    try {
      const address = gitRepositoryAddress(candidate.repo);
      const current = rows.get(address.identity);
      if (current) {
        if (!current.sources.includes(candidate.source)) current.sources.push(candidate.source);
        // Preserve observed URLs (including SSH aliases), not a synthesized alternative.
        current.urls[address.transport] = address.urls[address.transport];
      } else rows.set(address.identity, { ...address, sources: [candidate.source] });
    } catch { /* Local paths, credential-bearing and unsupported URLs are never exposed. */ }
  }
  return [...rows.values()].sort((a, b) => a.identity.localeCompare(b.identity));
}
