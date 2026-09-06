// Aggregates, read off src/domain: the root by the directory's name, the
// entities beside it, the value objects under vo/, the events under events/.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Aggregate, Block, Event, Field as CatalogField } from "../../src/catalog.ts";
import { aggregateID, blockID, eventID, pascal, slug, title } from "./ids.ts";
import { isExportNamed, isIdent, isString, isVarDecl } from "./ast.ts";
import { readLifecycle } from "./lifecycle.ts";
import { docWithDeprecation, readSource, sourceFiles, sourceNamed, type ClassInfo, type Documented, type Source } from "./source.ts";

export interface WarningSink {
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

export function readAggregates(domainDir: string, svcID: string, rel: (abs: string) => string, b: WarningSink): AggregateRead[] {
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

function readAggregate(dir: string, name: string, svcID: string, rel: (abs: string) => string, b: WarningSink): AggregateRead | null {
  const id = aggregateID(svcID, name);
  const rootName = pascal(name);
  const own = new Set<string>();
  const entities: Block[] = [];
  let root: ClassInfo | undefined;
  let rootFile = "";

  for (const file of sourceFiles(dir)) {
    const src = readSource(file);
    if (!src) continue;
    for (const c of src.classes) {
      if (!c.exported) continue;
      own.add(c.name);
      if (c.name === rootName) {
        root = c;
        rootFile = file;
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
  for (const file of sourceFiles(join(dir, "vo"))) {
    const src = readSource(file);
    for (const c of src?.classes ?? []) if (c.exported) valueObjects.push(block(id, c));
  }

  const events: Event[] = [];
  const eventIds = new Map<string, string>();
  const channel = channelOf(dir, name);
  for (const file of sourceFiles(join(dir, "events"))) {
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
        versions: [{ version: "v1", doc: docWithDeprecation(c), ...deprecated(c), source: rel(file), fields: fields(c) }],
        consumers: [],
        wire: { name: c.nameLiteral, ...(channel ? { channel } : {}) },
      });
    }
  }

  const readmePath = join(dir, "README.md");
  // README.md when the author wrote one; else the root class own doc, examples and all.
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8").trim() : readmeOf(root);
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

/**
 * Where the aggregate's events go: the `TOPIC` constant of
 * src/infrastructure/repository/<aggregate>/dto.ts, the module that turns a
 * domain event into a message. The domain names the event and the adapter
 * names the channel, because the channel is a fact about the transport, not
 * about what happened. Empty when the module or the constant is missing.
 */
function channelOf(domainDir: string, aggregate: string): string {
  const src = readSource(sourceNamed(join(domainDir, "..", "..", "infrastructure", "repository", aggregate), "dto"));
  if (!src) return "";
  for (const stmt of src.parsed.program.body) {
    const decl = isExportNamed(stmt) ? stmt.declaration : stmt;
    if (!isVarDecl(decl)) continue;
    for (const d of decl.declarations) {
      if (isIdent(d.id) && d.id.name === "TOPIC" && isString(d.init)) return d.init.value;
    }
  }
  return "";
}

function block(aggregate: string, c: ClassInfo): Block {
  return { id: blockID(aggregate, slug(c.name)), slug: slug(c.name), name: c.name, doc: docWithDeprecation(c), ...deprecated(c), fields: fields(c) };
}

function fields(c: ClassInfo): CatalogField[] {
  return c.fields.map((f) => ({ name: f.name, type: f.type, doc: docWithDeprecation(f), ...deprecated(f) }));
}

/** The flag, only when the tag was there: an absent key is what an older fragment looks like too. */
function deprecated(d: Documented): { deprecated?: true } {
  return d.deprecated === undefined ? {} : { deprecated: true };
}

/**
 * The root's doc comment as the aggregate's page, when there is no README:
 * the prose, then each `@example` as a fenced block, since an example in a
 * comment is code and the page renders markdown.
 */
function readmeOf(root: ClassInfo): string {
  const parts = [docWithDeprecation(root)];
  for (const example of root.examples ?? []) parts.push(example.startsWith("```") ? example : `\`\`\`ts\n${example}\n\`\`\``);
  return parts.filter(Boolean).join("\n\n");
}

export { basename as _basename, type Source as _Source };
