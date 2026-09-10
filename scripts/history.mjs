// When each file was first committed and last changed, read by the host for a
// plugin that asks (portolan.0007), and for the provenance of every catalog
// source (portolan.0010).
//
// One `git log` over the whole checkout, walked oldest first with renames
// followed, gives every path its first commit and its last. A plugin used to
// ask git this per file with `--follow`; a wasm module cannot run git, and
// the answer is a fact about the checkout the host already holds, so the host
// reads it once and hands each step the part under its root.

import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const RECORD = "\x1e";
const FIELD = "\x1f";

/** Per repository, per process: the history does not change during a run. */
const cache = new Map();

/** Repositories already told they are shallow; it is said once. */
const warnedShallow = new Set();

/**
 * When each of `paths` last changed, as the history says: the commit that
 * last touched the file, and that commit's date.
 *
 * This is where a source's provenance comes from (portolan.0010). It is read
 * off the checkout that holds the file and never written into the file, so a
 * fragment is content and nothing else, and a regeneration that changes no
 * fact changes no byte. The stamp names the commit the change landed in,
 * which a stamp written into the file never could: that one was the parent
 * at best, and it took a second commit to catch up.
 *
 * A file with uncommitted changes, or one git does not track, is
 * `uncommitted` and dated by its mtime - an observation of the working tree,
 * shown and never committed. A path outside any repository is the same. A
 * shallow clone makes every path look as though it changed in the one commit
 * that was fetched; that is said once, and the stamps are what the truncated
 * history says, which is at least the checkout.
 *
 * @param {string} workspace
 * @param {string[]} paths  relative to `workspace`, forward slashes
 * @returns {Map<string, {commit: string, generatedAt: string}>}
 */
export function stampsFor(workspace, paths) {
  const workspaceReal = realpathSync(resolve(workspace));
  const stamps = new Map();
  const repoOfDir = new Map();
  const byRepo = new Map();

  for (const path of paths) {
    const absolute = resolve(workspaceReal, path);
    const dir = dirname(absolute);
    if (!repoOfDir.has(dir)) repoOfDir.set(dir, repositoryOf(dir));
    const repo = repoOfDir.get(dir);
    if (!repo) {
      stamps.set(path, uncommitted(absolute));
      continue;
    }
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push({ path, absolute, key: toPosix(relative(repo, absolute)) });
  }

  for (const [repo, files] of byRepo) {
    warnIfShallow(repo);
    const history = fileHistory(repo);
    const dirty = dirtyIn(repo);
    for (const file of files) {
      const entry = history.get(file.key);
      const last = entry?.revised ?? entry?.created;
      stamps.set(
        file.path,
        !last || dirty.has(file.key)
          ? uncommitted(file.absolute)
          : { commit: last.commit.slice(0, 7), generatedAt: last.date },
      );
    }
  }

  return stamps;
}

/**
 * The commit that last touched any of `paths`, and its date, or null when
 * none of them has been committed. For a step's output this is when it was
 * last generated: the history remembers it, so nothing has to write it down
 * anywhere else (portolan.0010).
 *
 * @param {string} workspace
 * @param {string[]} paths  relative to `workspace`
 * @returns {{commit: string, date: string} | null}
 */
export function lastCommitTouching(workspace, paths) {
  const { repo, keys } = inRepo(workspace, paths);
  if (!repo || keys.length === 0) return null;
  const answer = git(repo, ["log", "-1", "--format=%H %cI", "--", ...keys]);
  if (!answer) return null;
  const [sha, date] = answer.split(" ");
  // Seven characters, the width every stamp has, so the two read alike.
  return sha && date ? { commit: sha.slice(0, 7), date } : null;
}

/**
 * Which files under `paths` differ from what `commit` held, working tree
 * included: modified, added, deleted and untracked, less anything under
 * `excludes`. Paths in and out are relative to `workspace`.
 *
 * @param {string} workspace
 * @param {string} commit
 * @param {string[]} paths
 * @param {string[]} [excludes]
 * @returns {string[]}
 */
export function changedSince(workspace, commit, paths, excludes = []) {
  const { repo, keys, toWorkspace } = inRepo(workspace, paths);
  if (!repo || keys.length === 0) return [];
  const spec = [...keys, ...inRepo(workspace, excludes).keys.map((key) => `:(exclude)${key}`)];
  const tracked = git(repo, ["diff", "--name-only", commit, "--", ...spec]);
  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard", "--", ...spec]);
  const changed = new Set();
  for (const line of `${tracked}\n${untracked}`.split("\n")) {
    if (line) changed.add(toWorkspace(line));
  }
  return [...changed].sort();
}

/**
 * The text of `path` as `commit` held it, or "" when the commit did not hold
 * it or there is no history to ask.
 *
 * @param {string} workspace
 * @param {string} commit
 * @param {string} path  relative to `workspace`
 * @returns {string}
 */
export function fileAt(workspace, commit, path) {
  const { repo, keys } = inRepo(workspace, [path]);
  if (!repo || keys.length === 0) return "";
  return git(repo, ["show", `${commit}:${keys[0]}`]);
}

/** The paths as the workspace's repository spells them, and the way back. */
function inRepo(workspace, paths) {
  const workspaceReal = realpathSync(resolve(workspace));
  const repo = repositoryOf(workspaceReal);
  if (!repo) return { repo: "", keys: [], toWorkspace: (line) => line };
  const keys = [];
  for (const path of paths) {
    const key = toPosix(relative(repo, resolve(workspaceReal, path)));
    if (key.startsWith("..")) continue;
    keys.push(key || ".");
  }
  return {
    repo,
    keys,
    toWorkspace: (line) => toPosix(relative(workspaceReal, resolve(repo, line))),
  };
}

function uncommitted(absolute) {
  let generatedAt = "";
  try {
    generatedAt = statSync(absolute).mtime.toISOString();
  } catch {
    // Gone, or never there: undated rather than dated by a guess.
  }
  return { commit: "uncommitted", generatedAt };
}

/** Every path with a change the history does not hold yet, relative to the repository. */
function dirtyIn(repo) {
  const dirty = new Set();
  // Read raw: an entry begins with two status letters, and a space is one of
  // them, which the trimming reader would eat off the first line.
  let status = "";
  try {
    status = execFileSync("git", ["-C", repo, "status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return dirty;
  }
  for (const entry of status.split("\0")) {
    if (entry.length > 3) dirty.add(entry.slice(3));
  }
  return dirty;
}

function warnIfShallow(repo) {
  if (warnedShallow.has(repo)) return;
  warnedShallow.add(repo);
  if (git(repo, ["rev-parse", "--is-shallow-repository"]) !== "true") return;
  console.warn(
    `${repo} is a shallow clone, where every source looks as though it last changed in ` +
      "the one commit that was fetched. Fetch the full history (git fetch --unshallow, " +
      "or actions/checkout with fetch-depth: 0) for the provenance to say anything.",
  );
}

/**
 * History for every file under `root`, keyed by the path a plugin would name
 * it - relative to `workspace`, forward slashes. `undefined` when the root is
 * not inside a git checkout, which is different from an empty object: a
 * checkout with nothing committed under the root.
 *
 * @param {string} workspace
 * @param {string} root
 * @returns {Record<string, {created: Commit, revised?: Commit}> | undefined}
 */
export function historyFor(workspace, root) {
  // Resolved through symlinks, as git reports its top level: on macOS a
  // temporary directory is one and the two would never compare equal.
  const workspaceReal = realpathSync(resolve(workspace));
  const absoluteRoot = resolve(workspaceReal, root);
  const repo = repositoryOf(absoluteRoot);
  if (!repo) return undefined;

  const rootKey = toPosix(relative(workspaceReal, absoluteRoot));
  const under = (key) => rootKey === "" || rootKey === "." || key === rootKey || key.startsWith(`${rootKey}/`);
  const history = {};
  for (const [pathInRepo, entry] of fileHistory(repo)) {
    const key = toPosix(relative(workspaceReal, resolve(repo, pathInRepo)));
    if (!key || key.startsWith("..") || !under(key)) continue;
    history[key] = entry.revised ? { created: entry.created, revised: entry.revised } : { created: entry.created };
  }
  return history;
}

/**
 * Every path in the checkout with its first and last commit, renames
 * followed: a file moved keeps the commit that first added it under its old
 * name, and the move counts as a revision. Paths are relative to the
 * repository, forward slashes.
 *
 * @param {string} repo
 * @returns {Map<string, {created: Commit, revised: Commit | null}>}
 */
export function fileHistory(repo) {
  const key = resolve(repo);
  if (cache.has(key)) return cache.get(key);
  const log = git(key, [
    "log", "--reverse", "--name-status", "-M", "--no-color",
    `--format=${RECORD}%H${FIELD}%an${FIELD}%cI`,
  ]);
  const history = parseLog(log);
  cache.set(key, history);
  return history;
}

/** @param {string} log */
export function parseLog(log) {
  const history = new Map();
  for (const record of log.split(RECORD)) {
    if (!record.trim()) continue;
    const [header, ...lines] = record.split("\n");
    const [sha, author, date] = header.split(FIELD);
    if (!sha) continue;
    const commit = { commit: sha, author, date };
    for (const line of lines) {
      const match = /^([A-Z])\d*\t([^\t]+)(?:\t([^\t]+))?$/.exec(line);
      if (!match) continue;
      const [, status, first, second] = match;
      if (status === "D") {
        history.delete(first);
      } else if (status === "R" && second) {
        const moved = history.get(first) ?? { created: commit, revised: null };
        history.delete(first);
        history.set(second, { created: moved.created, revised: commit });
      } else {
        const target = status === "C" && second ? second : first;
        const known = history.get(target);
        if (known) history.set(target, { created: known.created, revised: commit });
        else history.set(target, { created: commit, revised: null });
      }
    }
  }
  return history;
}

/** Forget what was read, for a test that commits between two reads. */
export function forgetHistory() {
  cache.clear();
}

/** The working tree a directory belongs to, or "" when no repository holds it. */
export function repositoryOf(dir) {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

function git(dir, args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

function toPosix(path) {
  return path.split(sep).join("/");
}

/** @typedef {{commit: string, author: string, date: string}} Commit */
