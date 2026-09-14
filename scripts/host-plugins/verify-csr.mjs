// verify-csr asks the registry the same question registration will ask, but
// without publishing anything. It is a host verifier because the registry and
// its credential must remain outside a sandboxed plugin.

import { readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { authorization, schemaType } from "./fetch-csr.mjs";
import optionsSchema from "./verify-csr.options.json" with { type: "json" };

const ACCEPT = "application/vnd.schemaregistry.v1+json, application/json";
const CONTENT_TYPE = "application/vnd.schemaregistry.v1+json";

export function describe() {
  return {
    name: "verify-csr",
    summary:
      "Checks local candidate schemas against each subject's effective Confluent Schema Registry compatibility policy without registering them.",
    category: "evidence",
    phases: ["verify"],
    options: optionsSchema,
  };
}

export async function run(
  request,
  { env = process.env, fetch: fetchFn = globalThis.fetch } = {},
) {
  const options = request.options ?? {};
  const registry = String(options.registry ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!registry) throw new Error("verify-csr: no registry");
  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : [];
  if (candidates.length === 0)
    throw new Error("verify-csr: name at least one candidate schema");
  const root = realpathSync(resolve(String(request.input?.root ?? "")));
  const auth = authorization(env);
  const failures = [];
  const seen = new Set();

  for (const candidate of [...candidates].sort((a, b) =>
    `${a.subject}\0${a.path}`.localeCompare(`${b.subject}\0${b.path}`),
  )) {
    const subject = String(candidate.subject ?? "").trim();
    const path = String(candidate.path ?? "").trim();
    if (!subject || !path)
      throw new Error("verify-csr: every candidate needs a subject and path");
    const key = `${subject}\0${path}`;
    if (seen.has(key))
      throw new Error(`verify-csr: duplicate candidate ${subject} at ${path}`);
    seen.add(key);

    const at = realpathSync(resolve(root, path));
    const fromRoot = relative(root, at);
    if (
      !fromRoot ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(fromRoot)
    ) {
      throw new Error(`verify-csr: ${path} is outside the verify input`);
    }
    const schema = readFileSync(at, "utf8");
    if (!schema.trim()) throw new Error(`verify-csr: ${path} is empty`);
    const kind = candidate.schemaType
      ? schemaType(candidate.schemaType)
      : typeOf(path);
    const references = Array.isArray(candidate.references)
      ? candidate.references
      : [];
    const query = `verbose=true${options.normalize ? "&normalize=true" : ""}`;
    const url = `${registry}/compatibility/subjects/${encodeURIComponent(subject)}/versions?${query}`;
    const answer = await post(
      url,
      {
        schema,
        schemaType: kind,
        ...(references.length ? { references } : {}),
      },
      auth,
      fetchFn,
    );
    if (typeof answer.is_compatible !== "boolean") {
      throw new Error(
        `verify-csr: ${subject}: the registry did not answer whether the schema is compatible`,
      );
    }
    if (!answer.is_compatible) {
      const messages = Array.isArray(answer.messages)
        ? answer.messages.map(String).filter(Boolean)
        : [];
      failures.push(
        `${subject} (${path})${messages.length ? `: ${messages.join("; ")}` : ""}`,
      );
    }
  }

  if (failures.length)
    throw new Error(
      `verify-csr: incompatible schema${failures.length === 1 ? "" : "s"}: ${failures.join(" | ")}`,
    );
  return { files: [], warnings: [] };
}

function typeOf(path) {
  switch (extname(path).toLowerCase()) {
    case ".avsc":
      return "AVRO";
    case ".json":
      return "JSON";
    case ".proto":
      return "PROTOBUF";
    default:
      throw new Error(
        `verify-csr: cannot infer schema type from ${path}; set schemaType`,
      );
  }
}

async function post(url, body, auth, fetchFn) {
  const headers = { Accept: ACCEPT, "Content-Type": CONTENT_TYPE };
  if (auth) headers.Authorization = auth;
  let response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new Error(`verify-csr: ${cause.cause?.message ?? cause.message}`);
  }
  const raw = await response.text();
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `verify-csr: the registry's answer is not JSON: ${cause.message}`,
    );
  }
  if (!response.ok || answer?.error_code) {
    throw new Error(
      `verify-csr: the registry answered ${response.status} ${response.statusText}${answer?.message ? `: ${answer.message} (error_code ${answer.error_code ?? 0})` : ""}`,
    );
  }
  return answer;
}
