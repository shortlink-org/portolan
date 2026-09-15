// Shared by the settings preview and the Git verifier: no browser-only rules.
export const DEFAULT_KEY_FORMAT = "{project}-{number}";
export const DEFAULT_ISSUE_URL = "{baseUrl}/issue/{key}";
export const TRACKER_PROVIDERS = {
  youtrack: { label: "YouTrack", numbered: false, keyFormat: DEFAULT_KEY_FORMAT, urlTemplate: DEFAULT_ISSUE_URL, addressLabel: "Tracker address", placeholder: "https://youtrack.company.ru" },
  jira: { label: "Jira", numbered: false, keyFormat: DEFAULT_KEY_FORMAT, urlTemplate: "{baseUrl}/browse/{key}", addressLabel: "Jira address", placeholder: "https://team.atlassian.net" },
  linear: { label: "Linear", numbered: false, keyFormat: DEFAULT_KEY_FORMAT, urlTemplate: DEFAULT_ISSUE_URL, addressLabel: "Workspace address", placeholder: "https://linear.app/team" },
  github: { label: "GitHub Issues", numbered: true, keyFormat: "#{number}", urlTemplate: "{baseUrl}/issues/{number}", addressLabel: "Repository address", placeholder: "https://github.com/owner/repository" },
  gitlab: { label: "GitLab Issues", numbered: true, keyFormat: "#{number}", urlTemplate: "{baseUrl}/-/issues/{number}", addressLabel: "Project address", placeholder: "https://gitlab.com/group/project" },
};

function providerFor(tracker) {
  if (!Object.hasOwn(TRACKER_PROVIDERS, tracker.provider)) throw new Error("Choose a supported task tracker provider.");
  return TRACKER_PROVIDERS[tracker.provider];
}

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
  if (providerFor(tracker).numbered) {
    const path = new URL(tracker.baseUrl).pathname.replace(/^\/+|\/+$/g, "");
    const number = "([1-9][0-9]{0,19})(?![A-Za-z0-9_-])";
    const qualified = new RegExp(`(?<![A-Za-z0-9_/\\\\-])${escape(path)}#${number}`, tracker.provider === "github" ? "gi" : "g");
    const keys = [...String(message).matchAll(qualified)].map((match) => `#${match[1]}`);
    if (tracker.matchBareNumbers !== false) {
      const bare = new RegExp(`(?<![A-Za-z0-9_/#!\\\\-])#${number}`, "g");
      keys.push(...[...String(message).matchAll(bare)].map((match) => `#${match[1]}`));
    }
    return [...new Set(keys)].sort();
  }
  return [...new Set(String(message).match(keyPattern(tracker.projects, tracker.keyFormat)) ?? [])].sort();
}

export function taskUrl(tracker, key) {
  const provider = providerFor(tracker);
  const template = tracker.urlTemplate ?? provider.urlTemplate;
  if (typeof template !== "string" || template.length > 500 || !template.startsWith("{baseUrl}/") || !(template.includes("{key}") || (provider.numbered && template.includes("{number}"))) || /[{}]/.test(template.replaceAll("{baseUrl}", "").replaceAll("{key}", "").replaceAll(provider.numbered ? "{number}" : "{key}", ""))) {
    throw new Error("The link must start with {baseUrl}/ and include {key} (or {number} for GitHub/GitLab); no other placeholders are supported.");
  }
  const base = new URL(tracker.baseUrl);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Enter an HTTP(S) tracker address without credentials, query or fragment.");
  if (provider.numbered && !/^#[1-9][0-9]{0,19}$/.test(key)) throw new Error("Use a numeric issue key such as #123.");
  const value = template.replaceAll("{baseUrl}", tracker.baseUrl.replace(/\/+$/, "")).replaceAll("{key}", encodeURIComponent(key)).replaceAll("{number}", encodeURIComponent(key.slice(1)));
  const url = new URL(value);
  if (url.origin !== base.origin || url.username || url.password || /[\s\\]/.test(value)) throw new Error("The task link must remain on the configured tracker host.");
  return url.href;
}

export function normalizeTrackers(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Configure up to 20 trackers per repository.");
  const ids = new Set();
  const projects = new Set();
  let bareNumbers = false;
  return value.map((item) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(item.id) || ids.has(item.id)) throw new Error("Use a unique tracker ID (lowercase letters, numbers and dashes).");
    const provider = providerFor(item);
    ids.add(item.id);
    if (item.name !== undefined && (typeof item.name !== "string" || item.name.length > 100)) throw new Error("Tracker name must be at most 100 characters.");
    if (provider.numbered) {
      if (!Array.isArray(item.projects) || item.projects.length || (item.keyFormat !== undefined && item.keyFormat !== "#{number}")) throw new Error("GitHub/GitLab use #{number} without project prefixes; set the repository/project address.");
      if (item.matchBareNumbers !== undefined && typeof item.matchBareNumbers !== "boolean") throw new Error("Short issue references must be enabled or disabled.");
      if (item.matchBareNumbers !== false) {
        if (bareNumbers) throw new Error("Only one tracker per checkout can match short #123 references. Disable short references for the others; qualified project references still work.");
        bareNumbers = true;
      }
    } else {
      keyPattern(item.projects, item.keyFormat);
      if (item.matchBareNumbers !== undefined) throw new Error("Short #123 references are only supported for GitHub/GitLab.");
    }
    for (const project of item.projects) {
      if (projects.has(project)) throw new Error(`Project ${project} matches more than one tracker in this checkout.`);
      projects.add(project);
    }
    if (typeof item.baseUrl !== "string") throw new Error("Enter a tracker address.");
    const tracker = {
      id: item.id, provider: item.provider, baseUrl: item.baseUrl.trim().replace(/\/+$/, ""), projects: [...item.projects],
      ...(item.name ? { name: item.name.trim() } : {}),
      ...(item.keyFormat ? { keyFormat: item.keyFormat } : {}),
      ...(item.urlTemplate ? { urlTemplate: item.urlTemplate } : {}),
      ...(item.matchBareNumbers !== undefined ? { matchBareNumbers: item.matchBareNumbers } : {}),
    };
    taskUrl(tracker, provider.numbered ? "#123" : "RT-101");
    const segments = new URL(tracker.baseUrl).pathname.split("/").filter(Boolean);
    if (provider.numbered && (segments.length < 2 || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment)))) throw new Error("Enter the complete repository/project address, including owner or group and project name.");
    if (item.provider === "linear" && !segments.length) throw new Error("Include the Linear workspace in its address, for example https://linear.app/team.");
    return tracker;
  });
}

/**
 * The name Portolan's own manifest gives the work-items host plugin. A step
 * names a built-in without declaring it - gen resolves it from the package
 * (scripts/builtin-plugins.mjs) - so a verifier naming it is one even where
 * `plugins` is silent.
 */
export const WORK_ITEMS_PLUGIN = "work-items";

/**
 * The plugin names a verify step may carry to be a work-items verifier: every
 * declaration running the `work-items` host, and the built-in name unless the
 * manifest declares something else under it. As in gen, a declaration wins.
 */
export function workItemsPluginNames(manifest) {
  const plugins = (Array.isArray(manifest?.plugins) ? manifest.plugins : []).filter((plugin) => plugin && typeof plugin === "object");
  const names = new Set(plugins.filter((plugin) => plugin.host === "work-items").map((plugin) => plugin.name));
  if (!plugins.some((plugin) => plugin.name === WORK_ITEMS_PLUGIN)) names.add(WORK_ITEMS_PLUGIN);
  return names;
}

/** Explicit allowlist for published catalogs. Never copy arbitrary options. */
export function publicTaskTrackers(manifest) {
  const names = workItemsPluginNames(manifest);
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
