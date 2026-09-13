// fetch-dx: a read-only DX Software Catalog snapshot expressed as a Portolan
// fragment. It is deliberately independent of gen-dx: either plugin may be
// configured without the other and neither keeps synchronization state.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import optionsSchema from "./fetch-dx.options.json" with { type: "json" };

export const API = "https://api.getdx.com";
export const TOKEN_ENV = "DX_API_TOKEN";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";
export const FRAGMENT_NAME = "dx.catalog.json";
export const LOCK_NAME = "dx.lock.json";

export function describe() {
  return {
    name: "fetch-dx",
    summary: "Reads DX Software Catalog entities and configured relations into a reproducible Portolan catalog fragment.",
    category: "sources",
    phases: ["extract"],
    options: optionsSchema,
  };
}

export async function run(request, { env = process.env, fetch: fetchFn = globalThis.fetch } = {}) {
  const options = request.options ?? {};
  if (!options.cache) throw new Error("no cache directory: set cache to the step's out directory");
  if (!options.defaultContext) throw new Error("no default context: set defaultContext for unscoped DX identifiers");
  if (offline(env)) return cached(options.cache, "offline");
  const token = String(env[TOKEN_ENV] ?? "").trim();
  if (!token) return cached(options.cache, `${TOKEN_ENV} is not set`);

  const server = String(options.server ?? API).replace(/\/+$/, "");
  try {
    const types = Array.isArray(options.entityTypes) && options.entityTypes.length ? options.entityTypes : ["service"];
    const entities = [];
    for (const type of types) entities.push(...await listAll(server, "/catalog.entities.list", { type }, token, fetchFn, "entities"));
    const relations = Array.isArray(options.relations) ? options.relations : [];
    const dependencies = new Map();
    for (const entity of entities) {
      for (const relation of relations) {
        const targets = await listAll(server, "/catalog.relationEdges.list", {
          entity_identifier: entity.identifier,
          relation_identifier: relation,
          direction: "outgoing",
        }, token, fetchFn, "entity_relations");
        if (targets.length) dependencies.set(entity.identifier, [...(dependencies.get(entity.identifier) ?? []), ...targets.map((target) => target.identifier)]);
      }
    }
    return fetched(server, entities, dependencies, options);
  } catch (cause) {
    return cached(options.cache, cause instanceof Error ? cause.message : String(cause));
  }
}

export function fragment(entities, dependencies, options) {
  const contexts = new Map();
  const known = new Set(entities.map((entity) => String(entity.identifier ?? "")));
  for (const entity of [...entities].sort((a, b) => String(a.identifier).localeCompare(String(b.identifier)))) {
    const identity = serviceIdentity(entity.identifier, options.defaultContext);
    const context = contexts.get(identity.context) ?? {
      id: identity.context,
      slug: identity.context,
      name: title(identity.context),
      summary: "Imported from DX Software Catalog.",
      services: [],
    };
    const technologies = propertyStrings(entity.properties?.[options.technologyProperty]);
    const candidateKind = String(entity.properties?.[options.kindProperty] ?? "");
    const service = {
      id: identity.id,
      slug: identity.slug,
      name: String(entity.name ?? entity.identifier),
      repo: repositoryOf(entity.aliases),
      path: "",
      readme: String(entity.description ?? ""),
      provides: [],
      consumes: [],
      aggregates: [],
    };
    if (technologies.length) service.technologies = technologies;
    if (["service", "application", "webapp", "worker", "job", "function", "cli", "library", "data-pipeline"].includes(candidateKind)) service.kind = candidateKind;
    const targets = [...new Set(dependencies.get(entity.identifier) ?? [])]
      .filter((target) => known.has(target))
      .map((target) => serviceIdentity(target, options.defaultContext).id)
      .filter((target) => target !== identity.id)
      .sort();
    if (targets.length) service.dependsOn = targets;
    context.services.push(service);
    contexts.set(identity.context, context);
  }
  const ordered = [...contexts.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const context of ordered) context.services.sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ contexts: ordered, defs: {}, flows: [], adrs: [] }, null, 2)}\n`;
}

export function serviceIdentity(identifier, fallback) {
  const raw = String(identifier ?? "").trim();
  if (!raw) throw new Error("DX returned an entity without an identifier");
  const pieces = raw.split(".").filter(Boolean);
  if (pieces.length > 1) {
    const context = slug(pieces.slice(0, -1).join("-"));
    const service = slug(pieces.at(-1));
    return { context, slug: service, id: `${context}.${service}` };
  }
  const context = slug(fallback);
  const service = slug(raw);
  return { context, slug: service, id: `${context}.${service}` };
}

export function repositoryOf(aliases = {}) {
  for (const [type, prefix] of [["github_repo", "github.com/"], ["gitlab_repo", "gitlab.com/"]]) {
    const value = Array.isArray(aliases?.[type]) ? aliases[type][0] : null;
    const name = String(value?.name ?? value?.lookup ?? "").replace(/^https?:\/\//, "").replace(/\.git$/, "");
    if (!name) continue;
    return name.includes(".") && name.includes("/") ? name : prefix + name;
  }
  return "";
}

async function listAll(server, pathname, params, token, fetchFn, field) {
  const out = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ ...params, limit: "50", ...(cursor ? { cursor } : {}) });
    const response = await fetchFn(`${server}${pathname}?${query}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${pathname}: http ${response.status}`);
    let answer;
    try { answer = JSON.parse(raw); } catch { throw new Error(`${pathname}: the answer is not JSON`); }
    if (answer?.ok === false) throw new Error(`${pathname}: ${answer.error ?? "DX rejected the request"}`);
    out.push(...(Array.isArray(answer?.[field]) ? answer[field] : []));
    cursor = String(answer?.response_metadata?.next_cursor ?? "");
  } while (cursor);
  return out;
}

function fetched(server, entities, dependencies, options) {
  const contents = fragment(entities, dependencies, options);
  const lock = { server, entities: entities.map((entity) => entity.identifier).sort(), sha256: digest(contents) };
  return { files: [{ name: FRAGMENT_NAME, contents }, { name: LOCK_NAME, contents: `${JSON.stringify(lock, null, 2)}\n` }], warnings: [] };
}

function cached(dir, why) {
  try {
    const lock = JSON.parse(readFileSync(join(dir, LOCK_NAME), "utf8"));
    const contents = readFileSync(join(dir, FRAGMENT_NAME), "utf8");
    if (digest(contents) !== lock.sha256) throw new Error(`${FRAGMENT_NAME} does not match its digest`);
    return { files: [{ name: FRAGMENT_NAME, contents }, { name: LOCK_NAME, contents: `${JSON.stringify(lock, null, 2)}\n` }], warnings: [{ severity: "warning", ref: lock.server, message: `not fetched (${why}); the snapshot committed in this repository is used unchanged` }] };
  } catch (cause) {
    throw new Error(`DX could not be read (${why}) and there is no usable snapshot in the tree (${cause.message})`);
  }
}

const digest = (contents) => createHash("sha256").update(contents).digest("hex");
const propertyStrings = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(String).map((item) => item.trim()).filter(Boolean))].sort();
const slug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dx";
const title = (value) => String(value).split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
const offline = (env) => Boolean(String(env[OFFLINE_ENV] ?? "").trim()) || !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
