// What a field's type is, once the wrapper is taken off - and the shape it
// names, if the catalog has one.
//
// A schema row says `total: Money` or `lines: Vec<Line>`. The extractor that
// wrote it knew the type by name only: a Rust struct, a Go slice, a TS array.
// Nobody wrote a `ref`, because there is no shared def to point at - the
// shape is a value object or an entity of the same aggregate, sitting a few
// hundred bytes away in the same domain file. This module makes that hop.
//
// Two rules keep it honest. A `ref` always wins: it is a claim the source
// made, and a name match is a guess. And the guess stays inside the service:
// two aggregates calling something Money are the same Money only if they
// name the same def, and a match across services would invent that fact.

import type {
  Aggregate,
  Block,
  BlockKind,
  Catalog,
  CatalogIndex,
  Event,
  Field,
  Service,
} from "../catalog";
import { aggregateBlocks, blockFields } from "../catalog";

/** How many of the base type a field holds. */
export type Cardinality = "one" | "many" | "map";

export interface TypeParts {
  /** The name with every wrapper removed: `Vec<Option<Line>>` -> `Line`. */
  base: string;
  cardinality: Cardinality;
  /** `Option<T>`, `*T`, `T | undefined`, `T?`, `optional T`. */
  optional: boolean;
}

const GENERIC = /^(\w+)<(.+)>$/;
const MANY = new Set([
  "Vec",
  "VecDeque",
  "HashSet",
  "BTreeSet",
  "List",
  "Set",
  "Array",
  "ReadonlyArray",
  "Iterable",
  "Sequence",
  "Collection",
]);
const OPTIONAL = new Set(["Option", "Optional", "Maybe", "Nullable"]);
const BOXES = new Set(["Box", "Rc", "Arc", "Readonly", "Cow"]);
const MAPS = new Set(["map", "Map", "HashMap", "BTreeMap", "Record", "Dictionary"]);

/** Splits `K, V` at the top-level comma, leaving nested generics alone. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

/**
 * Takes the wrappers off a type as extractors spell them, in any language
 * the catalog has seen: `Vec<Line>`, `[]LineItem`, `LineItem[]`, `repeated
 * Line`, `Option<Money>`, `*Money`, `Money | undefined`, `map<string, Money>`.
 * `DateTime<Utc>` is a generic too, and comes back whole: a wrapper is only
 * a wrapper when it is one of the names this module knows.
 */
export function parseType(type: string): TypeParts {
  let base = type.trim();
  let cardinality: Cardinality = "one";
  let optional = false;

  // Loops until nothing changes: a `Option<Vec<Line>>` has two wrappers.
  for (;;) {
    let next = base;

    const union = next.match(/^(.+?)\s*\|\s*(undefined|null)$/);
    if (union?.[1]) {
      next = union[1];
      optional = true;
    }
    if (/^\?/.test(next) || /\?$/.test(next)) {
      next = next.replace(/^\?|\?$/g, "");
      optional = true;
    }
    if (next.startsWith("*")) {
      next = next.slice(1);
      optional = true;
    }
    if (/^optional\s+/.test(next)) {
      next = next.replace(/^optional\s+/, "");
      optional = true;
    }
    if (/^repeated\s+/.test(next)) {
      next = next.replace(/^repeated\s+/, "");
      if (cardinality === "one") cardinality = "many";
    }
    if (next.startsWith("[]")) {
      next = next.slice(2);
      if (cardinality === "one") cardinality = "many";
    }
    if (next.endsWith("[]")) {
      next = next.slice(0, -2);
      if (cardinality === "one") cardinality = "many";
    }

    const generic = next.match(GENERIC);
    if (generic?.[1] && generic[2]) {
      const [, outer, args] = generic;
      if (MANY.has(outer)) {
        next = args;
        if (cardinality === "one") cardinality = "many";
      } else if (OPTIONAL.has(outer)) {
        next = args;
        optional = true;
      } else if (BOXES.has(outer)) {
        next = args;
      } else if (MAPS.has(outer)) {
        // The value is what a reader can open; the key is a primitive.
        next = splitArgs(args)[1] ?? args;
        if (cardinality === "one") cardinality = "map";
      }
    }

    next = next.trim();
    if (next === base) break;
    base = next;
  }

  return { base, cardinality, optional };
}

/** Where a type came from, and so where its own fields are read from. */
export type ShapeKind = "def" | BlockKind;

export interface Shape {
  kind: ShapeKind;
  /** The defs key, or the block id. */
  id: string;
  name: string;
  doc: string;
  deprecated: boolean;
  fields: Field[];
  /**
   * The aggregate the shape belongs to, when it is a block. A def belongs
   * to nobody, and its fields resolve in the scope they were reached from.
   */
  aggregate: Aggregate | null;
  service: Service | null;
}

/** Where a name is looked for: the aggregate first, then the rest of the service. */
export interface Scope {
  aggregate: Aggregate | null;
  service: Service | null;
}

function fromBlock(
  catalog: Catalog,
  kind: BlockKind,
  block: Block,
  aggregate: Aggregate,
  service: Service | null,
): Shape {
  return {
    kind,
    id: block.id,
    name: block.name,
    doc: block.doc,
    deprecated: block.deprecated ?? false,
    fields: blockFields(catalog, block),
    aggregate,
    service,
  };
}

function findBlock(
  catalog: Catalog,
  name: string,
  scope: Scope,
): Shape | null {
  const aggregates: Aggregate[] = [];
  if (scope.aggregate) aggregates.push(scope.aggregate);
  for (const aggregate of scope.service?.aggregates ?? []) {
    if (aggregate !== scope.aggregate) aggregates.push(aggregate);
  }
  for (const aggregate of aggregates) {
    for (const { kind, block } of aggregateBlocks(aggregate)) {
      if (block.name === name) {
        return fromBlock(catalog, kind, block, aggregate, scope.service);
      }
    }
  }
  return null;
}

/**
 * The shape a field's type names, or null for a primitive, an enum the
 * extractor did not read, or a name the catalog has nowhere.
 *
 * A `ref` is followed first and is never second-guessed. Without one, the
 * base name is looked for among the blocks of the scope's aggregate, then of
 * the rest of its service - never further.
 */
export function resolveShape(
  catalog: Catalog,
  field: Field,
  scope: Scope,
): Shape | null {
  if (field.ref) {
    const def = catalog.defs[field.ref];
    if (def) {
      return {
        kind: "def",
        id: field.ref,
        name: field.ref,
        doc: "",
        deprecated: false,
        fields: def.fields,
        aggregate: null,
        service: null,
      };
    }
  }
  const { base } = parseType(field.type);
  if (!/^[A-Z]/.test(base)) return null;
  return findBlock(catalog, base, scope);
}

/** The scope a shape's own fields resolve in. */
export function scopeOf(shape: Shape, from: Scope): Scope {
  return shape.aggregate
    ? { aggregate: shape.aggregate, service: shape.service }
    : from;
}

/** The scope an event's fields resolve in. */
export function eventScope(index: CatalogIndex, event: Event): Scope {
  const owner = index.eventOwner.get(event.id);
  return owner
    ? { aggregate: owner.aggregate, service: owner.service }
    : { aggregate: null, service: null };
}

/**
 * How deep a tree is allowed to go. Cycles are cut by the visited set;
 * this is for the honest case of a shape that really does nest eight deep,
 * where a page-length of indentation helps nobody.
 */
export const MAX_DEPTH = 6;

/**
 * Every path a tree of fields can open, "a.b.c" per field, so "expand all"
 * can be one set rather than a walk the component repeats.
 *
 * A shape already on the path is not opened again: `Order.lines[].order`
 * would otherwise be a page that never ends.
 */
export function openablePaths(
  catalog: Catalog,
  fields: Field[],
  scope: Scope,
  prefix = "",
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): string[] {
  if (depth >= MAX_DEPTH) return [];
  const out: string[] = [];
  for (const field of fields) {
    const shape = resolveShape(catalog, field, scope);
    if (!shape || seen.has(shape.id)) continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    out.push(path);
    out.push(
      ...openablePaths(
        catalog,
        shape.fields,
        scopeOf(shape, scope),
        path,
        new Set([...seen, shape.id]),
        depth + 1,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// One version against the one before it.
// ---------------------------------------------------------------------------

export type Change = "new" | "changed" | "removed";

export interface FieldChange {
  change: Change;
  /** The type the field had in the previous version, when it changed. */
  from?: string;
}

/**
 * What a version did to the schema: the fields it added, the ones whose
 * type it changed, and - by name, since they are no longer in the version's
 * own list - the ones it dropped. The first version changes nothing: there
 * is nothing before it to differ from.
 */
export function schemaChanges(
  event: Event,
  version: string,
): { byField: Map<string, FieldChange>; removed: Field[] } {
  const byField = new Map<string, FieldChange>();
  const removed: Field[] = [];
  const i = event.versions.findIndex((v) => v.version === version);
  if (i <= 0) return { byField, removed };
  const prev = event.versions[i - 1];
  const current = event.versions[i];
  if (!prev || !current) return { byField, removed };

  const before = new Map(prev.fields.map((f) => [f.name, f]));
  const now = new Set(current.fields.map((f) => f.name));
  for (const field of current.fields) {
    const was = before.get(field.name);
    if (!was) byField.set(field.name, { change: "new" });
    else if (was.type !== field.type)
      byField.set(field.name, { change: "changed", from: was.type });
  }
  for (const field of prev.fields) {
    if (!now.has(field.name)) removed.push(field);
  }
  return { byField, removed };
}
