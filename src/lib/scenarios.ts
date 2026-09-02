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
  ProtoModule,
  RpcMethod,
  RpcService,
  Status,
  Streaming,
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

function column(
  name: string,
  type: string,
  extra: Partial<Column> = {},
): Column {
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
            ? [
                {
                  service: `legacy-${contextId}`,
                  status: "unresolved" as const,
                },
              ]
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
        column(
          `c${i}`,
          i % 3 === 0 ? "text" : i % 3 === 1 ? "bigint" : "jsonb",
          {
            nullable: i % 2 === 0,
          },
        ),
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
      {
        name: "composite_pkey",
        columns: ["tenant_id", "thing_id"],
        unique: true,
      },
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

// ---------------------------------------------------------------------------
// A registry. Schema modules, the interfaces declared in them, and the services
// that read what they never published.
//
// This exists because the registry UI shipped before any example estate carried
// a .proto, and a surface nobody can look at is a surface nobody can check.
// Everything the module page, the sidebar band and the detail rail read is here,
// including the shapes that are easy to get wrong: a dependency the catalog does
// not hold, a module nobody owns, and one module large enough to ask whether the
// page still reads at all.
// ---------------------------------------------------------------------------

/** The oversized module's size: enough packages and interfaces to hurt. */
const REGISTRY_PACKAGES = 12;
const REGISTRY_INTERFACES = 40;

function rpcMethod(name: string, at: number): RpcMethod {
  // A deterministic wheel through the four streaming shapes, so a page drawn
  // against this scenario has to handle all of them rather than the common one.
  const streaming: (Streaming | undefined)[] = [
    undefined,
    "server",
    "client",
    "bidi",
  ];

  return {
    name,
    doc: `What ${name} does, in one line.`,
    request: `${name}Request`,
    response: `${name}Response`,
    streaming: streaming[at % streaming.length],
    deprecated: at % 7 === 6,
  };
}

function rpcService(id: string, moduleId: string, methods: number): RpcService {
  return {
    id,
    module: moduleId,
    source: `proto/${id.split(".").join("/")}.proto:9`,
    methods: Array.from({ length: methods }, (_, i) =>
      rpcMethod(`Method${i + 1}`, i),
    ),
    messages: Array.from({ length: methods * 2 }, (_, i) => ({
      name: `Message${i + 1}`,
      fields: [
        { name: "id", type: "string", doc: "" },
        { name: "total", type: "Money", doc: "", ref: "Money" },
      ],
    })),
  };
}

/**
 * Two modules and one estate reading them.
 *
 * `acme/shop` is published by a service in the catalog and depends on one module
 * that is here and one that is not. `acme/huge` is published by nobody — the
 * ordinary case for a module owned by another team — and is deliberately too
 * big to eyeball.
 */
export function registryCatalog(): Catalog {
  const shopModule: ProtoModule = {
    id: "buf.build/acme/shop",
    slug: "acme-shop",
    name: "acme/shop",
    registry: "buf.build",
    owner: "shop.oms",
    commit: "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
    digest: "b5:5f0e0d0c0b0a09080706050403020100",
    packages: ["shop.v1", "shop.events.v1"],
    files: ["shop/events/v1/events.proto", "shop/v1/orders.proto"],
    // One resolves in this catalog and one does not. A module depending on
    // something the estate never vendored is normal, not broken.
    deps: ["buf.build/acme/huge", "buf.build/other/never-vendored"],
    source: "vendor/proto/acme/shop",
  };

  const hugeModule: ProtoModule = {
    id: "buf.build/acme/huge",
    slug: "acme-huge",
    name: "acme/huge",
    registry: "buf.build",
    // No owner: published by another team, which is the ordinary case and the
    // reason `owner` is optional at all.
    commit: "aaaabbbbccccddddeeeeffff00001111",
    packages: Array.from(
      { length: REGISTRY_PACKAGES },
      (_, i) => `huge.v${i + 1}`,
    ),
    files: Array.from(
      { length: REGISTRY_INTERFACES },
      (_, i) => `huge/v${(i % REGISTRY_PACKAGES) + 1}/svc${i + 1}.proto`,
    ),
    source: "vendor/proto/acme/huge",
  };

  const oms: Service = {
    id: "shop.oms",
    slug: "oms",
    name: "Order Management",
    repo: "git@example.com:shop/oms.git",
    path: "/shop/oms",
    readme: "",
    provides: [
      rpcService("shop.v1.Orders", shopModule.id, 6),
      rpcService("shop.events.v1.Feed", shopModule.id, 2),
    ],
    consumes: [
      {
        id: "huge.v1.Svc1/Method1",
        peer: "shop.pricing",
        status: "declared",
        source: "internal/infrastructure/huge/huge.proto:11",
        module: hugeModule.id,
      },
    ],
    aggregates: [],
    modules: [shopModule.id, hugeModule.id],
  };

  // Publishes the oversized module's interfaces, so the page that draws them
  // has to cope with forty of them across twelve packages.
  const pricing: Service = {
    id: "shop.pricing",
    slug: "pricing",
    name: "Pricing",
    repo: "git@example.com:shop/pricing.git",
    path: "/shop/pricing",
    readme: "",
    provides: Array.from({ length: REGISTRY_INTERFACES }, (_, i) =>
      rpcService(
        `huge.v${(i % REGISTRY_PACKAGES) + 1}.Svc${i + 1}`,
        hugeModule.id,
        3,
      ),
    ),
    consumes: [],
    aggregates: [],
    modules: [hugeModule.id],
  };

  return {
    ...EMPTY,
    contexts: [
      {
        id: "shop",
        slug: "shop",
        name: "Shop",
        summary: "",
        services: [oms, pricing],
      },
    ],
    defs: {
      Money: { fields: [{ name: "currency", type: "string", doc: "" }] },
    },
    modules: [shopModule, hugeModule],
  };
}
