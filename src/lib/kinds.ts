// The DDD taxonomy, named once. Every surface that draws a node - the sidebar
// tree, the command palette, the pages - reads its icon, colour and label from
// here, so a value object looks like a value object wherever it appears.

export type Kind =
  | "context"
  | "service"
  | "aggregate"
  | "event"
  | "vo"
  | "entity"
  | "command"
  | "query"
  | "def"
  | "flow"
  | "adr";

/** The five leaf kinds a filter chip can switch off. Order is the tree order. */
export const LEAF_KINDS = [
  "event",
  "vo",
  "entity",
  "command",
  "query",
] as const;
export type LeafKind = (typeof LEAF_KINDS)[number];

export function isLeafKind(kind: Kind): kind is LeafKind {
  return (LEAF_KINDS as readonly Kind[]).includes(kind);
}

export const KIND_LABEL: Record<Kind, string> = {
  context: "context",
  service: "service",
  aggregate: "aggregate",
  event: "event",
  vo: "value object",
  entity: "entity",
  command: "command",
  query: "query",
  def: "shared type",
  flow: "flow",
  adr: "decision",
};

export const KIND_PLURAL: Record<Kind, string> = {
  context: "contexts",
  service: "services",
  aggregate: "aggregates",
  event: "events",
  vo: "value objects",
  entity: "entities",
  command: "commands",
  query: "queries",
  def: "shared types",
  flow: "flows",
  adr: "decisions",
};

/** Short label for a filter chip, where the row has no room for the plural. */
export const KIND_CHIP: Record<LeafKind, string> = {
  event: "events",
  vo: "VO",
  entity: "entities",
  command: "cmd",
  query: "qry",
};

/**
 * Palette prefixes. The first entry is the canonical one and is what the
 * palette echoes back; the rest are accepted spellings.
 */
export const KIND_PREFIXES: Record<Kind, string[]> = {
  event: ["e", "ev", "event", "events"],
  vo: ["vo", "value-object", "valueobject"],
  entity: ["ent", "entity", "entities"],
  command: ["cmd", "command", "commands"],
  query: ["q", "query", "queries"],
  // A shared type is the shape a value object NAMES, not the value object
  // itself: "type: money" finds the def, "vo: money" finds what names it.
  def: ["type", "def", "types"],
  aggregate: ["agg", "aggregate", "aggregates"],
  service: ["svc", "service", "services"],
  context: ["ctx", "context", "contexts"],
  flow: ["flow", "flows"],
  adr: ["adr", "adrs", "decision", "decisions"],
};

const BY_PREFIX = new Map<string, Kind>();
for (const [kind, prefixes] of Object.entries(KIND_PREFIXES) as [
  Kind,
  string[],
][]) {
  for (const prefix of prefixes) BY_PREFIX.set(prefix, kind);
}

export function kindForPrefix(prefix: string): Kind | null {
  return BY_PREFIX.get(prefix.trim().toLowerCase()) ?? null;
}

export interface ParsedQuery {
  /** Restriction asked for by a "vo:" style prefix, or null for everything. */
  kind: Kind | null;
  /** What to match on. */
  term: string;
  /** The prefix as typed, so the palette can show it was understood. */
  prefix: string | null;
}

/**
 * "vo: money" restricts to value objects and searches for "money".
 * An unrecognised prefix is not a restriction - "http://x" and "note: this"
 * are searched whole rather than silently returning nothing.
 */
export function parseQuery(raw: string): ParsedQuery {
  const match = /^\s*([A-Za-z-]+)\s*:\s*([\s\S]*)$/.exec(raw);
  if (match) {
    const prefix = match[1] ?? "";
    const kind = kindForPrefix(prefix);
    if (kind) return { kind, term: (match[2] ?? "").trim(), prefix };
  }
  return { kind: null, term: raw.trim(), prefix: null };
}

/** The canonical prefix for a kind, for hints and for completing a chip. */
export function canonicalPrefix(kind: Kind): string {
  return KIND_PREFIXES[kind][0] as string;
}
