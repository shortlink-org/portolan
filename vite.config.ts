import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

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

const commit =
  env.BUILD_COMMIT ||
  env.GITHUB_SHA ||
  env.CI_COMMIT_SHA ||
  git("rev-parse HEAD");

const buildInfo = {
  commit,
  shortCommit: commit.slice(0, 7),
  branch:
    env.BUILD_BRANCH ||
    env.GITHUB_REF_NAME ||
    env.CI_COMMIT_REF_NAME ||
    git("rev-parse --abbrev-ref HEAD"),
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
};

// GitHub Pages serves the app from /<repo>/, so CI sets BASE_PATH.
// Locally (and for a root-domain deploy) it stays "/".
export default defineConfig({
  base: env.BASE_PATH ?? "/",
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [
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
  resolve: {
    // One React, whatever a dependency asks for. The api reference ships its
    // own React wrapper around a Vue app, and a second copy of React reaching
    // the page turns every hook in it into "Invalid hook call".
    dedupe: ["react", "react-dom"],
  },
});
