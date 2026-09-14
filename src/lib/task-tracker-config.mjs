// Shared by the settings preview and the Git verifier: no browser-only rules.
export const DEFAULT_KEY_FORMAT = "{project}-{number}";
export const DEFAULT_ISSUE_URL = "{baseUrl}/issue/{key}";

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keyPattern(projects, format = DEFAULT_KEY_FORMAT) {
  if (!Array.isArray(projects) || !projects.length || projects.length > 50 || projects.some((project) => typeof project !== "string" || !/^[A-Z][A-Z0-9_]{0,39}$/.test(project)) || new Set(projects).size !== projects.length) {
    throw new Error("Enter unique project prefixes, such as RT, CORE (up to 50).");
  }
  // A bounded template language, not executable regex. Each token occurs once;
  // punctuation is literal and a key cannot consume an entire commit message.
  if (typeof format !== "string" || format.length > 100 || !/^\{project\}[-_:#/.]{1,4}\{number\}$/.test(format)) {
    throw new Error("Use {project}, a separator (- _ : # / .), then {number}; for example {project}-{number}.");
  }
  const separator = format.slice("{project}".length, -"{number}".length);
  return new RegExp(`(?<![A-Za-z0-9_-])(?:${projects.map(escape).join("|")})${escape(separator)}[0-9]{1,20}(?![A-Za-z0-9_-])`, "g");
}

export function detectTaskKeys(message, tracker) {
  return [...new Set(String(message).match(keyPattern(tracker.projects, tracker.keyFormat)) ?? [])].sort();
}

export function taskUrl(tracker, key) {
  const template = tracker.urlTemplate ?? DEFAULT_ISSUE_URL;
  if (typeof template !== "string" || template.length > 500 || !template.startsWith("{baseUrl}/") || !template.includes("{key}") || /[{}]/.test(template.replaceAll("{baseUrl}", "").replaceAll("{key}", ""))) {
    throw new Error("The link must start with {baseUrl}/ and include {key}; no other placeholders are supported.");
  }
  const base = new URL(tracker.baseUrl);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Enter an HTTP(S) tracker address without credentials, query or fragment.");
  const value = template.replaceAll("{baseUrl}", tracker.baseUrl.replace(/\/+$/, "")).replaceAll("{key}", encodeURIComponent(key));
  const url = new URL(value);
  if (url.origin !== base.origin || url.username || url.password || /[\s\\]/.test(value)) throw new Error("The task link must remain on the configured tracker host.");
  return url.href;
}

export function normalizeTrackers(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Configure up to 20 trackers per repository.");
  const ids = new Set();
  const projects = new Set();
  return value.map((item) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(item.id) || ids.has(item.id) || item.provider !== "youtrack") throw new Error("Use a unique tracker ID (lowercase letters, numbers and dashes) and the YouTrack provider.");
    ids.add(item.id);
    if (item.name !== undefined && (typeof item.name !== "string" || item.name.length > 100)) throw new Error("Tracker name must be at most 100 characters.");
    keyPattern(item.projects, item.keyFormat);
    for (const project of item.projects) {
      if (projects.has(project)) throw new Error(`Project ${project} matches more than one tracker in this checkout.`);
      projects.add(project);
    }
    if (typeof item.baseUrl !== "string") throw new Error("Enter a tracker address.");
    const tracker = {
      id: item.id, provider: "youtrack", baseUrl: item.baseUrl.trim().replace(/\/+$/, ""), projects: [...item.projects],
      ...(item.name ? { name: item.name.trim() } : {}),
      ...(item.keyFormat ? { keyFormat: item.keyFormat } : {}),
      ...(item.urlTemplate ? { urlTemplate: item.urlTemplate } : {}),
    };
    taskUrl(tracker, "RT-101");
    return tracker;
  });
}

/** Explicit allowlist for published catalogs. Never copy arbitrary options. */
export function publicTaskTrackers(manifest) {
  const names = new Set((Array.isArray(manifest?.plugins) ? manifest.plugins : []).filter((plugin) => plugin?.host === "work-items").map((plugin) => plugin.name));
  return (Array.isArray(manifest?.verify) ? manifest.verify : []).flatMap((step, index) => {
    if (!step || !names.has(step.plugin) || typeof step.in !== "string" || typeof step.out !== "string" || [step.in, step.out].some((path) => path.startsWith("/") || /[:\\]/.test(path) || path.split("/").includes(".."))) return [];
    try {
      const maxCommits = step.options?.maxCommits ?? 500;
      const file = step.options?.out ?? "work-items.json";
      if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 10000 || typeof file !== "string" || !file || file.startsWith("/") || /[:\\]/.test(file) || file.split("/").includes("..")) return [];
      return [{ step: index, input: step.in, output: step.out, file, trackers: normalizeTrackers(step.options?.trackers ?? []), maxCommits }];
    } catch { return []; }
  });
}
