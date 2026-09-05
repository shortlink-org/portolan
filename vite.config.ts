import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { publicSetupFrom } from "./src/lib/setup-info.ts";

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

const branch =
  env.BUILD_BRANCH ||
  env.GITHUB_HEAD_REF ||
  env.GITHUB_REF_NAME ||
  env.CI_COMMIT_REF_NAME ||
  git("rev-parse --abbrev-ref HEAD");

/**
 * Branches are a build-time snapshot, not a browser-side GitHub API call. This
 * keeps a deployed catalog usable without a token and makes private/self-hosted
 * repositories behave the same way as GitHub. CI fetches the refs it wants to
 * expose; a local build naturally sees the developer's refs.
 */
function branchSnapshot(current: string): Array<{
  name: string;
  commit: string;
  committedAt: string;
}> {
  let output = "";
  try {
    output = execFileSync(
      "git",
      [
        "for-each-ref",
        "--format=%(refname)\t%(objectname:short)\t%(committerdate:iso-strict)",
        "refs/heads",
        "refs/remotes/origin",
      ],
      { encoding: "utf8" },
    );
  } catch {
    // Not a repository. The current build branch is still useful on its own.
  }

  const branches = new Map<
    string,
    { name: string; commit: string; committedAt: string }
  >();
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [ref = "", short = "", committedAt = ""] = line.split("\t");
    const name = ref
      .replace(/^refs\/heads\//, "")
      .replace(/^refs\/remotes\/origin\//, "");
    if (!name || name === "HEAD") continue;
    const candidate = { name, commit: short, committedAt };
    // Local refs are emitted first and are the best spelling of duplicates.
    if (!branches.has(name) || ref.startsWith("refs/heads/")) {
      branches.set(name, candidate);
    }
  }

  for (const name of [
    ...(env.BUILD_BRANCHES ?? "").split(/[\n,]/),
    env.GITHUB_BASE_REF,
    env.GITHUB_HEAD_REF,
    current,
  ]) {
    const clean = name?.trim();
    if (clean && clean !== "HEAD" && !branches.has(clean)) {
      branches.set(clean, {
        name: clean,
        commit: clean === current ? commit.slice(0, 7) : "",
        committedAt: clean === current ? git("show -s --format=%cI HEAD") : "",
      });
    }
  }

  return [...branches.values()]
    .sort((a, b) => {
      if (a.name === current) return -1;
      if (b.name === current) return 1;
      if (a.name === "main") return -1;
      if (b.name === "main") return 1;
      return b.committedAt.localeCompare(a.committedAt) || a.name.localeCompare(b.name);
    })
    .slice(0, 100);
}

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
  branches: branchSnapshot(branch),
};

// The deployed site may explain how it was assembled, but it must not publish
// the executable commands or arbitrary options in portolan.json. Reduce the
// manifest here, while building, and expose only the read-only inventory the
// Settings page needs.
const manifestText = readFileSync(
  new URL("./portolan.json", import.meta.url),
  "utf8",
);
let buildReport: unknown;
try {
  buildReport = JSON.parse(
    readFileSync(
      new URL("./.portolan/build-report.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
} catch {
  // A clean checkout has no run to report yet. Settings says so explicitly.
}
const setupInfo = publicSetupFrom(
  JSON.parse(manifestText) as unknown,
  buildReport,
  createHash("sha256").update(manifestText).digest("hex"),
);

// GitHub Pages serves the app from /<repo>/, so CI sets BASE_PATH.
// Locally (and for a root-domain deploy) it stays "/".
export default defineConfig({
  base: env.BASE_PATH ?? "/",
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
    __SETUP_INFO__: JSON.stringify(setupInfo),
  },
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
