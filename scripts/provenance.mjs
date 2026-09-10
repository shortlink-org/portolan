// Where each catalog source last changed, for the site's stamp.
//
// A fragment carries no provenance of its own (portolan.0010); the history of
// the checkout does. The browser cannot ask git, so this Vite plugin asks at
// build time - and again under the dev server whenever a source changes -
// and answers with one virtual module, keyed by the path `src/data.ts` gives
// a source. Nothing watches `.git`: a commit made while the dev server runs
// shows after a restart, or after the next change to a source.

import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { forgetHistory, stampsFor } from "./history.mjs";
import { readManifest } from "./manifest.mjs";

export const PROVENANCE_MODULE = "virtual:portolan-provenance";
const RESOLVED = `\0${PROVENANCE_MODULE}`;

/**
 * The stamp of every source the manifest's patterns find under `workspace`,
 * keyed by its path as the manifest spells it.
 *
 * A staged site (`portolan dev`, `portolan build`) imports its sources under
 * flattened names, `portolan/source-0007.json`, and keeps the way back in
 * `.portolan/source-paths.json`. Such a stamp is keyed by the staged name the
 * browser imports and carries `source`, the path the file has in the
 * workspace - the one a project's root is a prefix of, and the one a link to
 * the file has to name. Without it the site would know its sources only by
 * names nobody typed.
 *
 * @param {string} workspace
 * @param {string} siteRoot  Vite's root, which may contain flattened sources
 * @returns {Record<string, {commit: string, generatedAt: string, source?: string}>}
 */
export function provenance(workspace, siteRoot = workspace) {
  const sourceMap = join(siteRoot, ".portolan/source-paths.json");
  if (existsSync(sourceMap)) {
    const paths = JSON.parse(readFileSync(sourceMap, "utf8"));
    const stamps = stampsFor(workspace, Object.values(paths));
    return Object.fromEntries(Object.entries(paths).map(([staged, source]) => [staged, { ...stamps.get(source), source }]));
  }
  const manifest = readManifest(join(workspace, "portolan.json"));
  const paths = [];
  for (const pattern of manifest.sources ?? []) {
    for (const path of globSync(pattern, { cwd: workspace })) paths.push(path.split("\\").join("/"));
  }
  return Object.fromEntries(stampsFor(workspace, paths.sort()));
}

/** @param {string} workspace */
export function provenancePlugin(workspace) {
  let siteRoot = workspace;
  return {
    name: "portolan-provenance",
    configResolved(config) {
      siteRoot = config.root;
    },
    resolveId(id) {
      return id === PROVENANCE_MODULE ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      return `export default ${JSON.stringify(provenance(workspace, siteRoot))};\n`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".json") || file.includes("/node_modules/")) return;
      forgetHistory();
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}
