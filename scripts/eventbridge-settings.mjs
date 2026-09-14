import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";

import { readManifestText } from "./manifest.mjs";

const HOST = "fetch-eventbridge";
const FILE = "eventbridge.json";
const MANAGED_PREFIX = "portolan-eventbridge";

function read(workspace) {
  const path = join(workspace, "portolan.json");
  const text = readFileSync(path, "utf8");
  return { path, manifest: readManifestText(text, path), revision: createHash("sha256").update(text).digest("hex") };
}

function strings(value, label, { required = false } = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const result = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (required && result.length === 0) throw new Error(`Add at least one ${label.toLowerCase()}.`);
  if (result.some((item) => item.length > 300 || /[\r\n\0]/.test(item))) throw new Error(`${label} contains an invalid value.`);
  return result;
}

function mapping(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a mapping.`);
  const result = {};
  for (const [rawKey, rawService] of Object.entries(value)) {
    const key = rawKey.trim();
    const service = String(rawService ?? "").trim();
    if (!key || key.length > 1000 || /[\r\n\0]/.test(key)) throw new Error(`${label} contains an invalid identity.`);
    if (!/^.+\..+$/.test(service) || service.length > 300 || /[\r\n\0]/.test(service)) throw new Error(`${label} must map every identity to a context.service id.`);
    result[key] = service;
  }
  return result;
}

function tags(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Rule tags must name context and service tag keys.");
  const context = String(value.context ?? "").trim();
  const service = String(value.service ?? "").trim();
  if (!context && !service) return undefined;
  if (!context || !service || [context, service].some((item) => item.length > 300 || /[\r\n\0]/.test(item))) throw new Error("Rule tags must include both context and service tag keys.");
  return { context, service };
}

function eventBridgePluginNames(manifest) {
  return new Set((manifest.plugins ?? []).filter((plugin) => plugin.host === HOST).map((plugin) => plugin.name));
}

function publicOptions(options = {}) {
  return {
    regions: strings(options.regions ?? [], "Regions"),
    buses: strings(options.buses ?? [], "Buses"),
    sources: mapping(options.sources, "Sources"),
    targets: mapping(options.targets, "Targets"),
    ruleTags: tags(options.ruleTags),
  };
}

export function eventBridgeState(workspace) {
  const { manifest, revision } = read(workspace);
  const names = eventBridgePluginNames(manifest);
  const entries = (manifest.extract ?? []).map((entry, step) => ({ entry, step })).filter(({ entry }) => names.has(entry.plugin)).map(({ entry, step }) => {
    const output = String(entry.out ?? "");
    const source = `${output}/${FILE}`;
    return {
      step,
      input: String(entry.in ?? "."),
      output,
      cache: String(entry.options?.cache ?? ""),
      ...publicOptions(entry.options),
      managed: output === MANAGED_PREFIX || output.startsWith(`${MANAGED_PREFIX}-`),
      catalogs: (manifest.catalogs ?? []).filter((catalog) => (catalog.sources ?? []).some((pattern) => matchesGlob(source, pattern))).map((catalog) => catalog.id),
    };
  });
  return {
    revision,
    entries,
    catalogs: (manifest.catalogs ?? []).map((catalog) => ({ id: catalog.id, title: catalog.title ?? catalog.id })),
  };
}

function nextOutput(entries) {
  const used = new Set(entries.map((entry) => entry.output));
  if (!used.has(MANAGED_PREFIX)) return MANAGED_PREFIX;
  let suffix = 2;
  while (used.has(`${MANAGED_PREFIX}-${suffix}`)) suffix += 1;
  return `${MANAGED_PREFIX}-${suffix}`;
}

export function saveEventBridgeSettings(workspace, request, writeManifest) {
  const { path, manifest, revision } = read(workspace);
  if (request?.revision !== revision) throw new Error("portolan.json has changed since these settings were read. Reload settings and try again.");
  const state = eventBridgeState(workspace);
  const existing = request.step === null ? null : state.entries.find((entry) => entry.step === request.step);
  if (request.step !== null && !existing) throw new Error("The EventBridge extractor no longer exists.");

  const regions = strings(request.regions, "Regions", { required: true });
  const buses = strings(request.buses ?? [], "Buses");
  const sources = mapping(request.sources, "Sources");
  const targets = mapping(request.targets, "Targets");
  const ruleTags = tags(request.ruleTags);
  if (!Array.isArray(request.catalogs) || request.catalogs.some((id) => !state.catalogs.some((catalog) => catalog.id === id)) || (state.catalogs.length > 0 && request.catalogs.length === 0)) throw new Error("Select at least one known catalog.");
  if (existing && !existing.managed && JSON.stringify([...request.catalogs].sort()) !== JSON.stringify([...existing.catalogs].sort())) throw new Error("This extractor has manually configured sources. Change its catalog scope in portolan.json.");

  let plugin = (manifest.plugins ?? []).find((item) => item.host === HOST)?.name;
  if (!plugin) {
    plugin = "eventbridge";
    if ((manifest.plugins ?? []).some((item) => item.name === plugin)) throw new Error("Plugin name eventbridge is already in use.");
    manifest.plugins = [...(manifest.plugins ?? []), { name: plugin, host: HOST }];
  }
  const output = existing?.output ?? nextOutput(state.entries);
  if (!output) throw new Error("The existing EventBridge extractor has no output directory. Fix it in portolan.json first.");
  const previous = existing ? manifest.extract[existing.step] : null;
  const options = { ...previous?.options, regions, cache: output };
  for (const [key, value] of [["buses", buses], ["sources", sources], ["targets", targets]]) {
    if (Object.keys(value).length > 0) options[key] = value;
    else delete options[key];
  }
  if (ruleTags) options.ruleTags = ruleTags;
  else delete options.ruleTags;
  const step = { ...(previous ?? {}), plugin, in: previous?.in ?? ".", out: output, options };
  manifest.extract ??= [];
  if (existing) manifest.extract[existing.step] = step;
  else manifest.extract.push(step);

  const source = `${output}/${FILE}`;
  if (!existing || existing.managed) {
    if (!(manifest.sources ?? []).some((pattern) => matchesGlob(source, pattern))) manifest.sources = [...(manifest.sources ?? []), source];
    for (const catalog of manifest.catalogs ?? []) {
      const catalogSources = (catalog.sources ?? []).filter((item) => item !== source);
      if (!request.catalogs.includes(catalog.id) && catalogSources.some((pattern) => matchesGlob(source, pattern))) throw new Error(`Catalog ${catalog.id} includes this output through a wildcard. Narrow its sources in portolan.json before changing scope.`);
      catalog.sources = request.catalogs.includes(catalog.id) ? [...catalogSources, source] : catalogSources;
    }
  }
  if (read(workspace).revision !== revision) throw new Error("portolan.json changed while settings were being validated. Reload settings and try again.");
  writeManifest(path, manifest);
  return eventBridgeState(workspace);
}
