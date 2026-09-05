// What two extractors agree on about an OpenAPI document: how its interfaces
// are named in the catalog, and which operation answers on which route. The
// same rules as plugins/openapi in Go - openapi.test.ts holds this to the
// same cases - so a call read here and a method read there share one id.

import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** `auth` 1.0.0 → `auth.v1`. */
export function apiID(title: string, version: string): string {
  const name = (title || "api").toLowerCase().replaceAll(" ", "-");
  const major = version.split(".")[0];
  return major ? `${name}.v${major}` : name;
}

/**
 * The id a document says it goes by in the estate, or the one built from its
 * title and version when it says nothing. `x-portolan-api` in `info` is for a
 * copy vendored from outside the estate, whose own title and version would put
 * the third party's words on every arrow where the estate wants its own.
 */
export function documentApiID(declared: string, title: string, version: string): string {
  const named = declared.trim();
  return named ? named : apiID(title, version);
}

/** users → Users, price_list → PriceList. */
export function tagTitle(name: string): string {
  return name
    .split(/[_\- ]+/)
    .filter(Boolean)
    .map((w) => (w[0]! >= "a" && w[0]! <= "z" ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join("");
}

export function interfaceID(api: string, tag: string): string {
  return tag ? `${api}.${tagTitle(tag)}` : api;
}

export const VERBS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export interface Operation {
  /** The operationId, or `VERB /path` when the document has none. */
  id: string;
  tag: string;
  verb: string;
  path: string;
}

export interface Spec {
  api: string;
  operations: Operation[];
  /** Where it was read from, for a call's source. */
  source: string;
}

export function callID(spec: Spec, op: Operation): string {
  return `${interfaceID(spec.api, op.tag)}/${op.id}`;
}

export function readSpec(path: string): Spec {
  const doc = parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  const info = (doc?.info ?? {}) as Record<string, unknown>;
  const spec: Spec = {
    api: documentApiID(String(info["x-portolan-api"] ?? ""), String(info.title ?? ""), String(info.version ?? "")),
    operations: [],
    source: path,
  };
  const paths = (doc?.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const [route, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const verb of VERBS) {
      const op = item[verb] as Record<string, unknown> | undefined;
      if (!op || typeof op !== "object") continue;
      const tags = Array.isArray(op.tags) ? (op.tags as string[]) : [];
      spec.operations.push({
        id: String(op.operationId ?? `${verb.toUpperCase()} ${route}`),
        tag: tags[0] ?? "",
        verb: verb.toUpperCase(),
        path: route,
      });
    }
  }
  return spec;
}

/** Parameters are compared by position, not by name: `{userId}`, `%s` and `${id}` are one marker. */
function shape(path: string): string {
  return path
    .replace(/\/$/, "")
    .split("/")
    .map((s) => (s.startsWith("{") || s.startsWith("${") || s === "%s" || s === "%v" || s === "%d" ? "*" : s))
    .join("/");
}

export function findOperation(spec: Spec, verb: string, path: string): Operation | undefined {
  const want = `${verb.toUpperCase()} ${shape(path)}`;
  return spec.operations.find((op) => `${op.verb} ${shape(op.path)}` === want);
}
