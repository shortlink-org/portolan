import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";

import { publicSetupFrom } from "../src/lib/setup-info.ts";
import { loadManifest } from "./manifest.mjs";
import { builtinPluginNames } from "./builtin-plugins.mjs";

export const LOCAL_API_PREFIX = "/__portolan";
export const GENERATOR_EVENT_PREFIX = "::portolan-event::";

const SKIP = new Set([".git", ".portolan", "build", "dist", "node_modules", "target", "vendor"]);
const MAX_FILES = 12_000;
const MAX_COMPONENTS = 100;
const MAX_SOURCE_BYTES = 1024 * 1024;
const jobs = new Map();
const repositoryCredentials = new Map();
const SNAPSHOT_SKIP = new Set([".git", ".portolan", "dist", "node_modules", "target"]);
const PROJECT_PREVIEW_TTL_MS = 15 * 60 * 1000;

function safeRoot(workspace, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Project path is required.");
  const clean = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) throw new Error("Project path must stay inside this repository.");
  const workspaceReal = realpathSync(workspace);
  const targetReal = realpathSync(resolve(workspaceReal, clean));
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error("Project path resolves outside this repository.");
  }
  const root = relative(workspaceReal, targetReal).replaceAll(sep, "/") || ".";
  return { root, absolute: targetReal };
}

/** A UTF-8 source file inside the served workspace, never outside it. */
export function readLocalSource(workspace, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Source path is required.");
  const clean = input.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (clean.includes("\0") || clean.startsWith("/") || clean.split("/").includes("..")) {
    throw new Error("Source path must stay inside this repository.");
  }
  const workspaceReal = realpathSync(workspace);
  const targetReal = realpathSync(resolve(workspaceReal, clean));
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error("Source path resolves outside this repository.");
  }
  const stat = statSync(targetReal);
  if (!stat.isFile()) throw new Error("Source path is not a file.");
  if (stat.size > MAX_SOURCE_BYTES) throw new Error("Source file is larger than the 1 MB preview limit.");
  const bytes = readFileSync(targetReal);
  if (bytes.includes(0)) throw new Error("Source file is binary.");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Source file is not UTF-8 text.");
  }
  return {
    path: relative(workspaceReal, targetReal).replaceAll(sep, "/"),
    content,
  };
}

function walk(root) {
  const files = new Set();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length && files.size < MAX_FILES) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || (entry.isDirectory() && entry.name.startsWith("."))) continue;
      const name = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = join(current.absolute, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) pending.push({ absolute, relative: name });
      else if (stat.isFile()) files.add(name);
      if (files.size >= MAX_FILES) break;
    }
  }
  return files;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matches(files, pattern) {
  return [...files].filter((name) => pattern.test(name)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

function compactDirectories(paths) {
  const directories = [...new Set(paths.map((name) => posix.dirname(name)))].sort((a, b) => a.length - b.length);
  return directories.filter((dir, index) => !directories.some((parent, other) => other < index && (dir === parent || dir.startsWith(`${parent}/`))));
}

const COMPONENT_MARKERS = new Map([
  ["go.mod", "Go"],
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java"],
  ["build.gradle.kts", "Kotlin"],
  ["manage.py", "Django"],
]);

function componentCandidates(files) {
  const roots = new Map();
  for (const name of files) {
    const marker = posix.basename(name);
    const technology = COMPONENT_MARKERS.get(marker);
    if (!technology) continue;
    const path = posix.dirname(name);
    const key = path === "." ? "." : path;
    if (key.split("/").some((segment) => ["fixture", "fixtures", "test", "tests", "testdata"].includes(segment.toLowerCase()))) continue;
    const found = roots.get(key) ?? { path: key, markers: new Set(), technologies: new Set() };
    found.markers.add(marker);
    found.technologies.add(technology);
    roots.set(key, found);
  }
  return [...roots.values()]
    .sort((a, b) => a.path === "." ? -1 : b.path === "." ? 1 : a.path.localeCompare(b.path))
    .slice(0, MAX_COMPONENTS)
    .map((candidate) => {
      const base = candidate.path === "." ? "repository root" : posix.basename(candidate.path);
      return {
        path: candidate.path,
        name: base.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") || base,
        markers: [...candidate.markers].sort(),
        technologies: [...candidate.technologies].sort(),
      };
    });
}

function detected(plugin, candidates, options = {}, label = candidates[0], ambiguous = false, selected = true) {
  if (!candidates.length) return null;
  return {
    plugin,
    confidence: ambiguous && candidates.length > 1 ? "medium" : "high",
    evidence: label,
    candidates,
    options,
    selected,
  };
}

function compatibleAdrs(root, candidates) {
  return candidates.filter((name) => {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { return false; }
    return /^#\s+[^\n]+\.\d{4}\s+[—-]/m.test(source) && /^-\s+\*\*Status:\*\*/mi.test(source) && /^-\s+\*\*Date:\*\*/mi.test(source);
  });
}

function goDomainEvidence(root, files) {
  const layout = /^internal\/(?:domain\/([^/]+)|([^/]+)\/domain)\/[^/]+\.go$/i;
  const candidates = matches(files, layout);
  for (const name of candidates) {
    const match = layout.exec(name);
    if (!match) continue;
    const aggregate = match[1] ?? match[2];
    const packageName = aggregate.replace(/[^a-zA-Z0-9_]/g, "_");
    const rootName = aggregate
      .split(/[^a-zA-Z0-9]+|_/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join("");
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const packagePattern = new RegExp(`\\bpackage\\s+${packageName}\\b`);
    const rootPattern = new RegExp(`\\btype\\s+${rootName}\\s+struct\\s*\\{`);
    if (packagePattern.test(source) && rootPattern.test(source)) return name;
  }
  return "";
}

function laidOutDomainEvidence(root, files, language) {
  const extension = language === "typescript" ? "ts" : language === "rust" ? "rs" : "java";
  const prefix = language === "java" ? /(?:^|\/)domain\/([^/]+)\/[^/]+\.java$/i : /^src\/domain\/([^/]+)\/[^/]+\.(?:ts|rs)$/i;
  for (const name of matches(files, prefix)) {
    if (!name.endsWith(`.${extension}`)) continue;
    const match = prefix.exec(name);
    if (!match) continue;
    const rootName = match[1].split(/[^a-zA-Z0-9]+|_/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const claim = language === "typescript"
      ? new RegExp(`\\b(?:export\\s+)?class\\s+${rootName}\\b`)
      : language === "rust"
        ? new RegExp(`\\bpub\\s+struct\\s+${rootName}\\b`)
        : /@AggregateRoot\b/.test(source) || new RegExp(`\\bclass\\s+${rootName}\\b`).test(source);
    if (claim instanceof RegExp ? claim.test(source) : claim) return name;
  }
  return "";
}

function goHTTPClientEvidence(root, files) {
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (
      /\bhttp\.(?:NewRequest(?:WithContext)?|Get|Post|PostForm|Head)\s*\(/.test(source)
      || /ClientWithResponses(?:Interface)?\b/.test(source)
      || /github\.com\/hooklift\/gowsdl\/soap/.test(source)
    ) return name;
  }
  return "";
}

function goSOAPClientEvidence(root, files) {
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (
      /github\.com\/hooklift\/gowsdl\/soap/.test(source)
      || /\bCallContext\s*\([^,]+,\s*[^,]*(?:soap)?action/i.test(source)
      || /(?:Header\.)?(?:Add|Set)\s*\(\s*["'](?:SOAPAction|Content-Type)["']/i.test(source)
    ) return name;
  }
  return "";
}

function goRedisEvidence(root, files) {
  const redisImport = /github\.com\/(?:redis\/go-redis(?:\/v\d+)?|go-redis\/redis(?:\/v\d+)?|redis\/rueidis|gomodule\/redigo\/redis)(?=\")/g;
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const imports = [...source.matchAll(redisImport)].map((match) => match[0]);
    if (!imports.length) continue;

    const aliases = new Set();
    for (const importPath of imports) {
      const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const declaration = new RegExp(`(?:^|\\n)\\s*(?:import\\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\\s+)?\"${escaped}\"`, "m").exec(source);
      const alias = declaration?.[1];
      if (alias && alias !== "_" && alias !== ".") aliases.add(alias);
      else aliases.add(importPath.includes("rueidis") ? "rueidis" : "redis");
    }
    if ([...aliases].some((alias) => new RegExp(`\\b${alias}\\.(?:NewClient|NewClusterClient|NewFailoverClient|NewFailoverClusterClient|Dial|DialURL)\\s*\\(`).test(source))) {
      return name;
    }
  }
  return "";
}

function detectionsFor(root, files) {
  let goMod = "";
  if (files.has("go.mod")) {
    try { goMod = readFileSync(join(root, "go.mod"), "utf8"); } catch {}
  }
  const openapi = matches(files, /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i);
  const wsdls = matches(files, /\.wsdl$/i);
  const asyncapi = matches(files, /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i);
  const graphql = matches(files, /\.graphqls?$/i);
  const protos = matches(files, /\.proto$/i);
  const sql = matches(files, /(^|\/)(migrations?|repository)(\/|.*\/).*\.sql$/i);
  const adrs = matches(files, /(^|\/)(docs\/adr|adr)\/.*\.md$/i);
  const supportedAdrs = compatibleAdrs(root, adrs);
  const glossaries = matches(files, /(^|\/)glossary\.md$/i);
  // The app module is the one file a Celery project always has; the tasks
  // and the calls that enqueue them are found from there.
  const celery = matches(files, /(^|\/)celery\.py$/);
  const sqlRoots = [...new Set(sql.map((name) => {
    const segments = name.split("/");
    const repository = segments.findIndex((part) => /^(repository|repositories)$/i.test(part));
    return repository >= 0 ? segments.slice(0, repository + 1).join("/") : "";
  }).filter(Boolean))];
  const featureSql = sqlRoots.some((name) => /^internal\/[^/]+\/infrastructure\/repository$/i.test(name));
  const sqlRoot = sqlRoots.length === 1 && !featureSql ? sqlRoots[0] : "";
  const graphqlDirs = compactDirectories(graphql);
  const protoDirs = compactDirectories(protos);
  const projectMarkers = ["go.mod", "package.json", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "manage.py", "Dockerfile", "README.md"].filter((name) => files.has(name));
  const projectEvidence = projectMarkers.length ? projectMarkers : [[...files].sort()[0]].filter(Boolean);
  const goDomain = files.has("go.mod") ? goDomainEvidence(root, files) : "";
  const goHTTPClient = files.has("go.mod") ? goHTTPClientEvidence(root, files) : "";
  const goSOAPClient = files.has("go.mod") ? goSOAPClientEvidence(root, files) : "";
  const goRedis = files.has("go.mod") ? goRedisEvidence(root, files) : "";
  const tsDomain = files.has("package.json") ? laidOutDomainEvidence(root, files, "typescript") : "";
  const rustDomain = files.has("Cargo.toml") ? laidOutDomainEvidence(root, files, "rust") : "";
  const javaDomain = ["pom.xml", "build.gradle", "build.gradle.kts"].some((name) => files.has(name)) ? laidOutDomainEvidence(root, files, "java") : "";
  return [
    detected("project", projectEvidence, {}, projectEvidence.join(", ")),
    detected("go-domain", goDomain ? [goDomain] : [], {}, goDomain),
    detected("ts-domain", tsDomain ? [tsDomain] : [], {}, tsDomain),
    detected("rust-domain", rustDomain ? [rustDomain] : [], {}, rustDomain),
    detected("java-domain", javaDomain ? [javaDomain] : [], {}, javaDomain),
    detected("django-domain", files.has("manage.py") && matches(files, /(^|\/)models(?:\/[^/]+)?\.py$/i).length ? ["manage.py"] : []),
    detected("celery", celery, {}, celery[0]),
    detected("openapi", openapi, openapi[0] ? { spec: openapi[0] } : {}, openapi[0], true),
    detected(
      "wsdl",
      wsdls,
      {
        ...(wsdls.length === 1 ? { spec: wsdls[0] } : {}),
        ...(goSOAPClient ? { mode: "external" } : {}),
      },
      wsdls.length === 1 ? wsdls[0] : `${wsdls.length} WSDL documents`,
      true,
    ),
    detected("http-clients", goHTTPClient ? [goHTTPClient] : [], {}, goHTTPClient),
    detected("redis", goRedis ? [goRedis] : [], {}, goRedis),
    detected("river", goMod.includes("github.com/riverqueue/river") ? ["go.mod"] : [], {}, "go.mod · github.com/riverqueue/river"),
    detected("watermill", goMod.includes("github.com/ThreeDotsLabs/watermill") ? ["go.mod"] : [], {}, "go.mod · github.com/ThreeDotsLabs/watermill"),
    detected("asyncapi", asyncapi, asyncapi[0] ? { spec: asyncapi[0] } : {}, asyncapi[0], true),
    detected("graphql", graphql, graphqlDirs[0] ? { schema: graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0] } : {}, graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0]),
    detected("proto", protos, protoDirs.length ? { paths: protoDirs } : {}, protoDirs.join(", ")),
    detected("sql", sql, sqlRoot ? { repositories: sqlRoot } : {}, sqlRoot || (sqlRoots.length > 1 ? `${sqlRoots.length} repository packages` : sql[0])),
    detected(
      "adr",
      adrs,
      supportedAdrs[0] ? { files: [`${posix.dirname(supportedAdrs[0])}/*.md`] } : {},
      supportedAdrs[0] ? `${posix.dirname(supportedAdrs[0])}/*.md` : `${posix.dirname(adrs[0] ?? "docs/adr/x.md")}/*.md (format not recognized)`,
      !supportedAdrs.length,
      supportedAdrs.length > 0,
    ),
    detected("glossary", glossaries, glossaries.length ? { files: glossaries } : {}, glossaries.join(", ")),
  ].filter(Boolean);
}

export function discoverProject(workspace, input) {
  const { root, absolute } = safeRoot(workspace, input);
  const files = walk(absolute);
  const detections = detectionsFor(absolute, files);
  const components = componentCandidates(files);
  const id = slug(basename(absolute)) || "service";
  return {
    root,
    filesScanned: files.size,
    truncated: files.size >= MAX_FILES,
    components,
    componentsTruncated: components.length >= MAX_COMPONENTS,
    defaults: { id, name: id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), group: id, component: id, context: id, service: id },
    detections,
  };
}

function repositoryParts(repository) {
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

class LocalApiError extends Error {
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

function gitAuthEnvironment(repositories = []) {
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
    : `#!${process.execPath}\nconst process = require("node:process");\nconst credentials = JSON.parse(process.env.PORTOLAN_GIT_CREDENTIALS_JSON || "{}");\nconst prompt = String(process.argv[2] || "");\nconst authority = /https?:\\/\\/([^/'\"]+)/i.exec(prompt)?.[1];\nconst host = authority?.split("@").pop()?.replace(/:\\d+$/, "").toLowerCase();\nconst values = Object.values(credentials);\nconst credential = credentials[host] || (values.length === 1 ? values[0] : null);\nif (credential) process.stdout.write(String(/username/i.test(prompt) ? credential.username : credential.token));\n`;
  if (process.platform === "win32") {
    writeFileSync(join(holder, "askpass.mjs"), `import process from "node:process";\nconst credentials = JSON.parse(process.env.PORTOLAN_GIT_CREDENTIALS_JSON || "{}");\nconst prompt = String(process.argv[2] || "");\nconst authority = /https?:\\/\\/([^/'\"]+)/i.exec(prompt)?.[1];\nconst host = authority?.split("@").pop()?.replace(/:\\d+$/, "").toLowerCase();\nconst values = Object.values(credentials);\nconst credential = credentials[host] || (values.length === 1 ? values[0] : null);\nif (credential) process.stdout.write(String(/username/i.test(prompt) ? credential.username : credential.token));\n`);
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
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Repository has no ref \"${query}\".`);
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

function cleanSourcePath(sourcePath) {
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
  if (sourcePath && !lstatExists(join(checkout, sourcePath))) throw new Error(`Repository path \"${sourcePath}\" does not exist at ${commit.slice(0, 7)}.`);
  const discovery = discoverProject(workspace, root);
  return { repository: repo.value, ref, commit, sourcePath, checkoutRoot: root, discovery };
}

function lstatExists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function pluginOptions(plugin, project, detectedOptions = {}) {
  const group = project.group ?? project.context;
  const component = project.component ?? project.service;
  const common = { context: group, service: component };
  if (plugin === "project") {
    return {
      group,
      component,
      ...detectedOptions,
      componentName: project.name,
      ...(project.groupKind ? { groupKind: project.groupKind } : {}),
      ...(project.componentKind ? { componentKind: project.componentKind } : {}),
      ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}),
      out: "project.json",
    };
  }
  if (["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain"].includes(plugin)) {
    return { ...common, ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}), ...detectedOptions, serviceName: project.name, out: "domain.json" };
  }
  if (plugin === "sql") return { ...common, store: "pg", ...detectedOptions, out: "stores.json" };
  if (plugin === "redis") return { ...common, store: "redis", ...detectedOptions, out: "redis.json" };
  if (plugin === "openapi") return { ...common, ...detectedOptions, out: "api.json" };
  if (plugin === "wsdl") return { ...common, ...detectedOptions, out: "wsdl.json" };
  if (plugin === "http-clients") return { ...common, ...detectedOptions, out: "http-clients.json" };
  if (plugin === "river") return { ...common, ...detectedOptions, out: "river.json" };
  if (plugin === "watermill") return { ...common, ...detectedOptions, out: "watermill.json" };
  if (plugin === "asyncapi") return { ...common, ...detectedOptions, out: "bus.json" };
  if (plugin === "celery") return { ...common, ...detectedOptions, out: "celery.json" };
  if (plugin === "graphql") return { ...common, ...detectedOptions, out: "graphql.json" };
  if (plugin === "proto") return { ...common, ...detectedOptions, out: "proto.json" };
  if (plugin === "glossary") return { context: group, ...detectedOptions, out: "glossary.json" };
  if (plugin === "adr") return { ...detectedOptions, out: "adr.json" };
  return {};
}

export function planProject(workspace, manifest, request) {
  const external = request.source === "external";
  const repo = external ? repositoryParts(request.repository) : null;
  const sourcePath = external ? cleanSourcePath(request.sourcePath) : "";
  if (external && !/^[0-9a-f]{40}$/i.test(String(request.commit ?? ""))) throw new Error("Inspect the repository to resolve an immutable commit first.");
  const inspectedRoot = external ? inspectionRoot(repo.value, String(request.commit), sourcePath) : request.root;
  const discovery = discoverProject(workspace, inspectedRoot);
  const declared = new Set([
    ...builtinPluginNames(),
    ...(manifest.plugins ?? []).map((plugin) => plugin.name),
  ]);
  const detected = new Set(discovery.detections.map((item) => item.plugin));
  const requested = Array.isArray(request.plugins) ? request.plugins : [];
  const plugins = [...new Set(requested)].filter((plugin) => detected.has(plugin) && declared.has(plugin));
  if (plugins.length === 0) throw new Error("Select at least one detected plugin that is declared in portolan.json.");
  const id = slug(String(request.id ?? ""));
  if (!id) throw new Error("Project id must contain letters or numbers.");
  if ((manifest.projects ?? []).some((project) => project.id === id)) throw new Error(`Project id \"${id}\" already exists.`);
  const finalRoot = external
    ? ["vendor", "repos", repo.owner, repo.name, sourcePath].filter(Boolean).join("/")
    : discovery.root;
  if ((manifest.projects ?? []).some((project) => project.root === finalRoot)) throw new Error(`Project path \"${finalRoot}\" already exists.`);
  const project = {
    id,
    name: String(request.name ?? "").trim() || discovery.defaults.name,
    root: finalRoot,
    ...(String(request.group ?? request.context ?? "").trim() ? { group: slug(String(request.group ?? request.context)) } : {}),
    ...(String(request.component ?? request.service ?? "").trim() ? { component: slug(String(request.component ?? request.service)) } : {}),
    ...(String(request.groupKind ?? "").trim() ? { groupKind: String(request.groupKind).trim() } : {}),
    ...(String(request.componentKind ?? "").trim() ? { componentKind: String(request.componentKind).trim() } : {}),
    ...(String(request.repository ?? "").trim() ? { repository: String(request.repository).trim() } : {}),
  };
  const out = `${finalRoot}/portolan`;
  const detectionByPlugin = new Map(discovery.detections.map((item) => [item.plugin, item]));
  const hasDomainModel = plugins.some((plugin) => ["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain"].includes(plugin));
  const steps = plugins.map((plugin) => ({
    plugin,
    in: finalRoot,
    out,
    options: pluginOptions(
      plugin,
      project,
      plugin === "project"
        ? { groupKind: hasDomainModel ? "bounded-context" : "system", ...(hasDomainModel ? { componentKind: "service" } : {}) }
        : detectionByPlugin.get(plugin)?.options,
    ),
  }));
  const source = external ? "vendor/repos/**/portolan/*.json" : `${out}/*.json`;
  const fetch = external ? { repo: repo.value, commit: String(request.commit), paths: sourcePath ? [sourcePath] : [] } : null;
  return { project, plugins, steps, source, discovery, fetch };
}

function manifestWithProject(manifest, plan, { isolated = false } = {}) {
  const fetchIndex = (manifest.extract ?? []).findIndex((step) => step.plugin === "git");
  const extract = isolated ? [] : [...(manifest.extract ?? [])];
  if (plan.fetch) {
    if (!builtinPluginNames().has("git") && !manifest.plugins?.some((plugin) => plugin.name === "git")) throw new Error("The built-in git fetcher is not available.");
    if (!isolated && fetchIndex >= 0) {
      const fetchStep = extract[fetchIndex];
      extract[fetchIndex] = { ...fetchStep, options: { ...fetchStep.options, repos: [...(fetchStep.options?.repos ?? []), plan.fetch] } };
    } else {
      extract.unshift({ plugin: "git", in: "vendor", out: "vendor/repos", options: { cache: "vendor/repos", repos: [plan.fetch] } });
    }
  }
  extract.push(...plan.steps);
  return {
    ...manifest,
    projects: isolated ? [plan.project] : [...(manifest.projects ?? []), plan.project],
    sources: isolated
      ? [...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source]
      : [...new Set([...(manifest.sources ?? []), ...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source])],
    extract,
    ...(isolated ? { verify: [], generate: [] } : {}),
  };
}

function writeManifest(path, manifest) {
  const staging = mkdtempSync(join(dirname(path), ".portolan-manifest-"));
  const temp = join(staging, "portolan.json");
  try {
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    const validation = loadManifest(temp);
    if (validation.problems.length) throw new Error(validation.problems.join("\n"));
    renameSync(temp, path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function writeProject(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const plan = planProject(workspace, manifest, request);
  writeManifest(manifestPath, manifestWithProject(manifest, plan));
  return plan;
}

function setup(workspace) {
  const manifestText = readFileSync(join(workspace, "portolan.json"), "utf8");
  let report;
  try { report = JSON.parse(readFileSync(join(workspace, ".portolan/build-report.json"), "utf8")); } catch {}
  return publicSetupFrom(JSON.parse(manifestText), report, createHash("sha256").update(manifestText).digest("hex"));
}

function send(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value)}\n`);
}

async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64 * 1024) throw new Error("Request body is too large.");
  }
  return text ? JSON.parse(text) : {};
}

function localRequest(req) {
  const address = req.socket.remoteAddress ?? "";
  const localAddress = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const authority = String(req.headers.host ?? "");
  const host = authority.startsWith("[") ? authority.slice(1, authority.indexOf("]")) : authority.split(":")[0];
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  let localOrigin = true;
  if (req.headers.origin) {
    try { localOrigin = ["localhost", "127.0.0.1", "::1"].includes(new URL(req.headers.origin).hostname); }
    catch { localOrigin = false; }
  }
  return localAddress && localHost && localOrigin;
}

function emit(job, event) {
  const enriched = { at: new Date().toISOString(), ...event };
  job.events.push(enriched);
  for (const response of job.subscribers) response.write(`data: ${JSON.stringify(enriched)}\n\n`);
}

function feed(job, stream, chunk) {
  job.buffers[stream] += String(chunk);
  const lines = job.buffers[stream].split(/\r?\n/);
  job.buffers[stream] = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(GENERATOR_EVENT_PREFIX)) {
      try { emit(job, JSON.parse(line.slice(GENERATOR_EVENT_PREFIX.length))); } catch { emit(job, { type: "log", stream, message: line }); }
    } else emit(job, { type: "log", stream, message: line });
  }
}

function workspaceFingerprint(workspace) {
  const hash = createHash("sha256");
  try {
    const options = { cwd: workspace, encoding: "buffer", maxBuffer: 128 * 1024 * 1024 };
    hash.update(execFileSync("git", ["diff", "--binary", "HEAD", "--", "."], options));
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options)
      .toString().split("\0").filter(Boolean).sort();
    for (const name of untracked) {
      hash.update(name); hash.update("\0");
      try { hash.update(readFileSync(join(workspace, name))); } catch {}
    }
  } catch {
    const pending = [workspace];
    const files = [];
    while (pending.length) {
      const dir = pending.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SNAPSHOT_SKIP.has(entry.name) || entry.name === "build" && relative(workspace, dir).startsWith("plugins")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    for (const path of files.sort()) { hash.update(relative(workspace, path)); hash.update("\0"); hash.update(readFileSync(path)); }
  }
  return hash.digest("hex");
}

function snapshotWorkspace(workspace) {
  const holder = mkdtempSync(join(tmpdir(), "portolan-preview-"));
  const snapshot = join(holder, "workspace");
  cpSync(workspace, snapshot, {
    recursive: true,
    filter(source) {
      const name = relative(workspace, source).replaceAll(sep, "/");
      if (!name) return true;
      return !name.split("/").some((segment) => SNAPSHOT_SKIP.has(segment) || segment === "build" && name.startsWith("plugins/"));
    },
  });
  symlinkSync(join(workspace, "node_modules"), join(snapshot, "node_modules"), "dir");
  const gitMetadata = join(workspace, ".git");
  if (lstatExists(gitMetadata)) symlinkSync(gitMetadata, join(snapshot, ".git"), lstatSync(gitMetadata).isDirectory() ? "dir" : "file");
  return { holder, snapshot };
}

function fileDiff(workspace, snapshot, change) {
  const before = join(workspace, change.path);
  const after = join(snapshot, change.path);
  const left = lstatExists(before) ? before : "/dev/null";
  const right = lstatExists(after) ? after : "/dev/null";
  if ((lstatExists(before) && statSync(before).size > 512_000) || (lstatExists(after) && statSync(after).size > 512_000)) {
    return { path: change.path, status: change.kind, diff: "Binary or large file changed; textual diff omitted." };
  }
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", left, right], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  } catch (cause) {
    if (cause?.status !== 1) throw cause;
    diff = String(cause.stdout ?? "");
  }
  const portable = diff
    .replaceAll(`a${before}`, `a/${change.path}`)
    .replaceAll(`b${after}`, `b/${change.path}`)
    .replaceAll(before, change.path)
    .replaceAll(after, change.path);
  return { path: change.path, status: change.kind, diff: portable.slice(0, 200_000) };
}

export function diffGeneratedFiles(workspace, snapshot, events) {
  const changes = new Map();
  for (const event of events) {
    if (event.type !== "step-finished") continue;
    for (const change of event.changes ?? []) changes.set(change.path, change);
  }
  const all = [...changes.values()];
  let remaining = 2 * 1024 * 1024;
  let contentTruncated = false;
  const shown = all.slice(0, 100).map((change) => {
    const file = fileDiff(workspace, snapshot, change);
    if (file.diff.length > remaining) { file.diff = `${file.diff.slice(0, Math.max(0, remaining))}\n… diff truncated`; contentTruncated = true; }
    remaining = Math.max(0, remaining - file.diff.length);
    return file;
  });
  return { files: shown, totalFiles: all.length, truncated: all.length > shown.length || contentTruncated };
}

const TRIAL_FACTS = [
  ["contexts", "contexts"],
  ["services", "components"],
  ["contracts", "API contracts"],
  ["apiOperations", "API operations"],
  ["integrations", "integrations"],
  ["aggregates", "aggregates"],
  ["entities", "entities"],
  ["domainOperations", "domain operations"],
  ["events", "domain events"],
  ["channels", "message channels"],
  ["messages", "messages"],
  ["stores", "data stores"],
  ["tables", "tables"],
  ["keyPatterns", "key patterns"],
  ["flows", "flows"],
  ["adrs", "ADRs"],
  ["terms", "glossary terms"],
];

/** Summarise the catalog facts written by a project's selected extractors. */
export function summarizeProjectTrial(snapshot, plan, events) {
  const stepOutputs = new Set(plan.steps.map((step) => step.out));
  const steps = events
    .filter((event) => event.type === "step-finished" && event.phase === "extract" && stepOutputs.has(event.output) && plan.plugins.includes(event.plugin))
    .map((event) => ({
      plugin: event.plugin,
      status: event.status,
      durationMs: event.durationMs,
      fileCount: event.fileCount,
      changedCount: event.changedCount,
      warnings: event.warnings ?? [],
      ...(event.message ? { message: event.message } : {}),
    }));
  const facts = new Map(TRIAL_FACTS.map(([key]) => [key, new Set()]));
  const add = (key, id) => { if (id !== undefined && id !== null && String(id)) facts.get(key)?.add(String(id)); };
  const visitService = (service, contextId = "") => {
    const serviceId = service.id ?? `${contextId}/${service.slug ?? service.name ?? "service"}`;
    add("services", serviceId);
    for (const contract of service.provides ?? []) {
      const contractId = `${serviceId}/${contract.id ?? contract.name ?? "contract"}`;
      add("contracts", contractId);
      for (const method of contract.methods ?? []) add("apiOperations", `${contractId}/${method.name ?? method.id}`);
    }
    for (const integration of service.consumes ?? []) add("integrations", `${serviceId}/${integration.id ?? integration.peer ?? JSON.stringify(integration)}`);
    for (const aggregate of service.aggregates ?? []) {
      add("aggregates", aggregate.id ?? `${serviceId}/${aggregate.slug ?? aggregate.name}`);
      for (const entity of aggregate.entities ?? []) add("entities", entity.id ?? `${serviceId}/${entity.name}`);
      for (const event of aggregate.events ?? []) add("events", event.id ?? `${serviceId}/${event.name}`);
      for (const operation of aggregate.operations ?? []) add("domainOperations", `${serviceId}/${aggregate.id ?? "aggregate"}/${operation.name ?? operation.id}`);
    }
    for (const channel of service.channels ?? []) {
      const channelId = `${serviceId}/${channel.address ?? channel.name ?? "channel"}`;
      add("channels", channelId);
      for (const message of channel.messages ?? []) add("messages", `${channelId}/${message.name ?? message.id}`);
    }
  };
  const files = [...new Set(events
    .filter((event) => event.type === "step-finished" && event.phase === "extract" && stepOutputs.has(event.output) && plan.plugins.includes(event.plugin))
    .flatMap((event) => event.files ?? []))];
  for (const name of files) {
    let fragment;
    try { fragment = JSON.parse(readFileSync(join(snapshot, name), "utf8")); } catch { continue; }
    for (const context of fragment.contexts ?? []) {
      const contextId = context.id ?? context.slug ?? context.name;
      add("contexts", contextId);
      for (const service of context.services ?? []) visitService(service, contextId);
    }
    for (const store of fragment.stores ?? []) {
      const storeId = store.id ?? store.slug ?? store.name;
      add("stores", storeId);
      for (const table of store.tables ?? []) add("tables", `${storeId}/${table.id ?? table.name}`);
      for (const pattern of store.keyspaces ?? store.keyPatterns ?? store.keys ?? []) add("keyPatterns", `${storeId}/${pattern.id ?? pattern.pattern ?? pattern.name ?? JSON.stringify(pattern)}`);
    }
    for (const flow of fragment.flows ?? []) add("flows", flow.id ?? flow.slug ?? flow.name);
    for (const adr of fragment.adrs ?? []) add("adrs", adr.id ?? adr.slug ?? adr.title);
    for (const term of fragment.terms ?? []) add("terms", term.id ?? term.slug ?? term.name);
  }
  const warnings = steps.flatMap((step) => step.warnings.map((message) => ({ plugin: step.plugin, message })));
  return {
    steps,
    facts: TRIAL_FACTS.map(([key, label]) => ({ key, label, count: facts.get(key)?.size ?? 0 })).filter((fact) => fact.count > 0),
    warnings,
    generatedFiles: files.length,
  };
}

function prepareProjectTrial(workspace, request) {
  const manifest = JSON.parse(readFileSync(join(workspace, "portolan.json"), "utf8"));
  const plan = planProject(workspace, manifest, request);
  const fingerprint = workspaceFingerprint(workspace);
  const snapshot = snapshotWorkspace(workspace);
  if (workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the trial workspace was being created. Try again.");
  }
  writeManifest(join(snapshot.snapshot, "portolan.json"), manifestWithProject(manifest, plan, { isolated: true }));
  return { ...snapshot, fingerprint, plan };
}

function freeLocalPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForPreview(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.previewError) throw child.previewError;
    if (child.exitCode !== null) throw new Error("The preview server stopped before it became ready.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("The preview server did not become ready in time.");
}

function disposeProjectTrial(job) {
  if (job.previewTimer) { clearTimeout(job.previewTimer); job.previewTimer = null; }
  if (job.previewChild?.exitCode === null) job.previewChild.kill("SIGTERM");
  job.previewChild = null;
  job.previewUrl = null;
  if (job.snapshotHolder && lstatExists(job.snapshotHolder)) rmSync(job.snapshotHolder, { recursive: true, force: true });
  job.snapshotHolder = null;
  job.runRoot = null;
}

async function startProjectPreview(job) {
  const port = await freeLocalPort();
  const origin = `http://127.0.0.1:${port}`;
  const cli = process.env.PORTOLAN_CLI;
  const command = cli ? process.execPath : join(job.runRoot, "node_modules/vite/bin/vite.js");
  const args = cli
    ? [cli, "dev", "--cwd", job.runRoot, "--host", "127.0.0.1", "--port", String(port)]
    : ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const child = spawn(command, args, {
    cwd: job.runRoot,
    env: { ...process.env, PORTOLAN_PROJECT_PREVIEW: "1", ...(cli ? { PORTOLAN_CLI: cli } : {}) },
    stdio: "ignore",
  });
  child.once("error", (error) => { child.previewError = error; });
  job.previewChild = child;
  await waitForPreview(origin, child);
  const context = job.projectPlan.project.group ?? job.projectPlan.discovery.defaults.group;
  const component = job.projectPlan.project.component ?? job.projectPlan.discovery.defaults.component;
  job.previewUrl = `${origin}/c/${encodeURIComponent(context)}/${encodeURIComponent(component)}`;
  job.previewTimer = setTimeout(() => disposeProjectTrial(job), PROJECT_PREVIEW_TTL_MS);
  job.previewTimer.unref();
  return job.previewUrl;
}

function startJob(workspace, mode, approvedPreview, preparedTrial) {
  const id = randomUUID();
  const preview = mode === "preview" || mode === "project-preview";
  const fingerprint = preparedTrial?.fingerprint ?? (preview ? workspaceFingerprint(workspace) : approvedPreview?.fingerprint);
  const snapshot = preparedTrial ?? (preview ? snapshotWorkspace(workspace) : null);
  if (preview && !preparedTrial && workspaceFingerprint(workspace) !== fingerprint) {
    rmSync(snapshot.holder, { recursive: true, force: true });
    throw new Error("Files changed while the preview workspace was being created. Try again.");
  }
  const generatedAt = preview ? new Date().toISOString() : approvedPreview?.generatedAt;
  const gitAuth = gitAuthEnvironment();
  const job = { id, mode, status: "running", events: [], subscribers: new Set(), buffers: { stdout: "", stderr: "" }, child: null, gitAuth, runRoot: snapshot?.snapshot ?? workspace, snapshotHolder: snapshot?.holder ?? null, fingerprint, generatedAt, projectPlan: preparedTrial?.plan ?? null, projectRequest: preparedTrial ? structuredClone(preparedTrial.request) : null };
  jobs.set(id, job);
  const cli = process.env.PORTOLAN_CLI;
  const command = cli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = cli
    ? [cli, mode === "check" ? "check" : "generate", "--cwd", job.runRoot]
    : ["run", mode === "check" ? "gen:check" : "gen"];
  let child;
  try {
    child = spawn(command, args, {
      cwd: job.runRoot,
      env: { ...gitAuth.env, PORTOLAN_EVENTS: "1", ...(generatedAt ? { PORTOLAN_GENERATED_AT: generatedAt } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (cause) {
    gitAuth.dispose();
    jobs.delete(id);
    throw cause;
  }
  job.child = child;
  emit(job, { type: "run-started", runId: id, mode });
  child.stdout.on("data", (chunk) => feed(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => feed(job, "stderr", chunk));
  child.on("error", (error) => emit(job, { type: "run-finished", status: "failed", message: error.message }));
  child.on("close", async (code, signal) => {
    job.gitAuth.dispose();
    job.gitAuth = null;
    for (const stream of ["stdout", "stderr"]) if (job.buffers[stream]) emit(job, { type: "log", stream, message: job.buffers[stream] });
    job.status = signal ? "cancelled" : code === 0 ? "ok" : "failed";
    if (preview && job.status !== "cancelled") {
      try { job.preview = diffGeneratedFiles(workspace, job.runRoot, job.events); emit(job, { type: "preview-ready", ...job.preview }); }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not build preview: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    if (mode === "project-preview" && job.status === "ok") {
      try {
        job.trial = summarizeProjectTrial(job.runRoot, job.projectPlan, job.events);
        try { job.trial.previewUrl = await startProjectPreview(job); }
        catch (cause) { job.trial.previewError = cause instanceof Error ? cause.message : String(cause); }
        emit(job, { type: "project-trial-ready", plan: job.projectPlan, ...job.trial });
      }
      catch (cause) { job.status = "failed"; emit(job, { type: "log", stream: "stderr", message: `Could not summarise project trial: ${cause instanceof Error ? cause.message : String(cause)}` }); }
    }
    emit(job, { type: "process-finished", status: job.status, code, signal });
    for (const response of job.subscribers) response.end();
    job.subscribers.clear();
    if (job.snapshotHolder && !(mode === "project-preview" && job.status === "ok" && job.previewUrl)) disposeProjectTrial(job);
  });
  return job;
}

function startProjectTrial(workspace, request) {
  const prepared = prepareProjectTrial(workspace, request);
  prepared.request = request;
  try { return startJob(workspace, "project-preview", null, prepared); }
  catch (cause) { rmSync(prepared.holder, { recursive: true, force: true }); throw cause; }
}

export function localApiPlugin(workspace = process.cwd()) {
  return {
    name: "portolan-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(LOCAL_API_PREFIX)) return next();
        if (!localRequest(req)) return send(res, 403, { error: "The local API is available only through localhost." });
        try {
          if (req.method === "GET" && url.pathname === `${LOCAL_API_PREFIX}/status`) {
            const active = [...jobs.values()].find((job) => job.status === "running");
            return send(res, 200, { local: true, workspace: realpathSync(workspace), setup: setup(workspace), activeRun: active ? { id: active.id, mode: active.mode } : null });
          }
          const eventMatch = url.pathname.match(/^\/__portolan\/runs\/([^/]+)\/events$/);
          if (req.method === "GET" && eventMatch) {
            const job = jobs.get(eventMatch[1]);
            if (!job) return send(res, 404, { error: "Generation run not found." });
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (job.status === "running") job.subscribers.add(res); else res.end();
            req.on("close", () => job.subscribers.delete(res));
            return;
          }
          if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json" || req.headers["x-portolan-local"] !== "1") {
            return send(res, 405, { error: "Use a local JSON request." });
          }
          const input = await body(req);
          if (url.pathname === `${LOCAL_API_PREFIX}/source`) return send(res, 200, readLocalSource(workspace, input.path));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/credentials`) return send(res, 201, storeRepositoryCredential(input));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/credentials/forget`) return send(res, 200, forgetRepositoryCredential(input));
          if (url.pathname === `${LOCAL_API_PREFIX}/repositories/prepare`) return send(res, 200, prepareRepository(workspace, input));
          if (url.pathname === `${LOCAL_API_PREFIX}/discover`) return send(res, 200, discoverProject(workspace, input.path));
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/trials`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const job = startProjectTrial(workspace, input);
            return send(res, 202, { runId: job.id, mode: job.mode, plan: job.projectPlan });
          }
          const applyTrialMatch = url.pathname.match(/^\/__portolan\/projects\/trials\/([^/]+)\/apply$/);
          if (applyTrialMatch) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const trial = jobs.get(applyTrialMatch[1]);
            if (!trial?.projectRequest || !trial.trial || trial.status !== "ok") return send(res, 409, { error: "Run a successful project trial before adding it." });
            if (trial.applied) return send(res, 409, { error: "This project trial was already applied." });
            if (workspaceFingerprint(workspace) !== trial.fingerprint) return send(res, 409, { error: "Files changed after this project trial. Run it again." });
            disposeProjectTrial(trial);
            const result = writeProject(workspace, trial.projectRequest);
            trial.applied = true;
            const generation = input.generate ? startJob(workspace, "write", trial) : null;
            return send(res, 201, { ...result, setup: setup(workspace), run: generation ? { runId: generation.id, mode: generation.mode } : null });
          }
          const disposeTrialMatch = url.pathname.match(/^\/__portolan\/projects\/trials\/([^/]+)\/dispose$/);
          if (disposeTrialMatch) {
            const trial = jobs.get(disposeTrialMatch[1]);
            if (!trial?.projectRequest) return send(res, 404, { error: "Project trial not found." });
            if (trial.status === "running") return send(res, 409, { error: "Cancel the running project trial first." });
            disposeProjectTrial(trial);
            return send(res, 200, { runId: trial.id, status: "disposed" });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects/preview`) {
            const manifest = JSON.parse(readFileSync(join(workspace, "portolan.json"), "utf8"));
            return send(res, 200, planProject(workspace, manifest, input));
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/projects`) {
            const result = writeProject(workspace, input);
            return send(res, 201, { ...result, setup: setup(workspace) });
          }
          if (url.pathname === `${LOCAL_API_PREFIX}/runs`) {
            if ([...jobs.values()].some((job) => job.status === "running")) return send(res, 409, { error: "A generator run is already active." });
            const mode = ["check", "preview"].includes(input.mode) ? input.mode : "write";
            let approvedPreview = null;
            if (mode === "write") {
              approvedPreview = jobs.get(input.previewRunId);
              if (!approvedPreview?.preview || approvedPreview.status !== "ok") return send(res, 409, { error: "Preview the generated diff before applying it." });
              if (workspaceFingerprint(workspace) !== approvedPreview.fingerprint) return send(res, 409, { error: "Files changed after this preview. Run the preview again." });
            }
            const job = startJob(workspace, mode, approvedPreview);
            return send(res, 202, { runId: job.id, mode });
          }
          const cancelMatch = url.pathname.match(/^\/__portolan\/runs\/([^/]+)\/cancel$/);
          if (cancelMatch) {
            const job = jobs.get(cancelMatch[1]);
            if (!job || job.status !== "running") return send(res, 404, { error: "Active generation run not found." });
            if (process.platform !== "win32" && job.child.pid) process.kill(-job.child.pid, "SIGTERM");
            else job.child.kill("SIGTERM");
            return send(res, 202, { runId: job.id, status: "cancelling" });
          }
          return send(res, 404, { error: "Local API route not found." });
        } catch (error) {
          return send(res, error instanceof LocalApiError ? error.status : 400, {
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof LocalApiError ? {
              code: error.code,
              retryable: error.retryable,
              provider: error.provider,
              host: error.host,
              credentialSupported: error.credentialSupported,
              credentialPresent: error.credentialPresent,
            } : {}),
          });
        }
      });
    },
  };
}
