// Which tasks changed what, read from the history where the catalog is read.
//
// A task link names the commits that mention the task. Written into a
// committed fragment it could never name the commit that fragment lands in,
// so a commit carrying its own regenerated links was stale the moment it was
// made (portolan.0020, after portolan.0010). Nothing is written: this module
// runs the work-items scan over the checkout's history at build time - and
// again under the dev server whenever a source changes - and answers with one
// virtual module the site merges like any other source.

import { realpathSync } from "node:fs";
import { join, matchesGlob, resolve } from "node:path";

import { loadCatalog } from "./catalog-sources.mjs";
import { fullScanTarget, scanWorkItems } from "./host-plugins/work-items.mjs";
import { readManifest } from "./manifest.mjs";
import { workItemsPluginNames } from "../src/lib/task-tracker-config.mjs";
import { onWorkItemsFullScan, requestWorkItemsFullScan, workItemsFullScans } from "./work-items-scans.mjs";

export const WORK_ITEMS_MODULE = "virtual:portolan-work-items";
const RESOLVED = `\0${WORK_ITEMS_MODULE}`;

let cached;
// A full scan changes what a reading answers.
onWorkItemsFullScan(() => forgetWorkItems());

export function forgetWorkItems() {
  cached = undefined;
}

/**
 * The links of every work-items verifier the manifest declares, each with the
 * path the manifest's catalogs name it by and the catalogs that include it.
 * `catalogs` is null when the manifest has no catalogs: the one catalog there
 * is takes every source.
 *
 * The links are resolved against the whole merged catalog, the one the
 * generator hands a verifier.
 *
 * @param {string} workspace
 * @returns {Promise<{ sources: { path: string, catalogs: string[] | null, fragment: object }[], warnings: string[] }>}
 */
export async function readWorkItems(workspace) {
  const manifest = readManifest(join(workspace, "portolan.json"));
  const hosts = workItemsPluginNames(manifest);
  const steps = (manifest.verify ?? []).filter((step) => hosts.has(step.plugin));
  if (steps.length === 0) return { sources: [], warnings: [] };

  let catalog;
  try {
    ({ catalog } = await loadCatalog(join(workspace, "portolan.json"), { cwd: workspace }));
  } catch (cause) {
    return { sources: [], warnings: [`work-items: the catalog could not be read, so no task links are shown: ${cause instanceof Error ? cause.message : String(cause)}`] };
  }

  const sources = [];
  const warnings = [];
  for (const step of steps) {
    const options = step.options ?? {};
    const path = `${step.out.replace(/\/$/, "")}/${options.out ?? "work-items.json"}`;
    const catalogs = manifest.catalogs
      ? manifest.catalogs.filter((profile) => (profile.sources ?? []).some((pattern) => matchesGlob(path, pattern))).map((profile) => profile.id)
      : null;
    // Spelled the way the settings page names a full-scan target.
    const request = { input: { root: resolve(workspace, step.in), output: resolve(realpathSync(workspace), step.out) }, catalog, options };
    try {
      const scanned = scanWorkItems(request, { fullScan: workItemsFullScans() });
      sources.push({ path, catalogs, fragment: scanned.fragment });
      warnings.push(...scanned.warnings.map((warning) => `work-items ⇐ ${step.in}: ${warning.message}`));
    } catch (cause) {
      warnings.push(`work-items ⇐ ${step.in}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { sources, warnings };
}

export { fullScanTarget, requestWorkItemsFullScan };

/**
 * @param {string} workspace
 * @param {{ disabled?: boolean }} [options]  tests read no history and get no links
 */
export function workItemsPlugin(workspace, { disabled = false } = {}) {
  return {
    name: "portolan-work-items",
    resolveId(id) {
      return id === WORK_ITEMS_MODULE ? RESOLVED : undefined;
    },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      if (disabled) return "export default [];\n";
      cached ??= readWorkItems(workspace);
      const { sources, warnings } = await cached;
      for (const warning of warnings) this.warn(warning);
      return `export default ${JSON.stringify(sources)};\n`;
    },
    configureServer(server) {
      const reload = () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      const stop = onWorkItemsFullScan(reload);
      server.httpServer?.once("close", stop);
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".json") || file.includes("/node_modules/")) return;
      forgetWorkItems();
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}
