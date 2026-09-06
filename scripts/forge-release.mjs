// Puts the architecture diff into the release it describes.
//
//   node scripts/forge-release.mjs <markdown file> [tag]
//
// A release body is somebody's text - a changelog, the forge's generated
// notes - and this owns one section of it: what sits between two markers only
// this script writes. The section is replaced when it is there and appended
// when it is not, so the rest of the body is left as it was, and a second run
// for the same tag changes nothing but the section.
//
// A tag with no release yet gets one, named after the tag, with the section
// as its whole body; a release already drafted keeps its draft status.
// Without a tag, or a token, this says so on stderr and exits 0, the way the
// diff never fails what it describes. A refusal by the forge is the same
// silence; any other failed request is an error.

import { readFileSync } from "node:fs";

import { detectForge, failure, headers, projectUrl, refused } from "./forge.mjs";

export const OPEN = "<!-- portolan:architecture -->";
export const CLOSE = "<!-- /portolan:architecture -->";

/** The forge, the tag, and the token - or why there is nothing to write to. */
export function forgeFromEnv(env, tag = "") {
  const forge = detectForge(env);
  if (!forge.provider) return forge;

  const name = tag || (forge.provider === "github"
    ? (env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME : /^refs\/tags\/(.+)$/.exec(env.GITHUB_REF ?? "")?.[1])
    : env.CI_COMMIT_TAG);
  if (!name) return { reason: "not a tag" };
  if (!forge.token) return { reason: forge.provider === "github" ? "GITHUB_TOKEN is not set" : "PORTOLAN_TOKEN is not set" };

  return { ...forge, tag: name };
}

/** The body with this script's section replaced, or appended when absent. */
export function splice(existing, markdown) {
  const section = OPEN + "\n" + markdown.trimEnd() + "\n" + CLOSE;
  const from = existing.indexOf(OPEN);
  const to = existing.indexOf(CLOSE, from);
  if (from !== -1 && to !== -1) {
    return existing.slice(0, from) + section + existing.slice(to + CLOSE.length);
  }
  const rest = existing.trimEnd();

  return rest ? rest + "\n\n" + section + "\n" : section + "\n";
}

/** The requests each forge answers: read the release by tag, create, update. */
function routes(forge) {
  const project = projectUrl(forge);
  if (forge.provider === "github") {
    return {
      read: `${project}/releases/tags/${encodeURIComponent(forge.tag)}`,
      body: (release) => release.body ?? "",
      create: (text) => ({
        method: "POST", url: `${project}/releases`,
        payload: { tag_name: forge.tag, name: forge.tag, body: text },
      }),
      update: (release, text) => ({
        method: "PATCH", url: `${project}/releases/${release.id}`, payload: { body: text },
      }),
      link: (release) => release.html_url,
    };
  }

  const tag = encodeURIComponent(forge.tag);

  return {
    read: `${project}/releases/${tag}`,
    body: (release) => release.description ?? "",
    create: (text) => ({
      method: "POST", url: `${project}/releases`,
      payload: { tag_name: forge.tag, name: forge.tag, description: text },
    }),
    update: (release, text) => ({
      method: "PUT", url: `${project}/releases/${tag}`, payload: { description: text },
    }),
    link: (release) => release._links?.self,
  };
}

/**
 * Writes the section. Answers `created`, `updated`, or `refused` with the
 * status when the forge would not let this token write here.
 */
export async function upsert(forge, markdown, fetchImpl = fetch) {
  const auth = headers(forge);
  const { read, body, create, update, link } = routes(forge);

  const found = await fetchImpl(read, { headers: auth });
  if (refused(found)) return { outcome: "refused", status: found.status };
  if (!found.ok && found.status !== 404) throw await failure("read release", found);
  const release = found.status === 404 ? null : await found.json();

  const { method, url, payload } = release
    ? update(release, splice(body(release), markdown))
    : create(splice("", markdown));
  const res = await fetchImpl(url, {
    method,
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (refused(res)) return { outcome: "refused", status: res.status };
  if (!res.ok) throw await failure(release ? "update release" : "create release", res);

  return { outcome: release ? "updated" : "created", url: link(await res.json()) ?? url };
}

async function main() {
  const [file, tag] = process.argv.slice(2);
  if (!file) throw new Error("usage: forge-release.mjs <markdown file> [tag]");
  const markdown = readFileSync(file, "utf8");

  const forge = forgeFromEnv(process.env, tag);
  if (!forge.provider) {
    console.error(`forge-release: nothing to write to (${forge.reason})`);

    return;
  }

  const done = await upsert(forge, markdown);
  if (done.outcome === "refused") {
    console.error(`forge-release: the forge refused (${done.status}); the token cannot write releases`);

    return;
  }
  console.log(`forge-release: ${done.outcome} ${done.url}`);
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error("forge-release: " + cause.message);
    process.exit(1);
  });
}
