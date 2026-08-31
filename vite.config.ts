import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

/** "owner/repo" out of either remote form GitHub hands out. */
function repoFromRemote(url: string): string {
  return /github\.com[:/](.+?)(?:\.git)?$/.exec(url)?.[1] ?? "";
}

// On Actions the environment already knows all of this; locally we ask git.
// Anything neither can answer stays empty, and the stamp shows less rather
// than inventing a number.
const env = process.env;
const commit = env.GITHUB_SHA || git("rev-parse HEAD");
const buildInfo = {
  commit,
  shortCommit: commit.slice(0, 7),
  branch: env.GITHUB_REF_NAME || git("rev-parse --abbrev-ref HEAD"),
  builtAt: new Date().toISOString(),
  repo:
    env.GITHUB_REPOSITORY ||
    repoFromRemote(git("config --get remote.origin.url")),
  server: env.GITHUB_SERVER_URL || "https://github.com",
  runNumber: env.GITHUB_RUN_NUMBER || "",
  runId: env.GITHUB_RUN_ID || "",
  // Only a local build can be dirty: CI builds a checkout of one commit.
  dirty: !env.GITHUB_SHA && git("status --porcelain") !== "",
};

// GitHub Pages serves the app from /<repo>/, so CI sets BASE_PATH.
// Locally (and for a root-domain deploy) it stays "/".
export default defineConfig({
  base: env.BASE_PATH ?? "/",
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [react(), tailwindcss()],
});
