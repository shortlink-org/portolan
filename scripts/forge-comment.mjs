// Puts the architecture diff on the pull request it describes.
//
//   node scripts/forge-comment.mjs <markdown file>
//
// One comment per pull request, updated in place: the body starts with a
// marker only this script writes, and the next run finds that comment and
// replaces it rather than adding another, so a PR pushed to twenty times has
// one report and it is the current one.
//
// Which forge and with what token is `forge.mjs`'s to say. GitHub Actions
// hands over the event (GITHUB_EVENT_PATH) that names the pull request;
// GitLab CI hands over the merge request's iid. Anything else, or no pull
// request at all, and this says so on stderr and exits 0: the diff describes
// a change and never fails one, and neither does the step that posts it. A
// refusal by the forge (a fork's read-only token) is the same silence; any
// other failed request is an error, because a broken configuration should be
// seen once, by whoever set it up.

import { readFileSync } from "node:fs";

import { detectForge, failure, headers, projectUrl, refused } from "./forge.mjs";

export const MARKER = "<!-- portolan:architecture-diff -->";

const PAGE = 100;

/**
 * Which forge, which pull request, and with what - or the reason there is
 * none. `event` is the parsed GitHub event payload when there is one.
 */
export function forgeFromEnv(env, event = null) {
  const forge = detectForge(env);
  if (!forge.provider) return forge;

  if (forge.provider === "github") {
    const number =
      event?.pull_request?.number ??
      Number(/^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "")?.[1]);
    if (!number) return { reason: "not a pull request" };
    if (!forge.token) return { reason: "GITHUB_TOKEN is not set" };

    return { ...forge, number };
  }

  if (!env.CI_MERGE_REQUEST_IID) return { reason: "not a merge request pipeline" };
  if (!forge.token) return { reason: "PORTOLAN_TOKEN is not set" };

  return { ...forge, number: Number(env.CI_MERGE_REQUEST_IID) };
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
  const project = projectUrl(forge);
  if (forge.provider === "github") {
    const base = `${project}/issues/${forge.number}/comments`;

    return {
      list: (page) => `${base}?per_page=${PAGE}&page=${page}`,
      create: { method: "POST", url: base },
      update: (id) => ({ method: "PATCH", url: `${project}/issues/comments/${id}` }),
    };
  }

  const base = `${project}/merge_requests/${forge.number}/notes`;

  return {
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
  const auth = headers(forge);
  const { list, create, update } = routes(forge);

  const own = await (async () => {
    for (let page = 1; ; page++) {
      const res = await fetchImpl(list(page), { headers: auth });
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
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ body: body(markdown) }),
  });
  if (refused(res)) return { outcome: "refused", status: res.status };
  if (!res.ok) throw await failure(own ? "update comment" : "create comment", res);

  return { outcome: own ? "updated" : "created", url: (await res.json()).html_url ?? url };
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
