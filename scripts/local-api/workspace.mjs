// The workspace as the local API sees it: paths kept inside it, its
// fingerprint, the snapshot a trial runs in, and the diff of what a run wrote.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const SNAPSHOT_SKIP = new Set([".git", ".portolan", "dist", "node_modules", "target"]);

export function lstatExists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

export function safeWorkspacePath(workspace, value, what) {
  const clean = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (clean.includes("\0") || clean.startsWith("/") || clean.split("/").includes("..")) {
    throw new Error(`${what} must stay inside this repository.`);
  }
  const root = realpathSync(workspace);
  const target = resolve(root, clean);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`${what} resolves outside this repository.`);
  let existing = target;
  while (!lstatExists(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const existingReal = realpathSync(existing);
  if (existingReal !== root && !existingReal.startsWith(`${root}${sep}`)) throw new Error(`${what} resolves outside this repository.`);
  return { relative: relative(root, target).replaceAll(sep, "/") || ".", absolute: target };
}

// The tree with nothing in it, which every repository has. Before the first
// commit there is no HEAD to diff against, and the index diffed against this
// tree is exactly what has been staged.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function workspaceFingerprint(workspace) {
  const hash = createHash("sha256");
  try {
    // Git speaks to nobody here: a workspace that is not a checkout, or one
    // without a commit yet, is a case this function handles, not an error to
    // print from the dev server.
    const options = { cwd: workspace, encoding: "buffer", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] };
    let base = EMPTY_TREE;
    try { base = execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], options).toString().trim() || EMPTY_TREE; } catch {}
    hash.update(execFileSync("git", ["diff", "--binary", base, "--", "."], options));
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options)
      .toString().split("\0").filter(Boolean).sort();
    for (const name of untracked) {
      hash.update(name); hash.update("\0");
      try { hash.update(readFileSync(join(workspace, name))); } catch {}
    }
  } catch {
    const pending = [workspace];
    const files = [];
    while (pending.length) {
      const dir = pending.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SNAPSHOT_SKIP.has(entry.name) || entry.name === "build" && relative(workspace, dir).startsWith("plugins")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    for (const path of files.sort()) { hash.update(relative(workspace, path)); hash.update("\0"); hash.update(readFileSync(path)); }
  }
  return hash.digest("hex");
}

export function snapshotWorkspace(workspace) {
  const holder = mkdtempSync(join(tmpdir(), "portolan-preview-"));
  const snapshot = join(holder, "workspace");
  cpSync(workspace, snapshot, {
    recursive: true,
    filter(source) {
      const name = relative(workspace, source).replaceAll(sep, "/");
      if (!name) return true;
      return !name.split("/").some((segment) => SNAPSHOT_SKIP.has(segment) || segment === "build" && name.startsWith("plugins/"));
    },
  });
  symlinkSync(join(workspace, "node_modules"), join(snapshot, "node_modules"), "dir");
  const gitMetadata = join(workspace, ".git");
  if (lstatExists(gitMetadata)) symlinkSync(gitMetadata, join(snapshot, ".git"), lstatSync(gitMetadata).isDirectory() ? "dir" : "file");
  return { holder, snapshot };
}

function fileDiff(workspace, snapshot, change) {
  const before = join(workspace, change.path);
  const after = join(snapshot, change.path);
  const left = lstatExists(before) ? before : "/dev/null";
  const right = lstatExists(after) ? after : "/dev/null";
  if ((lstatExists(before) && statSync(before).size > 512_000) || (lstatExists(after) && statSync(after).size > 512_000)) {
    return { path: change.path, status: change.kind, diff: "Binary or large file changed; textual diff omitted." };
  }
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", left, right], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  } catch (cause) {
    if (cause?.status !== 1) throw cause;
    diff = String(cause.stdout ?? "");
  }
  const portable = diff
    .replaceAll(`a${before}`, `a/${change.path}`)
    .replaceAll(`b${after}`, `b/${change.path}`)
    .replaceAll(before, change.path)
    .replaceAll(after, change.path);
  return { path: change.path, status: change.kind, diff: portable.slice(0, 200_000) };
}

export function diffGeneratedFiles(workspace, snapshot, events) {
  const changes = new Map();
  for (const event of events) {
    if (event.type !== "step-finished") continue;
    for (const change of event.changes ?? []) changes.set(change.path, change);
  }
  const all = [...changes.values()];
  let remaining = 2 * 1024 * 1024;
  let contentTruncated = false;
  const shown = all.slice(0, 100).map((change) => {
    const file = fileDiff(workspace, snapshot, change);
    if (file.diff.length > remaining) { file.diff = `${file.diff.slice(0, Math.max(0, remaining))}\n… diff truncated`; contentTruncated = true; }
    remaining = Math.max(0, remaining - file.diff.length);
    return file;
  });
  return { files: shown, totalFiles: all.length, truncated: all.length > shown.length || contentTruncated };
}
