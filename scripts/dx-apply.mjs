// Explicitly applies a plan emitted by gen-dx. Generation never calls DX:
// writes happen only when a user or CI invokes `portolan dx apply`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DX_API, requestJSON } from "./dx-api.mjs";

export const API = DX_API;

export async function applyPlan(plan, {
  token = process.env.DX_API_TOKEN,
  server = process.env.DX_API_URL ?? API,
  fetch: fetchFn = globalThis.fetch,
  dryRun = false,
  retries = 3,
  wait,
} = {}) {
  validatePlan(plan);
  const entityCount = plan.entities.length;
  const edgeCount = plan.relationEdges.reduce((sum, relation) => sum + Object.values(relation.edges).reduce((n, targets) => n + targets.length, 0), 0);
  if (dryRun) return { entities: entityCount, edges: edgeCount, requests: 0 };
  if (!String(token ?? "").trim()) throw new Error("DX_API_TOKEN is not set");
  const base = String(server).replace(/\/+$/, "");
  const checks = await preflightPlan(plan, { token, server: base, fetch: fetchFn, retries, wait });
  let requests = 0;
  for (const entity of plan.entities) {
    await requestJSON("/catalog.entities.upsert", {
      server: base, token, fetch: fetchFn, method: "POST", body: entity, retries, wait,
    });
    requests += 1;
  }
  for (const relation of plan.relationEdges) {
    for (const edges of edgeBatches(relation.edges, 100)) {
      await requestJSON("/catalog.relationEdges.bulkUpsert", {
        server: base,
        token,
        fetch: fetchFn,
        method: "POST",
        body: { relation_identifier: relation.relation_identifier, edges },
        retries,
        wait,
      });
      requests += 1;
    }
  }
  return { entities: entityCount, edges: edgeCount, requests, checks };
}

export async function preflightPlan(plan, { token, server = API, fetch: fetchFn = globalThis.fetch, retries = 3, wait } = {}) {
  validatePlan(plan);
  const entities = new Map(plan.entities.map((entity) => [entity.identifier, entity]));
  const typeDefinitions = new Map();
  const types = [...new Set(plan.entities.map((entity) => entity.type))].sort();

  for (const identifier of types) {
    const answer = await requestJSON("/catalog.entityTypes.info", {
      server, token, fetch: fetchFn, query: { identifier }, retries, wait,
    });
    const definition = answer?.entity_type;
    if (!definition || definition.identifier !== identifier) {
      throw new Error(`DX preflight: entity type ${identifier} was not returned by DX`);
    }
    typeDefinitions.set(identifier, definition);
  }

  for (const entity of plan.entities) {
    const available = new Set((typeDefinitions.get(entity.type)?.properties ?? []).map((property) => property.identifier));
    for (const property of Object.keys(entity.properties ?? {})) {
      if (!available.has(property)) {
        throw new Error(`DX preflight: property ${property} does not exist on entity type ${entity.type}`);
      }
    }
  }

  const relations = [...plan.relationEdges].sort((a, b) => a.relation_identifier.localeCompare(b.relation_identifier));
  for (const group of relations) {
    const answer = await requestJSON("/catalog.relations.info", {
      server, token, fetch: fetchFn, query: { identifier: group.relation_identifier }, retries, wait,
    });
    const relation = answer?.relation;
    if (!relation || relation.identifier !== group.relation_identifier) {
      throw new Error(`DX preflight: relation ${group.relation_identifier} was not returned by DX`);
    }
    for (const [source, targets] of Object.entries(group.edges)) {
      const sourceType = entities.get(source)?.type;
      if (sourceType !== relation.source_entity_type_identifier) {
        throw new Error(`DX preflight: relation ${group.relation_identifier} expects source type ${relation.source_entity_type_identifier}, but ${source} has type ${sourceType}`);
      }
      for (const target of targets) {
        const targetType = entities.get(target)?.type;
        if (targetType !== relation.target_entity_type_identifier) {
          throw new Error(`DX preflight: relation ${group.relation_identifier} expects target type ${relation.target_entity_type_identifier}, but ${target} has type ${targetType}`);
        }
      }
    }
  }

  return types.length + relations.length;
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

async function main(argv = process.argv.slice(2)) {
  const path = argv.find((arg) => !arg.startsWith("-"));
  if (!path) throw new Error("usage: portolan dx apply PLAN [--dry-run]");
  const plan = JSON.parse(readFileSync(resolve(path), "utf8"));
  const dryRun = argv.includes("--dry-run");
  const result = await applyPlan(plan, { dryRun });
  console.log(`DX plan: ${result.entities} entities, ${result.edges} edges${dryRun ? " (dry run)" : ` in ${result.requests} writes after ${result.checks} preflight checks`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1; });
}
