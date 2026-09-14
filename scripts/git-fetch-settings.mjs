import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, globSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, matchesGlob, resolve, sep } from "node:path";
import { readManifestText } from "./manifest.mjs";
import { gitRepoDirectory, gitSourcePath, normalizeGitRepos, gitRepositoryAddress } from "../src/lib/git-fetch-config.mjs";

function read(workspace) {
  const path = join(workspace, "portolan.json");
  const text = readFileSync(path, "utf8");
  return { path, manifest: readManifestText(text, path), revision: createHash("sha256").update(text).digest("hex") };
}
const pins = (output, repos) => repos.map((repo) => `${output}/${gitRepoDirectory(repo.repo)}/git.repo.json`);

export function gitFetchState(workspace) {
  const { manifest, revision } = read(workspace);
  const names = new Set((manifest.plugins ?? []).filter((plugin) => plugin.host === "fetch-git").map((plugin) => plugin.name));
  const entries = (manifest.extract ?? []).flatMap((entry, step) => {
    if (!names.has(entry.plugin)) return [];
    try {
      const output = gitSourcePath(entry.out);
      const repos = normalizeGitRepos(entry.options?.repos);
      const sources = pins(output, repos);
      return [{ step, plugin: entry.plugin, output, repos, catalogs: (manifest.catalogs ?? []).filter((catalog) => sources.some((source) => (catalog.sources ?? []).some((pattern) => matchesGlob(source, pattern)))).map((catalog) => catalog.id), ...(entry.options?.cache !== output ? { error: "Cache and output differ. Align them in portolan.json before using this editor." } : {}) }];
    } catch { return [{ step, plugin: entry.plugin, output: "", repos: [], catalogs: [], error: "This fetch step uses unsupported or unsafe options. Review portolan.json; no repository addresses are exposed here." }]; }
  });
  return { revision, workspaceKey: createHash("sha256").update(realpathSync(workspace)).digest("hex"), entries, remotes: gitRemotes(workspace, manifest), ...catalogRepositories(workspace, manifest), catalogs: (manifest.catalogs ?? []).map((catalog) => ({ id: catalog.id, title: catalog.title ?? catalog.id })) };
}

/** Discover addresses only, without generating catalogs or fetching any repository. */
function catalogRepositories(workspace, manifest) {
  const root = realpathSync(workspace);
  const fragments = new Map();
  const candidates = new Map();
  const warnings = new Set();
  const profiles = manifest.catalogs?.length ? manifest.catalogs : [{ id: null, title: "Project sources", sources: manifest.sources ?? [] }];
  for (const profile of profiles) {
    const patterns = (profile.sources ?? []).filter((pattern) => {
      const safe = !isAbsolute(pattern) && !pattern.replaceAll("\\", "/").split("/").includes("..");
      if (!safe) warnings.add("Repository discovery skipped sources outside this workspace.");
      return safe;
    });
    for (const path of globSync(patterns, { cwd: root })) {
      if (!fragments.has(path)) {
        try {
          const resolved = realpathSync(join(root, path));
          if (!resolved.startsWith(root + sep)) throw new Error("Outside workspace");
          const stat = statSync(resolved);
          if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error("Unsupported source");
          fragments.set(path, JSON.parse(readFileSync(resolved, "utf8")));
        } catch {
          fragments.set(path, null);
          warnings.add("Some catalog sources could not be read safely. The repository list may be incomplete.");
        }
      }
      const fragment = fragments.get(path);
      if (!fragment) continue;
      const contexts = Array.isArray(fragment.contexts) ? fragment.contexts : [];
      const repos = [
        ...(Array.isArray(fragment.repos) ? fragment.repos : []),
        ...contexts.filter((context) => !profile.contexts?.length || profile.contexts.includes(context.id)).flatMap((context) => Array.isArray(context.services) ? context.services : []),
      ];
      for (const entry of repos) {
        try {
          const address = gitRepositoryAddress(entry?.repo);
          candidates.set(`${profile.id ?? ""}\0${address.identity}`, { repo: entry.repo, source: `Catalog · ${profile.title ?? profile.id}`, catalogs: profile.id ? [profile.id] : [] });
        } catch { /* Ignore local paths, unsupported URLs and embedded credentials. */ }
      }
    }
  }
  return { catalogRepositories: [...candidates.values()], discoveryWarnings: [...warnings] };
}

function gitRemotes(workspace, manifest) {
  const root = realpathSync(workspace);
  const inputs = new Set([".", ...(manifest.projects ?? []).map((project) => project.root)]);
  const remotes = [];
  for (const input of inputs) {
    try {
      const path = realpathSync(resolve(root, input));
      if (path !== root && !path.startsWith(root + sep)) continue;
      const options = { encoding: "utf8", timeout: 2000, maxBuffer: 128 * 1024, stdio: ["ignore", "pipe", "pipe"] };
      const top = realpathSync(execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], options).trim());
      if (top !== path) continue; // A vendored subdirectory inherits its parent's remotes.
      const output = execFileSync("git", ["-C", path, "config", "--local", "--get-regexp", "^remote\\..*\\.url$"], options);
      for (const line of output.trim().split("\n")) {
        const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line);
        if (!match) continue;
        try {
          gitRepositoryAddress(match[2]);
          const projects = (manifest.projects ?? []).filter((project) => resolve(root, project.root) === path).map((project) => project.id);
          const catalogs = (manifest.catalogs ?? []).filter((catalog) => projects.some((id) => catalog.projects?.includes(id))).map((catalog) => catalog.id);
          remotes.push({ repo: match[2], source: `Git remote · ${input} · ${match[1]}`, catalogs });
        } catch { /* Do not disclose credentials or local filesystem remote paths. */ }
      }
    } catch { /* No checkout or no remote configured. */ }
  }
  return remotes;
}

const runGit = promisify(execFile);
let accessChecks = 0;
export async function checkGitAccess(value, { env = process.env, run = runGit } = {}) {
  const address = gitRepositoryAddress(value);
  const url = address.urls[address.transport];
  if (accessChecks >= 4) throw new Error("Other access checks are running. Try again shortly.");
  accessChecks++;
  try {
    await run("git", ["-c", "credential.interactive=false", "ls-remote", "--quiet", "--", url, "HEAD"], {
      encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10" },
    });
    return { status: "accessible", message: "Git read access confirmed. No files downloaded." };
  } catch (cause) {
    const detail = String(cause?.stderr ?? cause?.message ?? "").toLowerCase();
    const message = cause?.code === "ETIMEDOUT" || cause?.killed ? "Access check timed out. Check your network or VPN." : detail.includes("host key verification failed") ? "SSH host is not trusted yet. Verify its host key in your terminal and retry." : /permission denied|authentication|could not read username|403|401/.test(detail) ? "Git could not authenticate or read this repository. Check your SSH agent or credential helper." : "Repository unavailable. Check the address, permissions and network connection.";
    return { status: "unavailable", message };
  } finally { accessChecks--; }
}

function outputPath(workspace, output) {
  gitSourcePath(output);
  const root = realpathSync(workspace);
  let path = root;
  for (const part of output.split("/")) {
    path = join(path, part);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory() || !realpathSync(path).startsWith(root + sep))) throw new Error("Output must be a real directory inside the workspace, without symlinks.");
  }
  return path;
}

export function saveGitFetchSettings(workspace, request, writeManifest) {
  const { path, manifest, revision } = read(workspace);
  if (request?.revision !== revision) throw new Error("portolan.json changed. Reload settings before saving.");
  const state = gitFetchState(workspace);
  const existing = request.step === null ? null : state.entries.find((entry) => entry.step === request.step);
  if (request.step !== null && !existing) throw new Error("The Git fetch step no longer exists.");
  if (existing?.error) throw new Error(existing.error);
  if (state.catalogs.length ? !state.catalogs.some((catalog) => catalog.id === request.catalog) : request.catalog !== null) throw new Error("Open a known project before saving its repository settings.");
  if (existing && state.catalogs.length && !existing.catalogs.includes(request.catalog)) throw new Error("This connection does not belong to the current project.");
  const shared = existing && existing.catalogs.some((id) => id !== request.catalog);
  const repos = normalizeGitRepos(request.repos);
  const output = gitSourcePath(request.output);
  const fork = shared && output !== existing.output;
  if (shared && !fork && JSON.stringify(repos) !== JSON.stringify(existing.repos)) throw new Error("Choose a separate output for this project's independent connection.");
  if (existing && !shared && output !== existing.output) throw new Error("An existing output cannot be moved here; downstream extractors may reference it.");
  const destination = outputPath(workspace, output);
  for (const repo of repos) outputPath(workspace, `${output}/${gitRepoDirectory(repo.repo)}`);
  if (!existing || fork) {
    if (!output.startsWith("vendor/repos/")) throw new Error("New snapshots must live under vendor/repos/, in a dedicated directory.");
    if (existsSync(destination) && readdirSync(destination).length) throw new Error("Choose an empty output directory; existing files will not be adopted.");
    for (const step of [...manifest.extract ?? [], ...manifest.verify ?? [], ...manifest.generate ?? []]) {
      const other = resolve(realpathSync(workspace), step.out ?? ".");
      if (destination === other || destination.startsWith(other + sep) || other.startsWith(destination + sep)) throw new Error("Output overlaps another pipeline step. Choose a separate directory.");
    }
  }
  let plugin = existing?.plugin ?? (manifest.plugins ?? []).find((entry) => entry.host === "fetch-git")?.name;
  if (!plugin) {
    plugin = "git";
    if ((manifest.plugins ?? []).some((entry) => entry.name === plugin)) throw new Error("Plugin name git is already in use.");
    manifest.plugins = [...manifest.plugins ?? [], { name: plugin, host: "fetch-git" }];
  }
  const oldPins = existing ? pins(existing.output, existing.repos) : [];
  const sources = pins(output, repos);
  const addSources = (current) => [...new Set([...current.filter((source) => !oldPins.includes(source)), ...sources.filter((source) => !current.some((pattern) => !oldPins.includes(pattern) && matchesGlob(source, pattern)))])];
  manifest.sources = shared ? [...new Set([...manifest.sources ?? [], ...sources])] : addSources(manifest.sources ?? []);
  for (const catalog of manifest.catalogs ?? []) {
    const current = catalog.sources ?? [];
    if (catalog.id !== request.catalog) {
      if ((!shared || fork) && sources.some((source) => current.some((pattern) => matchesGlob(source, pattern)))) throw new Error(`Project ${catalog.id} includes this output through a wildcard. Choose an output outside that pattern or narrow its sources in portolan.json.`);
      continue;
    }
    if (fork && oldPins.some((source) => current.some((pattern) => !oldPins.includes(pattern) && matchesGlob(source, pattern)))) throw new Error("This project includes the shared snapshot through a wildcard. Narrow its sources in portolan.json before separating the connection.");
    catalog.sources = addSources(current);
  }
  const previous = existing ? manifest.extract[existing.step] : null;
  const step = { ...previous, plugin, in: previous?.in ?? ".", out: output, options: { ...previous?.options, repos, cache: output } };
  manifest.extract ??= [];
  if (existing && !fork) manifest.extract[existing.step] = step; else manifest.extract.push(step);
  if (read(workspace).revision !== revision) throw new Error("portolan.json changed during validation. Reload settings.");
  writeManifest(path, manifest);
  return gitFetchState(workspace);
}
