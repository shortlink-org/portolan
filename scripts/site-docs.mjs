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
//
// The dev server places nothing, so siteDocsPlugin answers the same three
// paths from the generated directory as it is on disk, and a page edited or
// regenerated shows on the next request.

import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, posix, resolve, sep } from "node:path";
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

/**
 * What one request under the site's base asks for, or null when it is not
 * one of the files the build would place. Pure, so it can be tested without a
 * server: the answer says which file to read and how, not what is in it.
 *
 * @param {string} pathname  the request path, base included
 * @param {string} base      the site's base, "/" or "/portolan/"
 * @returns {{kind: "index"} | {kind: "full"} | {kind: "redirect", to: string}
 *   | {kind: "page", path: string} | null}
 */
export function docsRequest(pathname, base = "/") {
  const root = base.endsWith("/") ? base : `${base}/`;
  if (!pathname.startsWith(root)) return null;
  const rest = pathname.slice(root.length);

  if (rest === LLMS) return { kind: "index" };
  if (rest === LLMS_FULL) return { kind: "full" };
  if (rest !== DOCS_MOUNT.slice(0, -1) && !rest.startsWith(DOCS_MOUNT)) return null;

  // "docs" without its slash: send the browser to the slash so the page's own
  // relative links resolve against the directory, as they do on the forge.
  if (rest === DOCS_MOUNT.slice(0, -1)) return { kind: "redirect", to: `${root}${DOCS_MOUNT}` };

  let inside;
  try {
    inside = decodeURIComponent(rest.slice(DOCS_MOUNT.length));
  } catch {
    return null;
  }
  const segments = inside.split("/");
  if (segments.some((segment) => segment === ".." || segment.startsWith(".") && segment !== "")) return null;
  if (inside.includes("\\")) return null;
  if (inside === "" || inside.endsWith("/")) inside += "README.md";

  return { kind: "page", path: posix.normalize(inside) };
}

const TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Read one answer of docsRequest from the generated directory, or null when
 * the file is not there. Returned with its content type so the server needs
 * to know nothing about markdown.
 *
 * @param {string} docs  the generated directory
 * @param {ReturnType<typeof docsRequest>} request
 * @returns {{type: string, body: Buffer | string} | null}
 */
export function readDocsRequest(docs, request) {
  if (request === null || request.kind === "redirect") return null;
  const root = resolve(docs);

  if (request.kind === "index") {
    const file = join(root, LLMS);
    if (!isFile(file)) return null;
    return { type: TYPES[".txt"], body: mountLinks(readFileSync(file, "utf8"), DOCS_MOUNT) };
  }
  if (request.kind === "full") {
    const file = join(root, LLMS_FULL);
    if (!isFile(file)) return null;
    return { type: TYPES[".txt"], body: readFileSync(file) };
  }

  const file = resolve(root, normalize(request.path));
  if (!file.startsWith(root + sep) || !isFile(file)) return null;
  let target = file;
  // "docs/auth" resolving to a directory is answered by its index too, since a
  // link written as a bare directory is a link somebody expects to work.
  if (statSync(file).isDirectory()) {
    target = join(file, "README.md");
    if (!isFile(target)) return null;
  }
  return { type: TYPES[extname(target)] ?? "application/octet-stream", body: readFileSync(target) };
}

function isFile(path) {
  return existsSync(path) && !path.endsWith(`${sep}${GENERATOR_MANIFEST}`);
}

/**
 * The dev server's side of the build step: llms.txt, llms-full.txt and docs/
 * under the site's base, answered from the workspace as it is now. Vite's
 * own fallback would otherwise hand every one of them the app's index.html.
 */
export function siteDocsPlugin(workspace = process.cwd()) {
  return {
    name: "portolan-site-docs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const url = new URL(req.url ?? "/", "http://localhost");
        const request = docsRequest(url.pathname, server.config.base);
        if (request === null) return next();
        if (request.kind === "redirect") {
          res.writeHead(301, { Location: request.to });
          return res.end();
        }

        let docs;
        try {
          docs = docsDirectory(JSON.parse(readFileSync(join(workspace, "portolan.json"), "utf8")));
        } catch {
          return next();
        }
        if (docs === null) return next();

        const answer = readDocsRequest(join(workspace, docs), request);
        if (answer === null) return next();
        res.writeHead(200, { "Content-Type": answer.type, "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : answer.body);
      });
    },
  };
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
