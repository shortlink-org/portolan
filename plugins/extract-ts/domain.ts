// Aggregates, read off src/domain: the root by the directory's name, the
// entities beside it, the value objects under vo/, the events under events/.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Aggregate, Block, Event, Field as CatalogField } from "../../src/catalog.ts";
import { aggregateID, blockID, eventID, pascal, slug, title } from "./ids.ts";
import { readLifecycle } from "./lifecycle.ts";
import { readSource, type ClassInfo, type Source } from "./source.ts";

export interface Diagnostics {
  warn(ref: string, message: string): void;
}

export interface AggregateRead {
  aggregate: Aggregate;
  /** The directory it was read from, absolute. */
  dir: string;
  /** Event class name → event id, for the flows. */
  events: Map<string, string>;
  /** Class names declared in the directory's own files: the root and the entities. */
  own: Set<string>;
}

export function readAggregates(domainDir: string, svcID: string, rel: (abs: string) => string, b: Diagnostics): AggregateRead[] {
  if (!existsSync(domainDir)) return [];
  const out: AggregateRead[] = [];
  for (const name of readdirSync(domainDir).sort()) {
    const dir = join(domainDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const read = readAggregate(dir, name, svcID, rel, b);
    if (read) out.push(read);
  }
  return out;
}

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .sort()
    .map((f) => join(dir, f));
}

function readAggregate(dir: string, name: string, svcID: string, rel: (abs: string) => string, b: Diagnostics): AggregateRead | null {
  const id = aggregateID(svcID, name);
  const rootName = pascal(name);
  const own = new Set<string>();
  const entities: Block[] = [];
  let root: ClassInfo | undefined;
  let rootFile = "";
  let rootDoc = "";

  for (const file of tsFiles(dir)) {
    const src = readSource(file);
    if (!src) continue;
    for (const c of src.classes) {
      if (!c.exported) continue;
      own.add(c.name);
      if (c.name === rootName) {
        root = c;
        rootFile = file;
        rootDoc = c.doc;
      }
      entities.push(block(id, c));
    }
  }
  if (!root) {
    b.warn(id, `${rel(dir)} has no class ${rootName}; a domain directory is named after its root, and this one is skipped`);
    return null;
  }
  // The root first, then the entities in file order, as extract-go lists them.
  entities.sort((a, c) => (a.name === rootName ? -1 : c.name === rootName ? 1 : 0));

  const valueObjects: Block[] = [];
  for (const file of tsFiles(join(dir, "vo"))) {
    const src = readSource(file);
    for (const c of src?.classes ?? []) if (c.exported) valueObjects.push(block(id, c));
  }

  const events: Event[] = [];
  const eventIds = new Map<string, string>();
  for (const file of tsFiles(join(dir, "events"))) {
    const src = readSource(file);
    for (const c of src?.classes ?? []) {
      if (!c.exported) continue;
      if (c.nameLiteral === undefined) {
        b.warn(id, `${rel(file)}: class ${c.name} has no \`readonly name = "…"\`, so it is not read as an event`);
        continue;
      }
      const evID = eventID(id, c.name);
      eventIds.set(c.name, evID);
      events.push({
        id: evID,
        slug: slug(c.name),
        name: c.name,
        versions: [{ version: "v1", doc: eventDoc(c), source: rel(file), fields: fields(c) }],
        consumers: [],
      });
    }
  }

  const readmePath = join(dir, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8").trim() : rootDoc;
  const lifecycle = readLifecycle(dir, root, rootFile, eventIds, id, rel, b);

  return {
    aggregate: {
      id,
      slug: name,
      name: title(name),
      readme,
      root: rootName,
      entities,
      valueObjects,
      operations: [],
      events,
      ...(lifecycle ? { lifecycle } : {}),
    },
    dir,
    events: eventIds,
    own,
  };
}

function eventDoc(c: ClassInfo): string {
  const doc = c.doc.trim();
  const wire = c.nameLiteral ? `Published on the bus as \`${c.nameLiteral}\`.` : "";
  return [doc, wire].filter(Boolean).join("\n\n");
}

function block(aggregate: string, c: ClassInfo): Block {
  return { id: blockID(aggregate, slug(c.name)), slug: slug(c.name), name: c.name, doc: c.doc, fields: fields(c) };
}

function fields(c: ClassInfo): CatalogField[] {
  return c.fields.map((f) => ({ name: f.name, type: f.type, doc: f.doc }));
}

export { basename as _basename, type Source as _Source };
