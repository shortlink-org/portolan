// Repositories a project is read from: how a URL is understood, the session's
// access tokens and the Git environment that presents them, what a failure
// is told as, and the shallow checkout a repository is inspected in.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

import { discoverProject, projectDefaults } from "../local-discovery.mjs";
import { lstatExists } from "./workspace.mjs";

const repositoryCredentials = new Map();

export function externalProjectDefaults(repository, sourcePath = "") {
  const repo = repositoryParts(repository);
  const clean = cleanSourcePath(sourcePath);
  return projectDefaults(clean ? posix.basename(clean) : repo.name);
}

export function repositoryParts(repository) {
  const value = String(repository ?? "").trim();
  if (!value || value.startsWith("-") || /[\r\n\0]/.test(value)) throw new Error("Repository URL is required.");
  let path;
  let host;
  let fetchUrl = value;
  let transport = "https";
  if (value.startsWith("git@")) {
    const match = /^git@([^:/\s]+):(.+)$/.exec(value);
    if (!match) throw new Error("Use a valid SSH repository URL.");
    [, host, path] = match;
    transport = "ssh";
  }
  else if (value.includes("://")) {
    const url = new URL(value);
    const embeddedCredentials = url.protocol === "https:" ? Boolean(url.username || url.password) : Boolean(url.password);
    if (!["https:", "ssh:"].includes(url.protocol) || embeddedCredentials) throw new Error("Use an HTTPS or SSH repository URL without embedded credentials.");
    host = url.hostname;
    path = url.pathname;
    transport = url.protocol === "ssh:" ? "ssh" : "https";
  } else {
    if (!/^[a-z0-9.-]+\/[a-z0-9._/-]+$/i.test(value)) throw new Error("Repository must name a host, owner and repository.");
    host = value.slice(0, value.indexOf("/"));
    path = value.slice(value.indexOf("/") + 1);
    fetchUrl = `https://${value}`;
  }
  const segments = path.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("Repository must name an owner and repository.");
  const normalizedHost = host.toLowerCase();
  const provider = normalizedHost === "github.com" || normalizedHost.endsWith(".github.com")
    ? "GitHub"
    : normalizedHost === "gitlab.com" || normalizedHost.endsWith(".gitlab.com")
      ? "GitLab"
      : "Git server";
  return { value, fetchUrl, host, provider, transport, owner: segments.at(-2), name: segments.at(-1), web: `${host}/${segments.at(-2)}/${segments.at(-1)}` };
}

export class LocalApiError extends Error {
  constructor(message, { code = "request_failed", status = 400, retryable = false, provider, host, credentialSupported = false, credentialPresent = false } = {}) {
    super(message);
    this.name = "LocalApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.host = host;
    this.credentialSupported = credentialSupported;
    this.credentialPresent = credentialPresent;
  }
}

/** Turn unstable git stderr and timeout shapes into a small, safe API contract. */
export function classifyRepositoryFailure(cause, provider = "Git server", phase = "inspect the repository") {
  const text = [cause?.message, cause?.stderr, cause?.stdout].filter(Boolean).map(String).join("\n");
  const lower = text.toLowerCase();
  const timedOut = cause?.code === "ETIMEDOUT" || /timed? out|timeout|signal sigterm/.test(lower) && cause?.status == null;
  if (timedOut) {
    return new LocalApiError(`${provider} did not respond in time while Portolan tried to ${phase}. Check your network or VPN, then retry.`, {
      code: "repository_timeout", status: 504, retryable: true, provider,
    });
  }
  if (/returned error:\s*403|http[^\n]*403|status(?: code)?\s*403/.test(lower) || /permission denied|access denied|not authorized/.test(lower)) {
    return new LocalApiError(`${provider} refused access to this repository. Check repository permissions and organization or SSO authorization, then retry.`, {
      code: "repository_forbidden", status: 403, retryable: true, provider,
    });
  }
  if (/returned error:\s*401|http[^\n]*401|status(?: code)?\s*401|authentication failed|could not read username|terminal prompts disabled|invalid credentials/.test(lower)) {
    return new LocalApiError(`${provider} requires authentication for this repository. Authenticate Git with a read-only credential, then retry.`, {
      code: "repository_auth_required", status: 401, retryable: true, provider,
    });
  }
  return new LocalApiError(`Could not ${phase}. Check the repository URL, ref and network access, then retry.`, {
    code: "repository_unavailable", status: 400, retryable: true, provider,
  });
}

function credentialUsername(provider) {
  return provider === "GitHub" ? "x-access-token" : provider === "GitLab" ? "oauth2" : "git";
}

function environmentCredential(repo) {
  const token = repo.provider === "GitHub"
    ? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
    : repo.provider === "GitLab"
      ? process.env.GITLAB_TOKEN
      : undefined;
  return token ? { token, username: credentialUsername(repo.provider), provider: repo.provider } : null;
}

function credentialFor(repo) {
  return repositoryCredentials.get(repo.host.toLowerCase()) ?? environmentCredential(repo);
}

export function storeRepositoryCredential(request) {
  const repo = repositoryParts(request.repository);
  if (repo.transport !== "https" || !["GitHub", "GitLab"].includes(repo.provider)) {
    throw new LocalApiError("Access tokens are supported for HTTPS GitHub and GitLab repositories.", { code: "credential_unsupported", status: 400 });
  }
  const token = String(request.token ?? "").trim();
  if (!token || token.length > 8_192 || /[\r\n\0]/.test(token)) {
    throw new LocalApiError("Enter a valid access token.", { code: "credential_invalid", status: 400 });
  }
  repositoryCredentials.set(repo.host.toLowerCase(), { token, username: credentialUsername(repo.provider), provider: repo.provider });
  return { host: repo.host.toLowerCase(), provider: repo.provider, scope: "session", stored: true };
}

export function forgetRepositoryCredential(request) {
  const repo = repositoryParts(request.repository);
  repositoryCredentials.delete(repo.host.toLowerCase());
  return { host: repo.host.toLowerCase(), provider: repo.provider, scope: "session", stored: false };
}

function gitConfigEnvironment(env) {
  const parsed = Number.parseInt(String(env.GIT_CONFIG_COUNT ?? "0"), 10);
  const count = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  return { ...env, GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: "credential.helper", [`GIT_CONFIG_VALUE_${count}`]: "" };
}

export function gitAuthEnvironment(repositories = []) {
  const credentials = {};
  if (repositories.length) {
    for (const repo of repositories) {
      const credential = credentialFor(repo);
      if (repo.transport === "https" && credential) credentials[repo.host.toLowerCase()] = credential;
    }
  } else {
    for (const [host, credential] of repositoryCredentials) credentials[host] = credential;
    if (!credentials["github.com"] && (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) {
      credentials["github.com"] = { token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, username: "x-access-token", provider: "GitHub" };
    }
    if (!credentials["gitlab.com"] && process.env.GITLAB_TOKEN) {
      credentials["gitlab.com"] = { token: process.env.GITLAB_TOKEN, username: "oauth2", provider: "GitLab" };
    }
  }
  const entries = Object.entries(credentials);
  if (!entries.length) return { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, dispose() {} };
  const holder = mkdtempSync(join(tmpdir(), "portolan-git-auth-"));
  const helper = join(holder, process.platform === "win32" ? "askpass.cmd" : "askpass.cjs");
  const script = process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${join(holder, "askpass.mjs")}" %*\r\n`
    : `#!${process.execPath}\nconst process = require("node:process");\nconst credentials = JSON.parse(process.env.PORTOLAN_GIT_CREDENTIALS_JSON || "{}");\nconst prompt = String(process.argv[2] || "");\nconst authority = /https?:\\/\\/([^/'"]+)/i.exec(prompt)?.[1];\nconst host = authority?.split("@").pop()?.replace(/:\\d+$/, "").toLowerCase();\nconst values = Object.values(credentials);\nconst credential = credentials[host] || (values.length === 1 ? values[0] : null);\nif (credential) process.stdout.write(String(/username/i.test(prompt) ? credential.username : credential.token));\n`;
  if (process.platform === "win32") {
    writeFileSync(join(holder, "askpass.mjs"), `import process from "node:process";\nconst credentials = JSON.parse(process.env.PORTOLAN_GIT_CREDENTIALS_JSON || "{}");\nconst prompt = String(process.argv[2] || "");\nconst authority = /https?:\\/\\/([^/'"]+)/i.exec(prompt)?.[1];\nconst host = authority?.split("@").pop()?.replace(/:\\d+$/, "").toLowerCase();\nconst values = Object.values(credentials);\nconst credential = credentials[host] || (values.length === 1 ? values[0] : null);\nif (credential) process.stdout.write(String(/username/i.test(prompt) ? credential.username : credential.token));\n`);
  }
  writeFileSync(helper, script, { mode: 0o700 });
  const env = gitConfigEnvironment({
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: helper,
    GIT_ASKPASS_REQUIRE: "force",
    PORTOLAN_GIT_CREDENTIALS_JSON: JSON.stringify(credentials),
  });
  return { env, dispose() { rmSync(holder, { recursive: true, force: true }); } };
}

function repositoryFailure(cause, repo, phase) {
  const failure = classifyRepositoryFailure(cause, repo.provider, phase);
  failure.host = repo.host.toLowerCase();
  failure.credentialSupported = repo.transport === "https" && ["GitHub", "GitLab"].includes(repo.provider);
  failure.credentialPresent = repositoryCredentials.has(repo.host.toLowerCase());
  return failure;
}

function remoteCommit(repo, ref) {
  if (ref.startsWith("-") || /[\s\r\n\0]/.test(ref)) throw new Error("Branch, tag or commit is not valid.");
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  const query = ref.trim() || "HEAD";
  const auth = gitAuthEnvironment([repo]);
  let output;
  try {
    output = execFileSync("git", ["ls-remote", "--quiet", repo.fetchUrl, query, `${query}^{}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1024 * 1024, env: auth.env,
    });
  } finally { auth.dispose(); }
  const lines = output.trim().split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.trimEnd().endsWith("^{}"));
  const commit = (peeled ?? lines[0] ?? "").trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Repository has no ref "${query}".`);
  return commit.toLowerCase();
}

export function resolveRepositoryCommit(repository, ref) {
  const repo = repositoryParts(repository);
  try { return remoteCommit(repo, String(ref ?? "").trim()); }
  catch (cause) { throw repositoryFailure(cause, repo, "resolve the requested ref"); }
}

function inspectionKey(repository, commit, sourcePath = "") {
  return createHash("sha256").update(`${repository}\0${commit}\0${sourcePath}`).digest("hex").slice(0, 16);
}

export function cleanSourcePath(sourcePath) {
  const clean = String(sourcePath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.startsWith("/") || clean.startsWith("-") || clean.split("/").includes("..")) throw new Error("Repository path must be relative.");
  return clean;
}

export function inspectionRoot(repository, commit, sourcePath = "") {
  const clean = cleanSourcePath(sourcePath);
  return [".portolan", "inspect", inspectionKey(repository, commit, clean), clean].filter(Boolean).join("/");
}

export function prepareRepository(workspace, request) {
  const repo = repositoryParts(request.repository);
  const ref = String(request.ref ?? "").trim();
  const sourcePath = cleanSourcePath(request.sourcePath);
  const commit = resolveRepositoryCommit(repo.value, ref);
  const root = inspectionRoot(repo.value, commit, sourcePath);
  const checkout = join(workspace, ".portolan", "inspect", inspectionKey(repo.value, commit, sourcePath));
  if (!lstatExists(checkout)) {
    mkdirSync(dirname(checkout), { recursive: true });
    const staging = mkdtempSync(join(dirname(checkout), ".checkout-"));
    try {
      const options = { cwd: staging, stdio: "pipe", timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } };
      execFileSync("git", ["init", "--quiet"], options);
      const auth = gitAuthEnvironment([repo]);
      try { execFileSync("git", ["fetch", "--quiet", "--depth", "1", repo.fetchUrl, commit], { ...options, env: auth.env }); }
      finally { auth.dispose(); }
      if (sourcePath) execFileSync("git", ["sparse-checkout", "set", "--no-cone", sourcePath], options);
      execFileSync("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], options);
      renameSync(staging, checkout);
    } catch (cause) {
      throw repositoryFailure(cause, repo, "download the repository");
    } finally {
      if (lstatExists(staging)) rmSync(staging, { recursive: true, force: true });
    }
  }
  if (sourcePath && !lstatExists(join(checkout, sourcePath))) throw new Error(`Repository path "${sourcePath}" does not exist at ${commit.slice(0, 7)}.`);
  const discovered = discoverProject(workspace, root);
  const discovery = { ...discovered, defaults: externalProjectDefaults(repo.value, sourcePath) };
  return { repository: repo.value, ref, commit, sourcePath, checkoutRoot: root, discovery };
}
