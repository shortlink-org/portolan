// Puts the architecture diff on the pull request it describes.
//
//   node scripts/forge-comment.mjs <markdown file>
//
// One comment per pull request, updated in place: the body starts with a
// marker only this script writes, and the next run finds that comment and
// replaces it rather than adding another, so a PR pushed to twenty times has
// one report and it is the current one.
//
// Where it is running is read off the CI's own variables, the same way
// vite.config.ts reads the build stamp. GitHub Actions hands over the event
// (GITHUB_EVENT_PATH) and a token that can write comments on a pull request
// from the same repository; GitLab CI hands over the merge request's iid but
// its job token cannot write notes, so a project access token is expected as
// PORTOLAN_TOKEN. Anything else, or no pull request at all, and this says so
// on stderr and exits 0: the diff describes a change and never fails one, and
// neither does the step that posts it. A refusal by the forge (a fork's
// read-only token) is the same silence; any other failed request is an error,
// because a broken configuration should be seen once, by whoever set it up.

import { readFileSync } from "node:fs";

export const MARKER = "<!-- portolan:architecture-diff -->";

const PAGE = 100;

/**
 * Which forge, which pull request, and with what - or the reason there is
 * none. `event` is the parsed GitHub event payload when there is one.
 */
export function forgeFromEnv(env, event = null) {
  if (env.GITHUB_ACTIONS === "true" || env.GITHUB_REPOSITORY) {
    const number =
      event?.pull_request?.number ??
      Number(/^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1]);
    if (!number) return { reason: "not a pull request" };
    if (!env.GITHUB_TOKEN) return { reason: "GITHUB_TOKEN is not set" };

    return {
      provider: "github",
      api: (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, ""),
      repo: env.GITHUB_REPOSITORY,
      number,
      token: env.GITHUB_TOKEN,
    };
  }

  if (env.GITLAB_CI === "true" || env.CI_API_V4_URL) {
    if (!env.CI_MERGE_REQUEST_IID) return { reason: "not a merge request pipeline" };
    if (!env.PORTOLAN_TOKEN) return { reason: "PORTOLAN_TOKEN is not set" };

    return {
      provider: "gitlab",
      api: env.CI_API_V4_URL.replace(/\/$/, ""),
      project: env.CI_PROJECT_ID,
      number: Number(env.CI_MERGE_REQUEST_IID),
      token: env.PORTOLAN_TOKEN,
    };
  }

  return { reason: "not running under GitHub Actions or GitLab CI" };
}

/** The comment's body: the marker first, so the next run can find it. */
export function body(markdown) {
  return MARKER + "\n" + markdown.trimEnd() + "\n";
}

/** The comment this script wrote last time, if any. */
export function findOwn(comments) {
  return comments.find((comment) => (comment.body ?? "").startsWith(MARKER)) ?? null;
}

/** The requests each forge answers: list, create, update. */
function routes(forge) {
  if (forge.provider === "github") {
    const base = `${forge.api}/repos/${forge.repo}/issues/${forge.number}/comments`;

    return {
      headers: {
        authorization: `Bearer ${forge.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      list: (page) => `${base}?per_page=${PAGE}&page=${page}`,
      create: { method: "POST", url: base },
      update: (id) => ({ method: "PATCH", url: `${forge.api}/repos/${forge.repo}/issues/comments/${id}` }),
    };
  }

  const project = encodeURIComponent(forge.project);
  const base = `${forge.api}/projects/${project}/merge_requests/${forge.number}/notes`;

  return {
    headers: { "private-token": forge.token },
    list: (page) => `${base}?per_page=${PAGE}&page=${page}`,
    create: { method: "POST", url: base },
    update: (id) => ({ method: "PUT", url: `${base}/${id}` }),
  };
}

/**
 * Writes the comment, updating the one from last time when there is one.
 * Answers what it did: `created`, `updated`, or `refused` with the status
 * when the forge would not let this token write here.
 */
export async function upsert(forge, markdown, fetchImpl = fetch) {
  const { headers, list, create, update } = routes(forge);
  const json = { ...headers, "content-type": "application/json" };

  const own = await (async () => {
    for (let page = 1; ; page++) {
      const res = await fetchImpl(list(page), { headers });
      if (!res.ok) throw await failure("list comments", res);
      const comments = await res.json();
      const found = findOwn(comments);
      if (found) return found;
      if (comments.length < PAGE) return null;
    }
  })();

  const { method, url } = own ? update(own.id) : create;
  const res = await fetchImpl(url, {
    method,
    headers: json,
    body: JSON.stringify({ body: body(markdown) }),
  });
  if (res.status === 401 || res.status === 403) return { outcome: "refused", status: res.status };
  if (!res.ok) throw await failure(own ? "update comment" : "create comment", res);

  return { outcome: own ? "updated" : "created", url: (await res.json()).html_url ?? url };
}

async function failure(what, res) {
  const text = await res.text().catch(() => "");

  return new Error(`${what}: ${res.status} ${res.statusText}${text ? " - " + text.slice(0, 200) : ""}`);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: forge-comment.mjs <markdown file>");
  const markdown = readFileSync(file, "utf8");

  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : null;
  const forge = forgeFromEnv(process.env, event);
  if (!forge.provider) {
    console.error(`forge-comment: nothing to post to (${forge.reason})`);

    return;
  }

  const done = await upsert(forge, markdown);
  if (done.outcome === "refused") {
    console.error(`forge-comment: the forge refused (${done.status}); a fork's token cannot write comments`);

    return;
  }
  console.log(`forge-comment: ${done.outcome} ${done.url}`);
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error("forge-comment: " + cause.message);
    process.exit(1);
  });
}
