// When each file was first committed and last changed, read by the host for a
// plugin that asks (portolan.0007).
//
// One `git log` over the whole checkout, walked oldest first with renames
// followed, gives every path its first commit and its last. A plugin used to
// ask git this per file with `--follow`; a wasm module cannot run git, and
// the answer is a fact about the checkout the host already holds, so the host
// reads it once and hands each step the part under its root.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const RECORD = "\x1e";
const FIELD = "\x1f";

/** Per repository, per process: the history does not change during a run. */
const cache = new Map();

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
