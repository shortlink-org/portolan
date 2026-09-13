// Explicitly applies a plan emitted by gen-dx. Generation never calls DX:
// writes happen only when a user or CI invokes `portolan dx apply`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const API = "https://api.getdx.com";

export async function applyPlan(plan, { token = process.env.DX_API_TOKEN, server = process.env.DX_API_URL ?? API, fetch: fetchFn = globalThis.fetch, dryRun = false } = {}) {
  validatePlan(plan);
  const entityCount = plan.entities.length;
  const edgeCount = plan.relationEdges.reduce((sum, relation) => sum + Object.values(relation.edges).reduce((n, targets) => n + targets.length, 0), 0);
  if (dryRun) return { entities: entityCount, edges: edgeCount, requests: 0 };
  if (!String(token ?? "").trim()) throw new Error("DX_API_TOKEN is not set");
  const base = String(server).replace(/\/+$/, "");
  let requests = 0;
  for (const entity of plan.entities) {
    await post(base, "/catalog.entities.upsert", entity, token, fetchFn);
    requests += 1;
  }
  for (const relation of plan.relationEdges) {
    for (const edges of edgeBatches(relation.edges, 100)) {
      await post(base, "/catalog.relationEdges.bulkUpsert", { relation_identifier: relation.relation_identifier, edges }, token, fetchFn);
      requests += 1;
    }
  }
  return { entities: entityCount, edges: edgeCount, requests };
}

export function validatePlan(plan) {
  if (!plan || plan.version !== 1) throw new Error("DX plan version must be 1");
  if (!Array.isArray(plan.entities) || !Array.isArray(plan.relationEdges)) throw new Error("DX plan must contain entities and relationEdges arrays");
  const identifiers = new Set();
  for (const entity of plan.entities) {
    if (!entity || typeof entity.identifier !== "string" || !entity.identifier || typeof entity.type !== "string" || !entity.type) throw new Error("every DX entity needs identifier and type");
    if (identifiers.has(entity.identifier)) throw new Error(`DX entity ${entity.identifier} is listed twice`);
    identifiers.add(entity.identifier);
  }
  for (const relation of plan.relationEdges) {
    if (!relation || typeof relation.relation_identifier !== "string" || !relation.relation_identifier || !relation.edges || Array.isArray(relation.edges)) throw new Error("every DX relation edge group needs relation_identifier and edges");
    for (const [source, targets] of Object.entries(relation.edges)) {
      if (!identifiers.has(source) || !Array.isArray(targets) || targets.some((target) => !identifiers.has(target))) throw new Error(`DX relation ${relation.relation_identifier} references an entity outside the plan`);
    }
  }
}

export function edgeBatches(edges, maximum) {
  const batches = [];
  let current = {};
  let count = 0;
  for (const source of Object.keys(edges).sort()) {
    for (const target of [...edges[source]].sort()) {
      if (count === maximum) { batches.push(current); current = {}; count = 0; }
      current[source] = [...(current[source] ?? []), target];
      count += 1;
    }
  }
  if (count) batches.push(current);
  return batches;
}

async function post(server, pathname, body, token, fetchFn) {
  const response = await fetchFn(`${server}${pathname}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let answer = null;
  try { answer = JSON.parse(raw); } catch { /* handled by status below */ }
  if (!response.ok || answer?.ok === false) throw new Error(`${pathname}: ${answer?.error ?? `http ${response.status}`}`);
}

async function main(argv = process.argv.slice(2)) {
  const path = argv.find((arg) => !arg.startsWith("-"));
  if (!path) throw new Error("usage: portolan dx apply PLAN [--dry-run]");
  const plan = JSON.parse(readFileSync(resolve(path), "utf8"));
  const dryRun = argv.includes("--dry-run");
  const result = await applyPlan(plan, { dryRun });
  console.log(`DX plan: ${result.entities} entities, ${result.edges} edges${dryRun ? " (dry run)" : ` in ${result.requests} requests`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1; });
}
