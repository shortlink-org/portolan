// Catalogs that do not exist, built to be difficult.
//
// data/catalog.json is the sample: one estate, hand-written, the size a reader
// can hold in their head. It is exactly the wrong thing to test a layout with,
// because everything in it fits. These are the other three shapes — an estate
// too wide to fit, an estate too thin to spread, and a schema shaped like
// every mistake a schema can make — and they exist so a canvas is asserted
// against them rather than eyeballed against the sample.
//
// Nothing here is loaded by the app. It is imported by tests and by nothing
// else, which is why it can afford to build 200 tables in a loop.

import type {
  Aggregate,
  BoundedContext,
  Catalog,
  Column,
  Event,
  Status,
  Service,
  Store,
  Table,
} from "../catalog";

const EMPTY: Catalog = {
  generatedAt: "2026-01-01T00:00:00Z",
  commit: "0000000",
  contexts: [],
  defs: {},
  flows: [],
  adrs: [],
  stores: [],
};

function column(name: string, type: string, extra: Partial<Column> = {}): Column {
  return { name, type, nullable: false, ...extra };
}

/** A minimal aggregate with one entity, so `persists` has something to resolve to. */
function aggregate(
  serviceId: string,
  slug: string,
  name: string,
  events: Event[] = [],
): Aggregate {
  const id = `${serviceId}.${slug}`;
  return {
    id,
    slug,
    name,
    readme: "",
    root: name,
    entities: [
      {
        id: `${id}.${slug}`,
        slug,
        name,
        doc: "",
        fields: [
          { name: "id", type: "string", doc: "" },
          { name: "state", type: "string", doc: "" },
        ],
      },
    ],
    valueObjects: [],
    operations: [],
    events,
  };
}

/** One event with one version, and whatever consumers the scenario wants. */
function event(
  aggregateId: string,
  name: string,
  consumers: Event["consumers"] = [],
): Event {
  return {
    id: `${aggregateId}.${name}`,
    slug: name.toLowerCase(),
    name,
    versions: [
      {
        version: "v1",
        doc: "",
        source: "scenario",
        fields: [{ name: "id", type: "string", doc: "" }],
      },
    ],
    consumers,
  };
}

function service(
  contextId: string,
  slug: string,
  aggregates: string[],
  events: (aggregateId: string) => Event[] = () => [],
): Service {
  const id = `${contextId}.${slug}`;
  return {
    id,
    slug,
    name: slug,
    repo: `git@example.com:${contextId}/${slug}.git`,
    path: `/${contextId}/${slug}`,
    readme: "",
    provides: [],
    consumes: [],
    aggregates: aggregates.map((a) =>
      aggregate(id, a, a, events(`${id}.${a}`)),
    ),
    stores: [`${id}.pg`],
  };
}

const WIDE_CONTEXTS = 8;
const WIDE_SERVICES = 5;

/** Deterministic status wheel, so the scenario covers all three markers. */
const WIDE_STATUS: Status[] = ["verified", "declared", "unresolved"];

/**
 * Forty stores, nearly three hundred tables, foreign-key chains six deep - and
 * eighty events wired across context boundaries.
 *
 * The chains are the point for the ER canvas: a layered layout is cheap on a
 * star and expensive on a chain, and a canvas that reads well at four tables
 * can put the sixth layer off the right-hand edge without anyone noticing
 * until an estate this size arrives.
 *
 * The events are the point for the dependency graph, which draws a node per
 * event and therefore has 120 boxes to place here rather than 40. That is the
 * number the layout budget is measured against; the sample's nine would pass
 * any budget at all.
 */
export function wideCatalog(): Catalog {
  const contexts: BoundedContext[] = [];
  const stores: Store[] = [];

  // Who listens to (c, s): the same slot one context along, the next slot two
  // contexts along, and a neighbour at home. Deterministic, and it crosses
  // every context boundary rather than clustering inside one.
  const listeners = (c: number, s: number): string[] => [
    `ctx${(c + 1) % WIDE_CONTEXTS}.svc${s}`,
    `ctx${(c + 2) % WIDE_CONTEXTS}.svc${(s + 1) % WIDE_SERVICES}`,
    `ctx${c}.svc${(s + 2) % WIDE_SERVICES}`,
  ];

  for (let c = 0; c < WIDE_CONTEXTS; c += 1) {
    const contextId = `ctx${c}`;
    const services: Service[] = [];
    for (let s = 0; s < WIDE_SERVICES; s += 1) {
      const svc = service(contextId, `svc${s}`, ["root"], (aggregateId) => [
        event(
          aggregateId,
          `Opened${c}${s}`,
          listeners(c, s).map((service, i) => ({
            service,
            status: WIDE_STATUS[(c + s + i) % 3] ?? "verified",
          })),
        ),
        event(aggregateId, `Closed${c}${s}`, [
          // One consumer nobody has heard of, every fifth service: the ghost
          // node has to survive a graph this size too.
          ...(s === 0
            ? [{ service: `legacy-${contextId}`, status: "unresolved" as const }]
            : []),
          {
            service: `ctx${(c + 3) % WIDE_CONTEXTS}.svc${s}`,
            status: "verified" as const,
          },
        ]),
      ]);
      services.push(svc);

      const tables: Table[] = [];
      const storeId = `${svc.id}.pg`;
      // A chain of six, then singletons.
      for (let t = 0; t < 7; t += 1) {
        const id = `${storeId}.t${t}`;
        const columns: Column[] = [
          column("id", "uuid", { pk: true }),
          column("state", "text"),
        ];
        if (t > 0 && t < 6) {
          columns.push(
            column("parent_id", "uuid", {
              fk: {
                table: `${storeId}.t${t - 1}`,
                column: "id",
                onDelete: "cascade",
              },
            }),
          );
        }
        tables.push({
          id,
          name: `t${t}`,
          columns,
          ...(t === 0
            ? {
                role: "aggregate-root" as const,
                persists: { aggregate: `${svc.id}.root` },
              }
            : { role: "child" as const }),
        });
      }
      stores.push({
        id: storeId,
        slug: "pg",
        name: `${svc.id} database`,
        kind: "postgres",
        owner: svc.id,
        tables,
      });
    }
    contexts.push({
      id: contextId,
      slug: contextId,
      name: contextId,
      summary: "",
      services,
    });
  }

  return { ...EMPTY, contexts, stores };
}

/**
 * One service, three events, nobody listening.
 *
 * The shape a catalog has on its first day, and the one a graph renderer is
 * most likely to get wrong: there is no second layer to spread into, so a
 * layout that centres on its edges centres on nothing, and a fitView that
 * measures the bounding box of a single column zooms until one box fills the
 * screen. It is also the only shape where "no consumers indexed yet" is the
 * most useful thing the page can say.
 */
export function thinCatalog(): Catalog {
  const svc = service("solo", "core", ["thing"], (aggregateId) => [
    event(aggregateId, "ThingCreated"),
    event(aggregateId, "ThingRenamed"),
    event(aggregateId, "ThingArchived"),
  ]);
  return {
    ...EMPTY,
    contexts: [
      {
        id: "solo",
        slug: "solo",
        name: "solo",
        summary: "",
        services: [svc],
      },
    ],
    stores: [],
  };
}

/**
 * Every shape that breaks a naive renderer, in one store.
 *
 * - a table with 45 columns, which is past any sensible card height
 * - a self-referencing foreign key, which is a cycle of one
 * - a composite primary key, so "the pk column" is not a thing
 * - a two-table cycle A → B → A, which no layering can order
 */
export function pathologicalCatalog(): Catalog {
  const svc = service("edge", "core", ["thing"]);
  const storeId = "edge.core.pg";

  const wide: Table = {
    id: `${storeId}.wide`,
    name: "wide",
    doc: "45 columns. A card cannot show this; it has to say so.",
    role: "other",
    columns: [
      column("id", "uuid", { pk: true }),
      ...Array.from({ length: 44 }, (_, i) =>
        column(`c${i}`, i % 3 === 0 ? "text" : i % 3 === 1 ? "bigint" : "jsonb", {
          nullable: i % 2 === 0,
        }),
      ),
    ],
  };

  const tree: Table = {
    id: `${storeId}.tree`,
    name: "tree",
    doc: "Self-referencing: a row's parent is another row of this table.",
    role: "other",
    columns: [
      column("id", "uuid", { pk: true }),
      column("parent_id", "uuid", {
        nullable: true,
        fk: { table: `${storeId}.tree`, column: "id", onDelete: "set null" },
      }),
    ],
  };

  const composite: Table = {
    id: `${storeId}.composite`,
    name: "composite",
    doc: "Two columns are the key; neither is on its own.",
    role: "child",
    persists: { aggregate: "edge.core.thing" },
    columns: [
      column("tenant_id", "uuid", { pk: true }),
      column("thing_id", "uuid", { pk: true, maps: "thing.id" }),
      column("state", "text", { maps: "thing.state" }),
    ],
    indexes: [
      { name: "composite_pkey", columns: ["tenant_id", "thing_id"], unique: true },
    ],
  };

  // A → B → A. Both keys are real; the cycle is the point.
  const a: Table = {
    id: `${storeId}.a`,
    name: "a",
    role: "other",
    columns: [
      column("id", "uuid", { pk: true }),
      column("b_id", "uuid", {
        nullable: true,
        fk: { table: `${storeId}.b`, column: "id" },
      }),
    ],
  };
  const b: Table = {
    id: `${storeId}.b`,
    name: "b",
    role: "other",
    columns: [
      column("id", "uuid", { pk: true }),
      column("a_id", "uuid", {
        nullable: true,
        fk: { table: `${storeId}.a`, column: "id" },
      }),
    ],
  };

  const store: Store = {
    id: storeId,
    slug: "pg",
    name: "Edge cases",
    kind: "postgres",
    owner: svc.id,
    tables: [wide, tree, composite, a, b],
  };

  return {
    ...EMPTY,
    contexts: [
      {
        id: "edge",
        slug: "edge",
        name: "edge",
        summary: "",
        services: [svc],
      },
    ],
    stores: [store],
  };
}
