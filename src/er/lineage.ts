// Where a value came from, and who reads it.
//
// Foreign keys are a picture of the schema at rest: this row points at that
// one. Lineage is a picture of the schema in motion — a column of a view, of a
// projection, of an outbox is a copy of a column somewhere else, and the only
// question worth asking of it is which one, and what else was copied from the
// same place.
//
// Pure, and deliberately ignorant of the catalog: two maps in, ids out. The
// index builds the maps once (catalog.ts), the canvas walks them on hover.

/** The lineage graph, in both directions. Keys and values are column ids. */
export interface LineageMaps {
  /** column -> the columns it is computed from */
  from: ReadonlyMap<string, readonly string[]>;
  /** column -> the columns computed from it */
  into: ReadonlyMap<string, readonly string[]>;
}

/**
 * One lineage edge's id, source first. The canvas draws edges data-first —
 * left to right, the way it flows — so the id reads the same way.
 */
export function lineageEdgeId(source: string, target: string): string {
  return `${source}~>${target}`;
}

/** Splits an edge id back into its two ends, or null when it is not one. */
export function parseLineageEdgeId(
  id: string,
): { source: string; target: string } | null {
  const at = id.indexOf("~>");
  if (at <= 0) return null;
  return { source: id.slice(0, at), target: id.slice(at + 2) };
}

/**
 * Walks one direction to exhaustion. Every step is guarded by `seen`, so a
 * catalog that says a view feeds the table it reads — which a mid-migration
 * catalog is allowed to say — is a cycle that terminates rather than a hang.
 */
function walk(
  edges: ReadonlyMap<string, readonly string[]>,
  start: string,
  onEdge: (a: string, b: string) => void,
): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of edges.get(current) ?? []) {
      onEdge(current, next);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Every column this one is computed from, however many hops away. */
export function upstreamOf(maps: LineageMaps, id: string): Set<string> {
  return walk(maps.from, id, () => {});
}

/** Every column computed from this one, however many hops away. */
export function downstreamOf(maps: LineageMaps, id: string): Set<string> {
  return walk(maps.into, id, () => {});
}

/**
 * The whole chain through one column: everything it came from, everything read
 * from it, and the edges joining them.
 *
 * Both directions, because a reader hovering a column is asking one question
 * with two halves — "if this changes, what breaks, and if this is wrong, where
 * did it go wrong". The column itself is in `columns`, so the caller can light
 * the chain without special-casing where the pointer is.
 */
export interface LineageChain {
  columns: Set<string>;
  edges: Set<string>;
}

export function lineageChain(maps: LineageMaps, id: string): LineageChain {
  const columns = new Set<string>([id]);
  const edges = new Set<string>();

  for (const found of walk(maps.from, id, (target, source) =>
    edges.add(lineageEdgeId(source, target)),
  )) {
    columns.add(found);
  }
  for (const found of walk(maps.into, id, (source, target) =>
    edges.add(lineageEdgeId(source, target)),
  )) {
    columns.add(found);
  }

  return { columns, edges };
}

/** True when nothing in the catalog is derived from this column or feeds it. */
export function isIsolated(maps: LineageMaps, id: string): boolean {
  return (maps.from.get(id)?.length ?? 0) === 0 &&
    (maps.into.get(id)?.length ?? 0) === 0;
}
