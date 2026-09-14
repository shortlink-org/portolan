// fetch-eventbridge, run by the host: the deployed EventBridge control plane
// on one side, a reproducible catalog fragment on the other.
//
// The API proves buses, enabled event rules and their targets. It cannot prove
// which application calls PutEvents, nor which service owns an arbitrary ARN,
// so the manifest maps event `source` values and target identities to catalog
// service ids. Unmapped identities are warnings, never guessed relationships.
//
// Only architectural identities are retained. Event-pattern values outside
// `source` and `detail-type`, fixed target input and input templates may carry
// business data, so the snapshot keeps only their field names or the fact that
// a transformation exists. Credentials come from the standard AWS SDK chain
// and never enter either output file.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EventBridgeClient,
  ListEventBusesCommand,
  ListRulesCommand,
  ListTagsForResourceCommand,
  ListTargetsByRuleCommand,
} from "@aws-sdk/client-eventbridge";

import optionsSchema from "./fetch-eventbridge.options.json" with { type: "json" };

export const DEFAULT_OUT = "eventbridge.json";
export const LOCK_NAME = "eventbridge.lock.json";
export const OFFLINE_ENV = "PORTOLAN_OFFLINE";

export function describe() {
  return {
    name: "fetch-eventbridge",
    summary: "Reads deployed Amazon EventBridge buses, enabled rules and targets through the read-only AWS API into service message channels, with a checked snapshot for offline builds.",
    category: "infrastructure",
    phases: ["extract"],
    options: optionsSchema,
  };
}

/**
 * @param {{options?: object}} request
 * @param {{env?: NodeJS.ProcessEnv, clientFactory?: (region: string) => {send: Function, destroy?: Function}}} [io]
 */
export async function run(request, { env = process.env, clientFactory = defaultClient } = {}) {
  const options = request.options ?? {};
  const regions = normalizedStrings(options.regions);
  if (regions.length === 0) throw new Error("no regions: name at least one AWS region to read");
  if (!String(options.cache ?? "").trim()) {
    throw new Error("no cache directory: set cache to the same path as the step's out, so an offline run can replay what the last online one wrote");
  }

  if (offline(env)) {
    const out = new Builder();
    emitCached(out, options.cache, "offline");
    return out.response();
  }

  const out = new Builder();
  try {
    const estate = await live(options, regions, clientFactory, out);
    emitFetched(out, estate, options);
    return out.response();
  } catch (cause) {
    // Discard warnings from a partial API read. The cached fragment is a
    // complete earlier observation; mixing diagnostics from half of today
    // with it would describe no coherent state.
    const fallback = new Builder();
    try {
      emitCached(fallback, options.cache, cause.message);
    } catch (cacheCause) {
      throw new Error(`EventBridge could not be read (${cause.message}) and there is no usable snapshot in the tree (${cacheCause.message})`);
    }
    return fallback.response();
  }
}

export function offline(env = process.env) {
  if (String(env[OFFLINE_ENV] ?? "").trim()) return true;
  return !["", "0", "false"].includes(String(env.CI ?? "").trim().toLowerCase());
}

function defaultClient(region) {
  return new EventBridgeClient({ region });
}

async function live(options, regions, clientFactory, out) {
  const wanted = new Set(normalizedStrings(options.buses));
  const buses = [];
  for (const region of regions) {
    const client = clientFactory(region);
    try {
      const listed = await pages(client, ListEventBusesCommand, "EventBuses", {});
      for (const raw of listed) {
        const name = String(raw?.Name ?? "").trim();
        const arn = String(raw?.Arn ?? "").trim();
        if (!name || !arn || (wanted.size > 0 && !wanted.has(name) && !wanted.has(arn))) continue;
        const rules = [];
        for (const rule of await pages(client, ListRulesCommand, "Rules", { EventBusName: name })) {
          const ruleName = String(rule?.Name ?? "").trim();
          if (!ruleName) continue;
          const targets = await pages(client, ListTargetsByRuleCommand, "Targets", { EventBusName: name, Rule: ruleName });
          let tags = [];
          if (options.ruleTags && rule.Arn) {
            try {
              tags = (await client.send(new ListTagsForResourceCommand({ ResourceARN: rule.Arn })))?.Tags ?? [];
            } catch (cause) {
              out.warn(rule.Arn, `rule tags could not be read (${errorText(cause)}); explicit targets mappings are still used`);
            }
          }
          rules.push(normalizeRule(rule, targets, tags));
        }
        buses.push({
          name,
          arn,
          region,
          description: String(raw?.Description ?? "").trim(),
          rules: rules.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    } finally {
      client.destroy?.();
    }
  }
  buses.sort((a, b) => a.arn.localeCompare(b.arn));
  if (buses.length === 0) {
    const narrowed = wanted.size > 0 ? ` matching ${[...wanted].sort().join(", ")}` : "";
    throw new Error(`the selected regions list no event buses${narrowed}`);
  }
  return buses;
}

async function pages(client, Command, field, input) {
  const out = [];
  let next;
  do {
    const answer = await client.send(new Command({ ...input, ...(next ? { NextToken: next } : {}) }));
    if (Array.isArray(answer?.[field])) out.push(...answer[field]);
    next = String(answer?.NextToken ?? "").trim();
  } while (next);
  return out;
}

function normalizeRule(rule, targets, tags) {
  return {
    name: String(rule?.Name ?? "").trim(),
    arn: String(rule?.Arn ?? "").trim(),
    state: String(rule?.State ?? "").trim(),
    managedBy: String(rule?.ManagedBy ?? "").trim(),
    schedule: String(rule?.ScheduleExpression ?? "").trim(),
    pattern: String(rule?.EventPattern ?? "").trim(),
    tags: Object.fromEntries((tags ?? []).map((tag) => [String(tag?.Key ?? "").trim(), String(tag?.Value ?? "").trim()]).filter(([key]) => key).sort(([a], [b]) => a.localeCompare(b))),
    targets: (targets ?? []).map(normalizeTarget).sort((a, b) => `${a.arn}\0${a.id}`.localeCompare(`${b.arn}\0${b.id}`)),
  };
}

function normalizeTarget(target) {
  const retry = target?.RetryPolicy ?? {};
  return {
    id: String(target?.Id ?? "").trim(),
    arn: String(target?.Arn ?? "").trim(),
    hasInput: target?.Input !== undefined,
    inputPath: String(target?.InputPath ?? "").trim(),
    transformsInput: target?.InputTransformer !== undefined,
    deadLetterArn: String(target?.DeadLetterConfig?.Arn ?? "").trim(),
    maximumEventAge: numberOrNull(retry.MaximumEventAgeInSeconds),
    retryAttempts: numberOrNull(retry.MaximumRetryAttempts),
  };
}

/** Turn one complete API observation into a normal Portolan fragment. */
export function fragment(buses, options = {}, out = new Builder()) {
  const services = new Map();
  const warned = new Set();
  const sourceMap = stringMap(options.sources);
  const targetMap = stringMap(options.targets);

  const warnOnce = (key, ref, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    out.warn(ref, message);
  };

  for (const bus of buses) {
    for (const rule of bus.rules) {
      const ref = rule.arn || `${bus.arn}/rule/${rule.name}`;
      if (rule.state === "DISABLED") {
        warnOnce(`disabled:${ref}`, ref, "disabled rule was left out of the active message topology");
        continue;
      }
      if (rule.schedule) {
        warnOnce(`schedule:${ref}`, ref, "scheduled rule was left out of the event-bus topology; EventBridge Scheduler is a separate integration");
        continue;
      }
      const pattern = eventPattern(rule.pattern, ref, warnOnce);
      if (!pattern) continue;
      const sources = literals(pattern.source);
      const messageNames = literals(pattern["detail-type"]);
      if (messageNames.length === 0) {
        warnOnce(`messages:${ref}`, ref, "event pattern names no literal detail-type; no message name was invented for the rule");
        continue;
      }
      if (sources.length === 0) {
        warnOnce(`sources:${ref}`, ref, "event pattern names no literal source; consumers are retained but no publisher was invented for the rule");
      }
      const fields = patternFields(pattern);
      const common = ruleNote(rule, fields);

      for (const source of sources) {
        const serviceId = mappedValue(sourceMap, source);
        if (!serviceId) {
          warnOnce(`source:${source}`, ref, `event source ${JSON.stringify(source)} is not mapped to a service and was not claimed as a publisher`);
          continue;
        }
        for (const name of messageNames) addMessage(services, serviceId, bus, name, "send", `${common} Matches source ${JSON.stringify(source)}.`);
      }

      const tagged = serviceFromTags(rule.tags, options.ruleTags);
      for (const target of rule.targets) {
        const serviceId = mappedTarget(target, targetMap) || tagged;
        if (!serviceId) {
          const identity = target.arn || target.id || "unnamed target";
          warnOnce(`target:${identity}`, ref, `target ${JSON.stringify(identity)} is not mapped to a service and was not claimed as a consumer`);
          continue;
        }
        const note = `${common} Delivered to ${target.arn ? `\`${target.arn}\`` : `target ${JSON.stringify(target.id)}`}.${targetNote(target)}`;
        for (const name of messageNames) addMessage(services, serviceId, bus, name, "receive", note);
      }
    }
  }

  const contexts = new Map();
  for (const state of [...services.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const { context, slug } = serviceParts(state.id);
    const channels = [...state.channels.values()].sort((a, b) => a.address.localeCompare(b.address)).map((channel) => ({
      address: channel.address,
      kind: "event",
      title: channel.title,
      doc: channel.doc,
      messages: [...channel.messages.values()].sort((a, b) => `${a.direction}\0${a.name}`.localeCompare(`${b.direction}\0${b.name}`)).map((message) => ({
        name: message.name,
        direction: message.direction,
        doc: [...message.notes].sort().join(" "),
      })),
    }));
    const service = { id: state.id, slug, name: "", repo: "", path: "", readme: "", provides: [], consumes: [], aggregates: [], channels };
    const held = contexts.get(context) ?? { id: context, slug: context, name: "", summary: "", services: [] };
    held.services.push(service);
    contexts.set(context, held);
  }

  const catalog = { contexts: [...contexts.values()].sort((a, b) => a.id.localeCompare(b.id)), defs: {}, flows: [], adrs: [] };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function addMessage(services, serviceId, bus, name, direction, note) {
  serviceParts(serviceId); // validate at the boundary, before emitting a fragment
  let service = services.get(serviceId);
  if (!service) {
    service = { id: serviceId, channels: new Map() };
    services.set(serviceId, service);
  }
  let channel = service.channels.get(bus.arn);
  if (!channel) {
    const description = bus.description ? ` ${bus.description}` : "";
    channel = {
      address: bus.arn,
      title: `Amazon EventBridge · ${bus.name}`,
      doc: `Deployed EventBridge bus \`${bus.name}\` in \`${bus.region}\`.${description}`,
      messages: new Map(),
    };
    service.channels.set(bus.arn, channel);
  }
  const key = `${direction}\0${name}`;
  let message = channel.messages.get(key);
  if (!message) {
    message = { name, direction, notes: new Set() };
    channel.messages.set(key, message);
  }
  message.notes.add(note);
}

function eventPattern(raw, ref, warnOnce) {
  if (!raw) {
    warnOnce(`pattern:${ref}`, ref, "rule has no event pattern and was left out of the event-bus topology");
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("pattern is not an object");
    return parsed;
  } catch (cause) {
    warnOnce(`pattern:${ref}`, ref, `event pattern is not readable JSON (${cause.message}); the rule was left out`);
    return null;
  }
}

function literals(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))].sort();
}

function patternFields(pattern) {
  const fields = [];
  const walk = (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (path) fields.push(path);
      return;
    }
    const keys = Object.keys(value);
    if (keys.length === 0 && path) fields.push(path);
    for (const key of keys.sort()) walk(value[key], path ? `${path}.${key}` : key);
  };
  for (const key of Object.keys(pattern).filter((key) => key !== "source" && key !== "detail-type").sort()) walk(pattern[key], key);
  return [...new Set(fields)].sort();
}

function ruleNote(rule, fields) {
  let note = `Matched by EventBridge rule \`${rule.name}\``;
  if (rule.managedBy) note += ` managed by \`${rule.managedBy}\``;
  note += ".";
  if (fields.length) note += ` Additional pattern fields: ${fields.map((field) => `\`${field}\``).join(", ")}.`;
  return note;
}

function targetNote(target) {
  const notes = [];
  if (target.hasInput) notes.push("replaces the event with fixed input");
  if (target.inputPath) notes.push(`selects input path \`${target.inputPath}\``);
  if (target.transformsInput) notes.push("transforms the input");
  if (target.deadLetterArn) notes.push(`dead-letter queue \`${target.deadLetterArn}\``);
  if (target.maximumEventAge !== null) notes.push(`maximum event age ${target.maximumEventAge}s`);
  if (target.retryAttempts !== null) notes.push(`maximum retries ${target.retryAttempts}`);
  return notes.length ? ` Target ${notes.join("; ")}.` : "";
}

/** Identities accepted by the targets mapping, most specific first. */
export function targetIdentities(target) {
  const arn = String(target?.arn ?? "").trim();
  const id = String(target?.id ?? "").trim();
  const out = [];
  if (arn) out.push(arn);
  if (arn.startsWith("arn:")) {
    const parts = arn.split(":");
    const service = parts[2] ?? "";
    let resource = parts.slice(5).join(":");
    if (service === "lambda" && resource.startsWith("function:")) resource = resource.slice("function:".length).split(":")[0];
    else if (resource.includes("/")) resource = resource.split("/").at(-1);
    else if (resource.includes(":")) resource = resource.split(":").at(-1);
    if (service && resource) out.push(`${service}:${resource}`);
    if (resource) out.push(resource);
  }
  if (id) out.push(id);
  return [...new Set(out)];
}

function mappedTarget(target, mappings) {
  for (const identity of targetIdentities(target)) {
    const service = mappedValue(mappings, identity);
    if (service) return service;
  }
  return "";
}

function mappedValue(mappings, key) {
  return Object.hasOwn(mappings, key) ? mappings[key] : "";
}

function serviceFromTags(tags, configured) {
  if (!configured) return "";
  const context = String(tags?.[configured.context] ?? "").trim();
  const service = String(tags?.[configured.service] ?? "").trim();
  return context && service ? `${context}.${service}` : "";
}

function serviceParts(id) {
  const value = String(id ?? "").trim();
  const at = value.lastIndexOf(".");
  if (at <= 0 || at === value.length - 1) throw new Error(`service mapping ${JSON.stringify(value)} must be a full id such as \"shop.orders\"`);
  return { context: value.slice(0, at), slug: value.slice(at + 1) };
}

function stringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key).trim(), String(item).trim()]).filter(([key, item]) => key && item));
}

function normalizedStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function errorText(cause) {
  return cause?.name || cause?.Code || cause?.message || "AWS API error";
}

function emitFetched(out, buses, options) {
  const contents = fragment(buses, options, out);
  out.file(DEFAULT_OUT, contents);
  out.file(LOCK_NAME, encodeLock({
    regions: normalizedStrings(options.regions),
    buses: buses.map((bus) => bus.arn),
    sha256: digestOf(contents),
  }));
}

function emitCached(out, cache, why) {
  const held = replay(cache);
  out.file(DEFAULT_OUT, held.contents);
  out.file(LOCK_NAME, encodeLock(held.lock));
  out.warn(held.lock.regions.join(","), `EventBridge was not fetched (${why}); the snapshot committed in this repository is used unchanged`);
}

export function encodeLock(entry) {
  return `${JSON.stringify({ regions: normalizedStrings(entry.regions), buses: normalizedStrings(entry.buses), sha256: String(entry.sha256 ?? "") }, null, 2)}\n`;
}

function replay(dir) {
  const lockPath = join(dir, LOCK_NAME);
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") throw new Error(`no ${LOCK_NAME} in ${String(dir).split("\\").join("/")}`);
    throw cause;
  }
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${lockPath}: ${cause.message}`);
  }
  let contents;
  try {
    contents = readFileSync(join(dir, DEFAULT_OUT), "utf8");
  } catch (cause) {
    if (cause.code === "ENOENT") throw new Error(`${DEFAULT_OUT} is in the lock but not on disk`);
    throw cause;
  }
  if (digestOf(contents) !== lock.sha256) throw new Error(`${DEFAULT_OUT} does not match its digest; the snapshot was edited by hand`);
  return {
    lock: { regions: normalizedStrings(lock.regions), buses: normalizedStrings(lock.buses), sha256: String(lock.sha256 ?? "") },
    contents,
  };
}

function digestOf(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

class Builder {
  files = [];
  warnings = [];

  file(name, contents) {
    this.files.push({ name, contents });
  }

  warn(ref, message) {
    this.warnings.push({ severity: "warning", message, ref });
  }

  response() {
    return { files: this.files, warnings: this.warnings };
  }
}
