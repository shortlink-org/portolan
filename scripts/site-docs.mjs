// Puts the generated documentation into the built site.
//
//   node scripts/site-docs.mjs            after `vite build`
//
// The markdown generator writes docs/ with relative links and knows nothing of
// where the site is served from, which is right for a directory that is read
// on a forge or in an editor. llmstxt.org, though, asks for /llms.txt at the
// root of the site, and a link from there has to reach the page it names. So
// the built site gets three things:
//
//   dist/docs/**          the generated directory, as it is
//   dist/llms.txt         the index, its relative links pointed into docs/
//   dist/llms-full.txt    every page in one file, copied as it is: its links
//                         are relative to each page's own directory already,
//                         which the file itself says
//
// The docs are mounted under /docs/ and not at the root because the root is
// the app's: /flows, /adrs and every context id are routes, and a markdown
// tree beside them would shadow whichever it shares a name with.

import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest } from "./manifest.mjs";

const LLMS = "llms.txt";
const LLMS_FULL = "llms-full.txt";

/** Where the generated directory lives inside the site, with its slash. */
export const DOCS_MOUNT = "docs/";

/** The file list the generator keeps for itself; not a page. */
const GENERATOR_MANIFEST = ".portolan-manifest";

/**
 * Prefix every relative markdown link so the text still resolves once the
 * file is moved up out of its directory. Absolute URLs, root-relative paths
 * and same-page anchors are left as they are: none of them was relative to
 * the file's directory to begin with.
 *
 * @param {string} text
 * @param {string} prefix
 */
export function mountLinks(text, prefix) {
  return text.replace(
    /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (whole, target, title) =>
      isRelative(target) ? `](${prefix}${target}${title})` : whole,
  );
}

function isRelative(target) {
  if (target.startsWith("#") || target.startsWith("/")) return false;
  // A scheme: http:, https:, mailto:. A Windows drive letter is not a link a
  // generated page would carry, so one letter is treated as a scheme too.
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target);
}

/**
 * The generated directory named by the manifest's markdown step, or null when
 * the manifest declares no such step.
 *
 * @param {{generate?: Array<{plugin: string, out: string}>}} manifest
 */
export function docsDirectory(manifest) {
  const step = (manifest.generate ?? []).find((item) => item.plugin === "markdown");
  return step?.out ?? null;
}

/**
 * Copy the docs and place the llms files. Returns the paths written, relative
 * to dist, so the caller can say what happened.
 *
 * @param {{manifest: object, dist: string}} input
 * @returns {string[]}
 */
export function siteDocs({ manifest, dist }) {
  const docs = docsDirectory(manifest);
  if (docs === null || !existsSync(docs)) return [];

  const mount = DOCS_MOUNT.replace(/\/$/, "");
  cpSync(docs, join(dist, mount), {
    recursive: true,
    filter: (source) => !source.endsWith(`/${GENERATOR_MANIFEST}`),
  });
  const written = [`${mount}/`];

  const index = join(docs, LLMS);
  if (existsSync(index)) {
    writeFileSync(join(dist, LLMS), mountLinks(readFileSync(index, "utf8"), DOCS_MOUNT));
    written.push(LLMS);
  }

  const full = join(docs, LLMS_FULL);
  if (existsSync(full)) {
    cpSync(full, join(dist, LLMS_FULL));
    written.push(LLMS_FULL);
  }

  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { manifest } = loadManifest();
  const written = siteDocs({ manifest, dist: "dist" });
  if (written.length === 0) {
    console.log("site docs: nothing to place (no markdown step, or its output is not generated yet)");
  } else {
    console.log(`site docs: ${written.join(", ")} → dist/`);
  }
}
