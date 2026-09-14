import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import optionsSchema from "./fetch-github-rfcs.options.json" with { type: "json" };

export const TOKEN_ENV = "GITHUB_TOKEN";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";
export const FRAGMENT_NAME = "github.rfcs.json";
export const LOCK_NAME = "github.rfcs.lock.json";

const BUILTIN = new Map([
  ["draft", "draft"],
  ["prediscussion", "draft"],
  ["ideation", "draft"],
  ["open", "discussion"],
  ["discussion", "discussion"],
  ["in review", "discussion"],
  ["needs-discussion", "discussion"],
  ["accepted", "accepted"],
  ["approved", "accepted"],
  ["active", "accepted"],
  ["published", "accepted"],
  ["merged", "accepted"],
  ["resolution/merge", "accepted"],
  ["implemented", "implemented"],
  ["committed", "implemented"],
  ["complete", "implemented"],
  ["rejected", "rejected"],
  ["closed", "rejected"],
  ["resolution/close", "rejected"],
  ["postponed", "postponed"],
  ["deferred", "postponed"],
  ["resolution/postpone", "postponed"],
  ["withdrawn", "withdrawn"],
  ["abandoned", "abandoned"],
  ["superseded", "superseded"],
]);

export function describe() {
  return {
    name: "fetch-github-rfcs",
    summary:
      "Imports RFCs kept as GitHub issues or pull requests, including their exact source status and discussion link.",
    category: "sources",
    phases: ["extract"],
    options: optionsSchema,
  };
}

export async function run(
  request,
  { env = process.env, fetch: fetchFn = globalThis.fetch } = {},
) {
  const options = request.options ?? {};
  requireOptions(options);
  if (offline(env)) return cached(options.cache, "offline");
  try {
    const issues = await fetchIssues(
      options,
      String(env[TOKEN_ENV] ?? "").trim(),
      fetchFn,
    );
    const records = issues
      .filter((issue) => selected(issue, options))
      .map((issue) => record(issue, options));
    const unknown = records.filter((rfc) => rfc.lifecycle === "unknown");
    const contents = fragment(records);
    const lock = {
      repo: options.repo,
      count: records.length,
      sha256: digest(contents),
    };
    return {
      files: [
        { name: FRAGMENT_NAME, contents },
        { name: LOCK_NAME, contents: `${JSON.stringify(lock, null, 2)}\n` },
      ],
      warnings: unknown.map((rfc) => ({
        ref: rfc.source,
        message: `source status ${JSON.stringify(rfc.status)} has no lifecycle mapping; kept as unknown`,
      })),
    };
  } catch (cause) {
    return cached(
      options.cache,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

export function record(issue, options) {
  const pullRequest = Boolean(issue.pull_request);
  const labels = (issue.labels ?? [])
    .map((label) =>
      typeof label === "string" ? label : String(label?.name ?? ""),
    )
    .filter(Boolean);
  const configured = new Map(
    Object.entries(options.statusMap ?? {}).map(([key, value]) => [
      key.trim().toLowerCase(),
      value,
    ]),
  );
  const status =
    labels.find((label) => {
      const key = label.trim().toLowerCase();
      return configured.has(key) || BUILTIN.has(key);
    }) ??
    (pullRequest && issue.merged_at
      ? "merged"
      : String(issue.state ?? "unknown"));
  const lifecycle =
    configured.get(status.trim().toLowerCase()) ??
    BUILTIN.get(status.trim().toLowerCase()) ??
    "unknown";
  const prefix = String(options.prefix ?? "RFC").toUpperCase();
  const idPrefix = String(
    options.idPrefix ?? options.repo.toLowerCase().replace(/[^a-z0-9]+/g, "."),
  ).replace(/^\.+|\.+$/g, "");
  const titlePrefix = String(options.titlePrefix ?? "").trim();
  let title = String(issue.title ?? "").trim();
  if (titlePrefix && title.toLowerCase().startsWith(titlePrefix.toLowerCase()))
    title =
      title
        .slice(titlePrefix.length)
        .replace(/^\s*[:—-]\s*/, "")
        .trim() || title;
  return {
    id: `${idPrefix}.rfc.${issue.number}`,
    slug: slug(`${idPrefix}-rfc-${issue.number}-${title}`),
    displayId: `${prefix}-${issue.number}`,
    number: String(issue.number),
    title,
    status,
    lifecycle,
    scope: scopeOf(options.scope),
    body: String(issue.body ?? "").trimEnd() + "\n",
    authors: issue.user?.login ? [`@${issue.user.login}`] : [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    ...(issue.merged_at || issue.closed_at
      ? { resolvedAt: issue.merged_at ?? issue.closed_at }
      : {}),
    discussionUrl: issue.html_url,
    sourceKind: pullRequest ? "github-pr" : "github-issue",
    repository: `github.com/${options.repo}`,
    source: issue.html_url,
    relates: {},
  };
}

export function fragment(records) {
  return `${JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [], rfcs: records }, null, 2)}\n`;
}

async function fetchIssues(options, token, fetchFn) {
  const out = [];
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "portolan",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      state: options.state ?? "all",
      per_page: "100",
      page: String(page),
    });
    if (options.labels?.length) params.set("labels", options.labels.join(","));
    const url = `https://api.github.com/repos/${options.repo}/issues?${params}`;
    const response = await fetchFn(url, { headers });
    if (!response.ok)
      throw new Error(`GitHub ${response.status} ${response.statusText}`);
    const pageItems = await response.json();
    if (!Array.isArray(pageItems))
      throw new Error("GitHub issues response is not a list");
    out.push(...pageItems);
    if (pageItems.length < 100) {
      const pullRequests = out.filter(
        (issue) => issue.pull_request && options.kind !== "issue",
      );
      await Promise.all(
        pullRequests.map(async (issue) => {
          const detail = await fetchFn(
            `https://api.github.com/repos/${options.repo}/pulls/${issue.number}`,
            { headers },
          );
          if (!detail.ok)
            throw new Error(`GitHub ${detail.status} ${detail.statusText}`);
          Object.assign(issue, await detail.json());
        }),
      );
      return out;
    }
  }
}

function selected(issue, options) {
  const pull = Boolean(issue.pull_request);
  if (options.kind === "issue" && pull) return false;
  if (options.kind === "pull-request" && !pull) return false;
  if (
    options.titlePrefix &&
    !String(issue.title ?? "")
      .toLowerCase()
      .startsWith(String(options.titlePrefix).toLowerCase())
  )
    return false;
  if (options.labels?.length) {
    const held = new Set(
      (issue.labels ?? []).map((label) =>
        String(label?.name ?? label).toLowerCase(),
      ),
    );
    if (!options.labels.every((label) => held.has(String(label).toLowerCase())))
      return false;
  }
  return true;
}

function requireOptions(options) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(options.repo ?? "")))
    throw new Error("repo must be owner/name");
  if (!options.cache) throw new Error("cache is required");
  scopeOf(options.scope);
  if (!options.labels?.length && !String(options.titlePrefix ?? "").trim())
    throw new Error(
      "labels or titlePrefix is required so ordinary issues are not imported as RFCs",
    );
}

function scopeOf(value) {
  const scope = String(value ?? "").trim();
  if (!scope || scope === "org") return { kind: "org" };
  const parts = scope.split(".");
  if (
    parts.length === 1 &&
    parts.every((part) => /^[a-z][a-z0-9-]*$/.test(part))
  )
    return { kind: "context", context: scope };
  if (
    parts.length === 2 &&
    parts.every((part) => /^[a-z][a-z0-9-]*$/.test(part))
  )
    return { kind: "service", service: scope };
  throw new Error("scope must be org, a context, or <context>.<service>");
}

function cached(dir, why) {
  try {
    const lock = JSON.parse(readFileSync(join(dir, LOCK_NAME), "utf8"));
    const contents = readFileSync(join(dir, FRAGMENT_NAME), "utf8");
    if (digest(contents) !== lock.sha256)
      throw new Error(`${FRAGMENT_NAME} does not match its digest`);
    return {
      files: [
        { name: FRAGMENT_NAME, contents },
        { name: LOCK_NAME, contents: `${JSON.stringify(lock, null, 2)}\n` },
      ],
      warnings: [
        {
          ref: lock.repo,
          message: `not fetched (${why}); the committed snapshot is used unchanged`,
        },
      ],
    };
  } catch (cause) {
    throw new Error(
      `GitHub RFCs could not be read (${why}) and there is no usable snapshot (${cause.message})`,
    );
  }
}

const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const digest = (contents) =>
  createHash("sha256").update(contents).digest("hex");
const offline = (env) =>
  Boolean(String(env[OFFLINE_ENV] ?? "").trim()) ||
  !["", "0", "false"].includes(
    String(env.CI ?? "")
      .trim()
      .toLowerCase(),
  );
