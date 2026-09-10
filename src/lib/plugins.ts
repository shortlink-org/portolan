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
  | "infrastructure"
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
  "infrastructure",
  "repository",
  "documents",
  "evidence",
  "sources",
  "exports",
];

/**
 * A glyph without a brand: one of the lucide icons PluginIcon knows to draw.
 * Named here as words rather than components so this module stays free of
 * React and the tests can read it.
 */
export type PluginGlyph =
  | "code"
  | "contract"
  | "message"
  | "database"
  | "cloud"
  | "repository"
  | "pen"
  | "shield"
  | "fork"
  | "share"
  | "inbox"
  | "file-code"
  | "package"
  | "waves"
  | "workflow"
  | "users"
  | "globe"
  | "terminal"
  | "book"
  | "spell-check"
  | "route";

/** A brand's own mark, looked up by the name `techGlyph` answers to, or a lucide glyph. */
export type PluginIconSpec = { brand: string } | { lucide: PluginGlyph };

export const CATEGORY_LABEL: Record<PluginCategory, { title: string; what: string; icon: PluginGlyph }> = {
  code: {
    title: "Languages",
    what: "The aggregates, events and use cases a service declares in its source.",
    icon: "code",
  },
  contracts: {
    title: "Contracts",
    what: "What a service provides and calls, read from the interface it publishes.",
    icon: "contract",
  },
  messaging: {
    title: "Queues and topics",
    what: "The subjects, queues and jobs a service sends on and listens to.",
    icon: "message",
  },
  data: {
    title: "Data stores",
    what: "The stores a service keeps, and the shape of what is in them.",
    icon: "database",
  },
  infrastructure: {
    title: "Infrastructure",
    what: "What a service is deployed on, and the wiring between the pieces that only the infrastructure knows.",
    icon: "cloud",
  },
  repository: {
    title: "Repository",
    what: "What the repository says about itself: its metadata and its task runners.",
    icon: "repository",
  },
  documents: {
    title: "Written by hand",
    what: "Decisions, glossaries and flows that people wrote down.",
    icon: "pen",
  },
  evidence: {
    title: "Evidence",
    what: "The catalog checked against something outside the code.",
    icon: "shield",
  },
  sources: {
    title: "Other repositories",
    what: "Trees fetched from elsewhere, pinned, for the extractors to read.",
    icon: "fork",
  },
  exports: {
    title: "Exports",
    what: "The catalog turned into something else.",
    icon: "share",
  },
};

/**
 * What a plugin is called where a person reads it, and the mark beside the
 * name, keyed by manifest name. A brand mark where the plugin reads one
 * technology and the reader knows its logo; a lucide glyph where it reads a
 * format or a convention that has none.
 */
const PLUGIN_META: Record<string, { label: string; icon: PluginIconSpec }> = {
  project: { label: "Project metadata", icon: { lucide: "repository" } },
  commands: { label: "Task runners", icon: { lucide: "terminal" } },
  "go-domain": { label: "Go", icon: { brand: "Go" } },
  "ts-domain": { label: "TypeScript", icon: { brand: "TypeScript" } },
  "rust-domain": { label: "Rust", icon: { brand: "Rust" } },
  "laravel-domain": { label: "Laravel", icon: { brand: "Laravel" } },
  "java-domain": { label: "Java", icon: { brand: "Java" } },
  "django-domain": { label: "Django", icon: { brand: "Django" } },
  celery: { label: "Celery", icon: { brand: "Celery" } },
  "python-kafka": { label: "Kafka", icon: { brand: "Kafka" } },
  openapi: { label: "OpenAPI", icon: { brand: "OpenAPI" } },
  wsdl: { label: "WSDL", icon: { lucide: "file-code" } },
  "http-clients": { label: "HTTP clients", icon: { lucide: "globe" } },
  redis: { label: "Redis", icon: { brand: "Redis" } },
  river: { label: "River", icon: { lucide: "waves" } },
  watermill: { label: "Watermill", icon: { lucide: "workflow" } },
  "go-nats": { label: "NATS", icon: { brand: "NATS" } },
  "go-sqs": { label: "SQS", icon: { lucide: "inbox" } },
  terraform: { label: "Terraform", icon: { brand: "Terraform" } },
  asyncapi: { label: "AsyncAPI", icon: { lucide: "file-code" } },
  graphql: { label: "GraphQL", icon: { brand: "GraphQL" } },
  sql: { label: "SQL", icon: { lucide: "database" } },
  markdown: { label: "Markdown", icon: { brand: "Markdown" } },
  mermaid: { label: "Mermaid", icon: { brand: "Mermaid" } },
  backstage: { label: "Backstage", icon: { brand: "Backstage" } },
  otel: { label: "OpenTelemetry", icon: { brand: "OpenTelemetry" } },
  codeowners: { label: "CODEOWNERS", icon: { lucide: "users" } },
  adr: { label: "Decision records", icon: { lucide: "book" } },
  glossary: { label: "Glossary", icon: { lucide: "spell-check" } },
  flows: { label: "Flows", icon: { lucide: "route" } },
  bsr: { label: "Buf Schema Registry", icon: { lucide: "package" } },
  git: { label: "Git", icon: { brand: "Git" } },
  csr: { label: "Confluent Schema Registry", icon: { lucide: "package" } },
  "csr-schemas": { label: "Registry schemas", icon: { lucide: "file-code" } },
  proto: { label: "Protobuf", icon: { lucide: "file-code" } },
};

export function pluginLabel(name: string): string {
  return PLUGIN_META[name]?.label ?? name;
}

/** True when the plugin has a name a reader would recognise, not a manifest key. */
export function hasPluginLabel(name: string): boolean {
  return name in PLUGIN_META;
}

/** The mark beside a plugin's name; a plugin nobody named yet gets its category's glyph. */
export function pluginIcon(name: string, category?: PluginCategory): PluginIconSpec {
  return PLUGIN_META[name]?.icon ?? { lucide: CATEGORY_LABEL[category ?? "code"].icon };
}

export function pluginByName(name: string): PluginEntry | undefined {
  return pluginIndex.find((entry) => entry.name === name);
}

export interface PluginGroup {
  category: PluginCategory;
  title: string;
  what: string;
  icon: PluginGlyph;
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
