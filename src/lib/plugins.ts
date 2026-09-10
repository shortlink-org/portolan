// The plugin index: every plugin the package ships, as it describes itself.
//
// `src/lib/plugin-index.json` is written by `npm run schema` from the answer
// each plugin gives to `describe` and from how portolan.json runs it. Nothing
// here is typed by hand except the words a reader sees: the category titles,
// and a display name per plugin, because "go-sqs" is a manifest key and "SQS"
// is what the landing page says.

import { PRODUCT_REPOSITORY } from "./product";
import raw from "./plugin-index.json";

export type PluginCategory =
  | "code"
  | "contracts"
  | "messaging"
  | "data"
  | "repository"
  | "documents"
  | "evidence"
  | "sources"
  | "exports";

export type PluginPhase = "extract" | "verify" | "generate";

export interface PluginOption {
  type?: string | string[];
  description?: string;
}

export interface PluginEntry {
  /** The name the manifest declares it under - what a step names. */
  name: string;
  /** What the plugin calls itself: its directory under plugins/. */
  plugin: string;
  summary: string;
  category: PluginCategory;
  phases: PluginPhase[];
  needs?: string[];
  runtime: "wasm" | "process" | "host";
  /** The command a host process asks the build for; absent for a module. */
  toolchain?: string;
  /** Repository-relative path to the plugin's source. */
  source: string;
  options: {
    properties?: Record<string, PluginOption>;
    required?: string[];
  };
}

// The JSON's inferred type is the union of every plugin's option keys, which
// is why the cast goes through unknown: the shape is what matters, not which
// keys one file happens to have.
export const pluginIndex: PluginEntry[] = raw as unknown as PluginEntry[];

/** The order the categories read in: what is read first, then what is made. */
export const CATEGORY_ORDER: PluginCategory[] = [
  "code",
  "contracts",
  "messaging",
  "data",
  "repository",
  "documents",
  "evidence",
  "sources",
  "exports",
];

export const CATEGORY_LABEL: Record<PluginCategory, { title: string; what: string }> = {
  code: {
    title: "Languages",
    what: "The aggregates, events and use cases a service declares in its source.",
  },
  contracts: {
    title: "Contracts",
    what: "What a service provides and calls, read from the interface it publishes.",
  },
  messaging: {
    title: "Queues and topics",
    what: "The subjects, queues and jobs a service sends on and listens to.",
  },
  data: {
    title: "Data stores",
    what: "The stores a service keeps, and the shape of what is in them.",
  },
  repository: {
    title: "Repository",
    what: "What the repository says about itself: its metadata and its task runners.",
  },
  documents: {
    title: "Written by hand",
    what: "Decisions, glossaries and flows that people wrote down.",
  },
  evidence: {
    title: "Evidence",
    what: "The catalog checked against something outside the code.",
  },
  sources: {
    title: "Other repositories",
    what: "Trees fetched from elsewhere, pinned, for the extractors to read.",
  },
  exports: {
    title: "Exports",
    what: "The catalog turned into something else.",
  },
};

/** What a plugin is called where a person reads it, keyed by manifest name. */
const PLUGIN_LABEL: Record<string, string> = {
  project: "Project metadata",
  commands: "Task runners",
  "go-domain": "Go",
  "ts-domain": "TypeScript",
  "rust-domain": "Rust",
  "laravel-domain": "Laravel",
  "java-domain": "Java",
  "django-domain": "Django",
  celery: "Celery",
  "python-kafka": "Kafka",
  openapi: "OpenAPI",
  wsdl: "WSDL",
  "http-clients": "HTTP clients",
  redis: "Redis",
  river: "River",
  watermill: "Watermill",
  "go-nats": "NATS",
  "go-sqs": "SQS",
  asyncapi: "AsyncAPI",
  graphql: "GraphQL",
  sql: "SQL",
  markdown: "Markdown",
  mermaid: "Mermaid",
  backstage: "Backstage",
  otel: "OpenTelemetry",
  codeowners: "CODEOWNERS",
  adr: "Decision records",
  glossary: "Glossary",
  flows: "Flows",
  bsr: "Buf Schema Registry",
  git: "Git",
  csr: "Confluent Schema Registry",
  "csr-schemas": "Registry schemas",
  proto: "Protobuf",
};

export function pluginLabel(name: string): string {
  return PLUGIN_LABEL[name] ?? name;
}

/** True when the plugin has a name a reader would recognise, not a manifest key. */
export function hasPluginLabel(name: string): boolean {
  return name in PLUGIN_LABEL;
}

export function pluginByName(name: string): PluginEntry | undefined {
  return pluginIndex.find((entry) => entry.name === name);
}

export interface PluginGroup {
  category: PluginCategory;
  title: string;
  what: string;
  plugins: PluginEntry[];
}

/** The index by category, in reading order, each group sorted by display name. */
export function pluginsByCategory(entries: PluginEntry[] = pluginIndex): PluginGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    ...CATEGORY_LABEL[category],
    plugins: entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => pluginLabel(a.name).localeCompare(pluginLabel(b.name))),
  })).filter((group) => group.plugins.length > 0);
}

/** The categories the landing page lists as inputs: what is read, not what is made. */
const LANDING_CATEGORIES: PluginCategory[] = ["code", "contracts", "messaging", "data", "evidence"];

/** One line per input category, the display names of what reads it. */
export function landingInputs(entries: PluginEntry[] = pluginIndex): { label: string; items: string[] }[] {
  return pluginsByCategory(entries)
    .filter((group) => LANDING_CATEGORIES.includes(group.category))
    .map((group) => ({
      label: group.title.toLowerCase(),
      items: group.plugins.map((entry) => pluginLabel(entry.name)),
    }));
}

/** Where the plugin's source is read, on the public repository. */
export function pluginSourceHref(entry: PluginEntry): string {
  return `${PRODUCT_REPOSITORY}/tree/main/${entry.source}`;
}

/** The runtime as a reader would say it. */
export function runtimeLabel(entry: PluginEntry): string {
  if (entry.runtime === "wasm") return "WASM sandbox";
  if (entry.runtime === "host") return "in the host";
  return entry.toolchain ? `host process · ${entry.toolchain}` : "host process";
}
