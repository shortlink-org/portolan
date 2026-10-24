// Git history projected beside specification artifacts. The extracted
// `specs[]` stay author-owned content; this derived model can be rebuilt from
// the checkout whenever the site is built.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  forgetHistory,
  historyFor,
  repositoryIsShallow,
  repositoryOf,
  repositoryRemote,
  stampsFor,
} from "./history.mjs";
import { repositoryInput } from "./host-plugins/fetch-git.mjs";
import { readManifest } from "./manifest.mjs";

export const SPEC_HISTORY_MODULE = "virtual:portolan-spec-history";
const RESOLVED = `\0${SPEC_HISTORY_MODULE}`;

/** Remove the optional line suffix used by requirement and task sources. */
function sourcePath(source) {
  return String(source).replace(/:\d+$/, "");
}

/**
 * @param {string} workspace
 * @param {string[]} sources paths relative to the workspace
 * @returns {Array<object>}
 */
export function specHistory(workspace, sources) {
  const paths = [...new Set(sources.map(sourcePath))].sort();
  const workspaceRoot = resolve(workspace);
  if (!repositoryOf(workspaceRoot)) {
    return paths.map((source) => ({
      source,
      status: "unavailable",
      reason: "not-a-git-repository",
    }));
  }
  const stamps = stampsFor(workspace, paths);
  const repository = repositoryRemote(workspaceRoot);
  if (repositoryIsShallow(workspaceRoot)) {
    return paths.map((source) => ({
      source,
      status: "unavailable",
      reason: "shallow-history",
      uncommitted: stamps.get(source)?.commit === "uncommitted",
      ...(repository ? { repository } : {}),
    }));
  }
  const history = historyFor(workspace, ".") ?? {};

  return paths.map((source) => {
    const entry = history[source];
    if (!entry) {
      return {
        source,
        status: "unavailable",
      reason: "uncommitted-only",
      uncommitted: stamps.get(source)?.commit === "uncommitted",
      ...(repository ? { repository } : {}),
    };
    }
    return {
      source,
      status: "available",
      first: entry.created,
      latest: entry.revised ?? entry.created,
      uncommitted: stamps.get(source)?.commit === "uncommitted",
      ...(repository ? { repository } : {}),
    };
  });
}

function sourcesOf(spec) {
  const sources = [
    spec.source,
    ...(spec.artifacts ?? []).map((artifact) => artifact.path),
    ...(spec.requirements ?? []).map((requirement) => requirement.source),
    ...(spec.tasks ?? []).map((task) => task.source),
  ];
  return sources.filter(Boolean);
}

/** Build-time history keyed by the stable specification id. */
function historiesForWorkspace(workspace) {
  const manifest = readManifest(join(workspace, "portolan.json"));
  const result = {};
  for (const step of manifest.extract ?? []) {
    if (step.plugin !== "sdd") continue;
    const fragment = join(workspace, step.out, step.options?.out ?? "sdd.json");
    if (!existsSync(fragment)) continue;
    let catalog;
    try {
      catalog = JSON.parse(readFileSync(fragment, "utf8"));
    } catch {
      continue;
    }
    const repository = repositoryInput(workspace, step.in).repository;
    const historyRoot = repository ? resolve(workspace, repository) : workspace;
    for (const spec of catalog.specs ?? []) {
      result[spec.id] = specHistory(historyRoot, sourcesOf(spec));
    }
  }
  return result;
}

/** Serve derived Git history without adding it to generated fragments. */
export function specHistoryPlugin(workspace) {
  return {
    name: "portolan-spec-history",
    resolveId(id) {
      return id === SPEC_HISTORY_MODULE ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      return `export default ${JSON.stringify(historiesForWorkspace(workspace))};\n`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".md") && !file.endsWith(".json")) return;
      forgetHistory();
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}
