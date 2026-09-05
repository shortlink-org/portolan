// The DDD taxonomy, named once. Every surface that draws a node - the sidebar
// tree, the command palette, the pages - reads its icon, colour and label from
// here, so a value object looks like a value object wherever it appears.

export type Kind =
  | "context"
  | "service"
  | "aggregate"
  | "store"
  | "table"
  | "view"
  | "event"
  | "vo"
  | "entity"
  | "command"
  | "query"
  /** One method of one interface: what the outside can actually call. */
  | "endpoint"
  /**
   * A schema module: the .proto files an interface was declared in, named and
   * versioned by a registry. A branch, not a leaf - it holds interfaces the
   * tree already draws elsewhere, so it is not something a filter chip hides.
   */
  | "module"
  | "def"
  | "flow"
  | "adr"
  /**
   * One entry of a context's glossary. Not a building block and not a page of
   * its own: a term is what a building block is CALLED, which is why it sits
   * outside the leaf kinds the tree filters.
   */
  | "term";

/**
 * The leaf kinds a filter chip can switch off, in two groups because the tree
 * has two: what an aggregate holds, then what a store holds. The sidebar draws
 * a row per group - seven labels on one row ellipsized every one of them at
 * every sidebar width, and the break has to land somewhere, so it lands where
 * the meaning already breaks.
 */
export const MODEL_LEAF_KINDS = [
  "event",
  "vo",
  "entity",
  "command",
  "query",
] as const;
export const STORE_LEAF_KINDS = ["table", "view"] as const;

/**
 * What a service ANSWERS, which is neither of the other two: an endpoint is not
 * held by an aggregate and not held by a store, it is how the outside reaches
 * the one and eventually moves the other. Its own group, and a row of its own.
 */
export const INTERFACE_LEAF_KINDS = ["endpoint"] as const;

/**
 * The groups as the filter draws them, one row each. Written once because the
 * chip rows, the line that says what is hidden, and the test that holds every
 * leaf to exactly one row all have to agree, and three copies of a list is how
 * a kind ends up filterable nowhere.
 */
export const LEAF_KIND_ROWS = [
  MODEL_LEAF_KINDS,
  INTERFACE_LEAF_KINDS,
  STORE_LEAF_KINDS,
] as const;

/** Every group, in tree order. */
export const LEAF_KINDS = [
  ...MODEL_LEAF_KINDS,
  ...INTERFACE_LEAF_KINDS,
  ...STORE_LEAF_KINDS,
] as const;
export type LeafKind = (typeof LEAF_KINDS)[number];

export function isLeafKind(kind: Kind): kind is LeafKind {
  return (LEAF_KINDS as readonly Kind[]).includes(kind);
}

export const KIND_LABEL: Record<Kind, string> = {
  context: "context",
  service: "service",
  aggregate: "aggregate",
  store: "store",
  table: "table",
  view: "view",
  event: "event",
  vo: "value object",
  entity: "entity",
  command: "command",
  query: "query",
  endpoint: "endpoint",
  module: "buf module",
  def: "shared type",
  flow: "flow",
  adr: "decision",
  term: "term",
};

export const KIND_PLURAL: Record<Kind, string> = {
  context: "contexts",
  service: "services",
  aggregate: "aggregates",
  store: "stores",
  table: "tables",
  view: "views",
  event: "events",
  vo: "value objects",
  entity: "entities",
  command: "commands",
  query: "queries",
  endpoint: "endpoints",
  module: "buf modules",
  def: "shared types",
  flow: "flows",
  adr: "decisions",
  term: "terms",
};

/** Short label for a filter chip, where the row has no room for the plural. */
export const KIND_CHIP: Record<LeafKind, string> = {
  event: "events",
  vo: "VO",
  entity: "entities",
  command: "cmd",
  query: "qry",
  endpoint: "api",
  table: "tables",
  view: "views",
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
  // An endpoint is reached by the name the interface calls it, which is what
  // a reader has in front of them when they are looking at a request.
  endpoint: ["api", "endpoint", "endpoints"],
  // A module is the schema a service publishes, which is not the same question
  // as what it answers: "api: place" finds the endpoint, "mod: shop" the module
  // it was declared in.
  module: ["mod", "module", "modules", "buf"],
  // A shared type is the shape a value object NAMES, not the value object
  // itself: "type: money" finds the def, "vo: money" finds what names it.
  def: ["type", "def", "types"],
  aggregate: ["agg", "aggregate", "aggregates"],
  // A store is where state lives and a table is one shape inside it, so the
  // two never share a prefix: "db: pg" finds the store, "tbl: orders" the table.
  store: ["db", "store", "stores"],
  table: ["tbl", "table", "tables"],
  // A view is a table the database computes, so it answers to its own prefix
  // rather than to "tbl": a reader who types one is not asking for the other.
  view: ["view", "views", "vw"],
  service: ["svc", "service", "services"],
  context: ["ctx", "context", "contexts"],
  flow: ["flow", "flows"],
  adr: ["adr", "adrs", "decision", "decisions"],
  // A term is the word, not the thing: "t: session" finds what the glossary
  // says a session is, "agg: session" finds the aggregate it names.
  term: ["t", "term", "terms", "word", "glossary"],
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
