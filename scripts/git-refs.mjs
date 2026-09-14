import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitRepositoryAddress, normalizeGitRepos } from "../src/lib/git-fetch-config.mjs";

const runGit = promisify(execFile);
let pending = 0;
const LIMIT = 2000;

export function parseGitRefs(stdout) {
  const refs = new Map();
  let truncated = false;
  for (const line of stdout.split("\n")) {
    const match = /^[a-f0-9]{40,64}\t(refs\/(heads|tags)\/(.+))\r?$/i.exec(line);
    if (!match || match[1].endsWith("^{}")) continue;
    const ref = match[1];
    // Only offer revisions the fetch settings can save.
    try { normalizeGitRepos([{ repo: "https://example.com/owner/repo", ref }]); }
    catch { truncated = true; continue; }
    if (refs.has(ref)) continue;
    if (refs.size >= LIMIT) { truncated = true; continue; }
    refs.set(ref, { ref, name: match[3], kind: match[2] === "heads" ? "branch" : "tag" });
  }
  return { refs: [...refs.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), truncated };
}

export async function listGitRefs(repository, { env = process.env, run = runGit } = {}) {
  const address = gitRepositoryAddress(repository);
  if (pending >= 4) throw new Error("Other revision requests are running. Try again shortly.");
  pending++;
  try {
    const { stdout } = await run("git", ["-c", "credential.interactive=false", "ls-remote", "--refs", "--heads", "--tags", "--", address.urls[address.transport]], {
      encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10" },
    });
    return parseGitRefs(stdout);
  } catch (cause) {
    const detail = String(cause?.stderr ?? cause?.message ?? "").toLowerCase();
    throw new Error(cause?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      ? "This repository has too many revisions to list. Enter a ref manually."
      : cause?.code === "ETIMEDOUT" || cause?.killed
      ? "Loading revisions timed out. Check your network or VPN, or enter a ref manually."
      : detail.includes("host key verification failed")
      ? "SSH host is not trusted yet. Verify its host key in your terminal and retry."
      : /permission denied|authentication|could not read username|403|401/.test(detail)
      ? "Git could not read revisions. Check your SSH agent or credential helper."
      : "Could not load revisions. Check the repository address and connection, or enter a ref manually.");
  } finally { pending--; }
}
