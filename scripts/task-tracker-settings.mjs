import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, matchesGlob, relative, resolve, sep } from "node:path";
import { readManifestText } from "./manifest.mjs";
import { normalizeTrackers, publicTaskTrackers, TRACKER_PROVIDERS, WORK_ITEMS_PLUGIN, workItemsPluginNames } from "../src/lib/task-tracker-config.mjs";

function read(workspace) {
  const path = join(workspace, "portolan.json");
  const text = readFileSync(path, "utf8");
  return { path, manifest: readManifestText(text, path), revision: createHash("sha256").update(text).digest("hex") };
}

function repository(workspace, input, label) {
  try {
    const root = realpathSync(workspace);
    const path = realpathSync(resolve(workspace, input));
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Repository must be inside this workspace.");
    const top = realpathSync(execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
    if (path !== top) throw new Error("Not a Git checkout root. Select the enclosing repository; vendored files do not carry their own history.");
    try { execFileSync("git", ["-C", path, "rev-parse", "--verify", "HEAD^{commit}"], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error("This checkout has no local commits to scan. Fetch its history or create an initial commit first."); }
    const shallow = execFileSync("git", ["-C", path, "rev-parse", "--is-shallow-repository"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() === "true";
    return { input: relative(root, path).split(sep).join("/") || ".", label, available: true, shallow };
  } catch (cause) {
    return { input, label, available: false, reason: cause instanceof Error && !cause.message.startsWith("Command failed") ? cause.message : "No local Git checkout found." };
  }
}

export function taskTrackerState(workspace) {
  const { manifest, revision } = read(workspace);
  const entries = publicTaskTrackers(manifest).map((entry) => {
    const source = `${entry.output}/${manifest.verify[entry.step].options?.out ?? "work-items.json"}`;
    return {
      ...entry,
      managed: entry.output.startsWith("portolan-work-items/"),
      catalogs: (manifest.catalogs ?? []).filter((catalog) => (catalog.sources ?? []).some((pattern) => matchesGlob(source, pattern))).map((catalog) => catalog.id),
    };
  });
  const candidates = new Map([[".", "Workspace repository"]]);
  for (const project of manifest.projects ?? []) candidates.set(project.root, project.name);
  for (const entry of entries) if (!candidates.has(entry.input)) candidates.set(entry.input, entry.input);
  return {
    revision, entries,
    repositories: [...candidates].map(([input, label]) => repository(workspace, input, label)),
    catalogs: (manifest.catalogs ?? []).map((catalog) => ({ id: catalog.id, title: catalog.title ?? catalog.id })),
  };
}

export function saveTaskTrackerSettings(workspace, request, writeManifest) {
  const { path, manifest, revision } = read(workspace);
  if (request?.revision !== revision) throw new Error("portolan.json has changed since these settings were read. Reload settings and try again.");
  const state = taskTrackerState(workspace);
  const existing = request.step === null ? null : state.entries.find((entry) => entry.step === request.step);
  if (request.step !== null && !existing) throw new Error("The work-items verifier no longer exists.");
  const selected = state.repositories.find((item) => item.input === request.input);
  if (!selected || !selected.available) throw new Error(selected?.reason ?? "Choose a known Git checkout.");
  if (existing && existing.input !== request.input) throw new Error("An existing verifier cannot be moved to another repository.");
  if (!existing && state.entries.some((entry) => entry.input === request.input)) throw new Error("Edit the existing tracker configuration for this repository.");
  const trackers = normalizeTrackers(request.trackers);
  const maxCommits = request.maxCommits;
  if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 10000) throw new Error("History limit must be between 1 and 10000 commits.");
  // Tracker IDs identify an instance across the entire catalog, not one repo.
  for (const tracker of trackers) for (const entry of state.entries.filter((entry) => entry.step !== existing?.step)) {
    if (entry.trackers.some((other) => other.id === tracker.id && (other.provider !== tracker.provider || other.baseUrl !== tracker.baseUrl || (other.urlTemplate ?? TRACKER_PROVIDERS[other.provider].urlTemplate) !== (tracker.urlTemplate ?? TRACKER_PROVIDERS[tracker.provider].urlTemplate)))) throw new Error(`Tracker ${tracker.id} already names another provider or address in ${entry.input}. Use a different ID.`);
  }
  if (!Array.isArray(request.catalogs) || request.catalogs.some((id) => !state.catalogs.some((catalog) => catalog.id === id)) || (state.catalogs.length && !request.catalogs.length)) throw new Error("Select at least one known catalog.");
  if (existing && !existing.managed && JSON.stringify([...request.catalogs].sort()) !== JSON.stringify([...existing.catalogs].sort())) throw new Error("This verifier has manually configured sources. Change its catalog scope in portolan.json.");
  // The built-in needs no declaration; one the manifest already has is kept.
  const plugin = (manifest.plugins ?? []).find((item) => item.host === "work-items")?.name
    ?? (workItemsPluginNames(manifest).has(WORK_ITEMS_PLUGIN) ? WORK_ITEMS_PLUGIN : null);
  if (!plugin) throw new Error("Plugin name work-items is already in use.");
  const output = existing?.output ?? `portolan-work-items/${createHash("sha256").update(request.input).digest("hex").slice(0, 12)}`;
  const previous = existing ? manifest.verify[existing.step] : null;
  const step = { ...(previous ?? {}), plugin, in: request.input, out: output, options: { ...previous?.options, trackers, maxCommits, out: previous?.options?.out ?? "work-items.json" } };
  manifest.verify ??= [];
  if (existing) manifest.verify[existing.step] = step;
  else manifest.verify.push(step);
  const source = `${output}/${step.options.out}`;
  if (!existing || existing.managed) {
    if (!(manifest.sources ?? []).some((pattern) => matchesGlob(source, pattern))) manifest.sources = [...(manifest.sources ?? []), source];
    for (const catalog of manifest.catalogs ?? []) {
      const sources = (catalog.sources ?? []).filter((item) => item !== source);
      if (!request.catalogs.includes(catalog.id) && sources.some((pattern) => matchesGlob(source, pattern))) throw new Error(`Catalog ${catalog.id} includes this output through a wildcard. Narrow its sources in portolan.json before changing scope.`);
      catalog.sources = request.catalogs.includes(catalog.id) ? [...sources, source] : sources;
    }
  }
  if (read(workspace).revision !== revision) throw new Error("portolan.json changed while settings were being validated. Reload settings and try again.");
  writeManifest(path, manifest);
  return taskTrackerState(workspace);
}

/** Select a saved verifier, never a path or command supplied by the browser. */
export function taskTrackerFullScanTarget(workspace, request) {
  const state = taskTrackerState(workspace);
  if (request?.revision !== state.revision) throw new Error("Tracker settings changed. Reload settings before starting a full scan.");
  const entry = state.entries.find((entry) => entry.step === request.step);
  if (!entry?.trackers.length) throw new Error("Configure and save at least one tracker before scanning.");
  const repository = state.repositories.find((item) => item.input === entry.input);
  if (!repository?.available) throw new Error(repository?.reason ?? "Git checkout unavailable.");
  return JSON.stringify([realpathSync(resolve(workspace, entry.input)), resolve(realpathSync(workspace), entry.output), entry.file]);
}
