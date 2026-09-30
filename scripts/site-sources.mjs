// The catalog sources the site reads, one module per profile.
//
// A page shows one profile, and the profiles are disjoint estates, so
// `src/data.ts` loads the sources of the profile on screen and no other. A
// lazy glob did that a file at a time: each source its own chunk, seventy
// requests for the example estate. This Vite plugin answers instead with one
// virtual module per profile - every source that profile reads, parsed and
// written out once - and an index of loaders, one per profile, that data.ts
// awaits for the profile it shows. One request for the data, whatever the
// profile.
//
// Which files: the manifest's `sources` beside the site (in a staged site,
// the flattened portolan/source-NNNN.json it names), each kept for the
// profiles whose patterns match it - the same patterns, matched the same way,
// as the app's own `profileIncludesSource`. A manifest without profiles is
// one catalog, `default`, reading every source.
//
// Under the dev server a module watches the files it carries, so editing or
// regenerating a source updates the page the way the file's own import did.
// A source that appears or disappears updates the profile it belongs to. The
// manifest is left to data.ts, which takes its changes without a reload
// unless the profiles changed; the modules are only marked stale here, so the
// reload that follows reads them afresh.

import { existsSync, globSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { catalogProfiles } from "../src/catalog-profile.ts";
import { matchesSourceGlobs } from "../src/lib/source-glob.ts";

export const SITE_SOURCES_MODULE = "virtual:portolan-sources";
const RESOLVED = `\0${SITE_SOURCES_MODULE}`;
const PROFILE_PREFIX = `${SITE_SOURCES_MODULE}/`;
const RESOLVED_PROFILE_PREFIX = `\0${PROFILE_PREFIX}`;

/**
 * The manifest beside the site, read as the app imports it: raw, since
 * data.ts takes the profiles from the same file without checking it.
 *
 * @param {string} root
 */
function siteManifest(root) {
  const path = join(root, "portolan.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { sources: [] };
}

/**
 * Every profile's sources, as paths relative to the site root, sorted.
 *
 * @param {string} root  Vite's root, the directory src/ and portolan.json are in
 * @returns {Map<string, string[]>}
 */
export function siteSources(root) {
  const manifest = siteManifest(root);
  const profiles = catalogProfiles(manifest);
  const patterns = manifest.sources ?? profiles.flatMap((profile) => profile.sources);
  const found = new Set();
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) {
      const normalized = path.split(sep).join("/");
      if (!normalized.split("/").includes("node_modules")) found.add(normalized);
    }
  }
  const candidates = [...found].sort();
  return new Map(profiles.map((profile) => [profile.id, candidates.filter((path) => matchesSourceGlobs(profile.sources, path))]));
}

/**
 * Whether a module is one profile's sources, for the build to name its chunk.
 *
 * @param {string} id
 */
export function isProfileSources(id) {
  return id.startsWith(RESOLVED_PROFILE_PREFIX);
}

export function siteSourcesPlugin() {
  let root = process.cwd();
  return {
    name: "portolan-site-sources",
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      if (id === SITE_SOURCES_MODULE) return RESOLVED;
      if (id.startsWith(PROFILE_PREFIX)) return `\0${id.replace(/\?.*$/, "")}`;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED) {
        const loaders = [...siteSources(root).keys()].map((profile) => {
          const module = JSON.stringify(`${PROFILE_PREFIX}${encodeURIComponent(profile)}`);
          return `  ${JSON.stringify(profile)}: () => import(${module}).then((module) => module.default),`;
        });
        return `export default {\n${loaders.join("\n")}\n};\n`;
      }
      if (!id.startsWith(RESOLVED_PROFILE_PREFIX)) return undefined;
      const profile = decodeURIComponent(id.slice(RESOLVED_PROFILE_PREFIX.length));
      const sources = {};
      for (const path of siteSources(root).get(profile) ?? []) {
        const file = resolve(root, path);
        this.addWatchFile(file);
        try {
          sources[path] = JSON.parse(readFileSync(file, "utf8"));
        } catch (cause) {
          this.error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      // JSON is a JavaScript literal, which the build minifies like any
      // other - except that a key spelled __proto__ would set the prototype
      // instead of naming a field. A file that has one is read by JSON.parse.
      const json = JSON.stringify(sources);
      const code = json.includes('"__proto__":')
        ? `export default JSON.parse(${JSON.stringify(json)});\n`
        : `export default ${json};\n`;
      // Data has no source to map back to; without this the dev server
      // inlines a map several times the size of the data.
      return { code, map: { mappings: "" } };
    },
    hotUpdate({ type, file, modules, timestamp }) {
      if (!file.endsWith(".json")) return undefined;
      const graph = this.environment.moduleGraph;
      const path = relative(root, file).split(sep).join("/");
      if (path === "portolan.json") {
        const seen = new Set();
        for (const mod of graph.idToModuleMap.values()) {
          if (mod.id === RESOLVED || mod.id?.startsWith(RESOLVED_PROFILE_PREFIX)) graph.invalidateModule(mod, seen, timestamp, true);
        }
        return undefined;
      }
      // An edited source is an import of the modules that carry it
      // (addWatchFile), and its update travels through them as it is.
      if (type === "update" || path.startsWith("../")) return undefined;
      const manifest = siteManifest(root);
      const readers = catalogProfiles(manifest)
        .filter((profile) => matchesSourceGlobs(manifest.sources ?? profile.sources, path) && matchesSourceGlobs(profile.sources, path))
        .map((profile) => graph.getModuleById(`${RESOLVED_PROFILE_PREFIX}${encodeURIComponent(profile.id)}`))
        .filter(Boolean);
      return readers.length ? [...modules, ...readers] : undefined;
    },
  };
}
