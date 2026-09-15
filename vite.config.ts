import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { publicSetupFrom } from "./src/lib/setup-info.ts";
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { readManifest } from "./scripts/manifest.mjs";
// The local control plane is a Node-only Vite plugin kept as plain ESM so its
// pure discovery functions can also be tested directly.
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { localApiPlugin } from "./scripts/local-api.mjs";
// The generated docs and llms.txt, served in development from where the
// generator wrote them; the build copies the same files into dist.
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { siteDocsPlugin } from "./scripts/site-docs.mjs";
// When each catalog source last changed, read from git at build time and
// served to the app as one virtual module (portolan.0010).
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { provenancePlugin } from "./scripts/provenance.mjs";
// @ts-expect-error Node-only authoring module
import { annotationsPlugin } from "./scripts/annotations.mjs";
// Saved branch drafts, served to the app as one virtual module (portolan.0019).
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { draftsPlugin } from "./scripts/branch-drafts.mjs";
// Task links, read from the same history and never written into a fragment
// (portolan.0020).
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { workItemsPlugin } from "./scripts/work-items-history.mjs";
// src/likec4/generated.jsx is not committed; a checkout without it gets it
// written from likec4/ before Vite serves or builds.
// @ts-expect-error plain JavaScript module intentionally has no browser types
import { likec4BundlePlugin } from "./scripts/likec4-bundle.mjs";

/** A git answer, or "" when there is nothing to answer with (no repo, no git). */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const env = process.env;
const workspace = resolve(env.PORTOLAN_WORKSPACE ?? ".");
const portolanUpdate = env.PORTOLAN_CURRENT_VERSION && env.PORTOLAN_UPDATE_VERSION
  ? {
      current: env.PORTOLAN_CURRENT_VERSION,
      latest: env.PORTOLAN_UPDATE_VERSION,
    }
  : null;

// The stamp in the top bar, resolved at build time. Every field takes the
// first answer it gets:
//
//   1. BUILD_* — set these to say exactly what the stamp should show and
//      where it should link. Anything the CI below cannot work out (a forge
//      we do not read the variables of, a mirror, a release pipeline) goes
//      here.
//   2. The CI that is running: GitHub Actions (which Gitea and Forgejo
//      Actions copy) and GitLab CI, both self-hosted or not.
//   3. git, for a build made by hand.
//
// Whatever nothing answers stays empty, and the stamp shows less rather than
// linking somewhere that 404s.
const gh = env.GITHUB_SHA
  ? `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}`
  : "";
const gl = env.CI_COMMIT_SHA ? env.CI_PROJECT_URL || "" : "";

// Where the tree can be opened, for links from a path in the catalog to the
// file on the forge. A remote spelled for ssh is rewritten to its page.
const origin = git("remote get-url origin")
  .replace(/^git@([^:]+):/, "https://$1/")
  .replace(/^ssh:\/\/git@/, "https://")
  .replace(/\.git$/, "");
const repoUrl =
  env.BUILD_REPO_URL || gh || gl || (/^https?:\/\//.test(origin) ? origin : "");
const forge =
  env.BUILD_FORGE === "github" || env.BUILD_FORGE === "gitlab"
    ? env.BUILD_FORGE
    : gh
      ? "github"
      : gl || /gitlab/i.test(repoUrl)
        ? "gitlab"
        : /github/i.test(repoUrl)
          ? "github"
          : undefined;

const commit =
  env.BUILD_COMMIT ||
  env.GITHUB_SHA ||
  env.CI_COMMIT_SHA ||
  git("rev-parse HEAD");

const branch =
  env.BUILD_BRANCH ||
  env.GITHUB_HEAD_REF ||
  env.GITHUB_REF_NAME ||
  env.CI_COMMIT_REF_NAME ||
  git("rev-parse --abbrev-ref HEAD");

const buildInfo = {
  commit,
  shortCommit: commit.slice(0, 7),
  branch,
  builtAt: new Date().toISOString(),
  commitUrl:
    env.BUILD_COMMIT_URL ||
    (gh && commit ? `${gh}/commit/${commit}` : "") ||
    // GitLab namespaces project routes under /-/.
    (gl && commit ? `${gl}/-/commit/${commit}` : ""),
  buildUrl:
    env.BUILD_URL ||
    (gh && env.GITHUB_RUN_ID
      ? `${gh}/actions/runs/${env.GITHUB_RUN_ID}`
      : "") ||
    env.CI_PIPELINE_URL ||
    "",
  // The number a human reads off a pipeline, not the id in its URL.
  buildNumber:
    env.BUILD_NUMBER || env.GITHUB_RUN_NUMBER || env.CI_PIPELINE_IID || "",
  // Only a local build can be dirty: CI builds a checkout of one commit.
  dirty:
    !env.GITHUB_SHA && !env.CI_COMMIT_SHA && git("status --porcelain") !== "",
  repoUrl,
  forge,
};

// The deployed site may explain how it was assembled, but it must not publish
// the executable commands or arbitrary options in portolan.json. Reduce the
// manifest here, while building, and expose only the read-only inventory the
// Settings page needs.
const manifestText = readFileSync(resolve(workspace, "portolan.json"), "utf8");
let buildReport: unknown;
try {
  buildReport = JSON.parse(
    readFileSync(resolve(workspace, ".portolan/build-report.json"), "utf8"),
  ) as unknown;
} catch {
  // A clean checkout has no run to report yet. Settings says so explicitly.
}
const setupInfo = publicSetupFrom(
  readManifest(resolve(workspace, "portolan.json")) as unknown,
  buildReport,
  createHash("sha256").update(manifestText).digest("hex"),
);

// GitHub Pages serves the app from /<repo>/, so CI sets BASE_PATH.
// Locally (and for a root-domain deploy) it stays "/".
export default defineConfig({
  base: env.BASE_PATH ?? "/",
  server: {
    // The editor loads Mermaid diagram renderers lazily. A browser-cached
    // transformed module can otherwise outlive Vite's optimized-dependency
    // cache after a restart and request a child chunk with an obsolete hash.
    // Dev modules are disposable, so keep the whole graph on one generation.
    headers: { "Cache-Control": "no-store" },
    // External repositories are inspected and generator previews run under
    // .portolan. Their tsconfig files and generated output are inputs to the
    // local control plane, not another Vite application to hot-reload.
    watch: { ignored: ["**/.portolan/**"] },
    proxy: {
      "/api/portolan-chat": {
        target: "https://portolan-chat.batazor.workers.dev",
        changeOrigin: true,
        rewrite: () => "/chat",
        // The browser talks to Vite on the same origin. Vite talks to the
        // worker as the public demo, whose origin is deliberately allowlisted.
        headers: { Origin: "https://shortlink-org.github.io" },
      },
    },
  },
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
    __SETUP_INFO__: JSON.stringify(setupInfo),
    __PROJECT_PREVIEW__: JSON.stringify(env.PORTOLAN_PROJECT_PREVIEW === "1"),
    __PORTOLAN_UPDATE__: JSON.stringify(portolanUpdate),
  },
  plugins: [
    likec4BundlePlugin(),
    // Inject the TypeScript projection from the staged Vite config rather than
    // importing it from local-api.mjs. The latter is also loaded directly by
    // `portolan init` from the published package, and Node does not strip
    // TypeScript below node_modules.
    localApiPlugin(workspace, publicSetupFrom),
    siteDocsPlugin(workspace),
    provenancePlugin(workspace),
    workItemsPlugin(workspace),
    annotationsPlugin(workspace),
    draftsPlugin(workspace),
    react(),
    tailwindcss(),
    // The AsyncAPI reference brings a parser written for Node, and it calls
    // Buffer, util and process while it loads. Only the modules it actually
    // reaches are shimmed: this is a static site with no server in it, and a
    // blanket polyfill would put a Node runtime in the chunk the app boots
    // from to serve one lazily loaded tab.
    nodePolyfills({
      include: ["buffer", "events", "path", "process", "stream", "util"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // LikeC4's renderer and the generated model are only reached through
          // lazy imports (a C4 view, a flow page), but two lazy chunks share
          // them, and left alone the bundler hoists what they share into the
          // chunk that imports both: the catalog shell every page waits for.
          // A group of their own keeps them off the first load, together with
          // the app modules that import them. Icons are excluded: the shell
          // draws one of them. Only the modules named here move, not what
          // they depend on, or React would move with them.
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "likec4",
              test: /[\\/]node_modules[\\/](likec4|@likec4[\\/](?!icons[\\/]))|[\\/]src[\\/]likec4[\\/](generated\.jsx|C4View\.tsx|FlowView\.tsx|InteractiveView\.tsx|CanvasBridge\.tsx|view-index\.ts|container-layout\.ts)$|[\\/]src[\\/]drafts[\\/]branch-view\.ts$/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    // One React, whatever a dependency asks for. The api reference ships its
    // own React wrapper around a Vue app, and a second copy of React reaching
    // the page turns every hook in it into "Invalid hook call".
    dedupe: ["react", "react-dom"],
  },
});
