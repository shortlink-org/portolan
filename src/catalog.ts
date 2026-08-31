// The contract. Every fact rendered by portolan comes from a Catalog value,
// and every Catalog value is validated before the app is allowed to draw it.

export type Status = "verified" | "declared" | "unresolved";
export type Provenance = "authored" | "derived-from-test" | "derived-from-otel";

export interface Catalog {
  generatedAt: string; // ISO 8601
  commit: string; // short sha
  contexts: Context[];
  defs: Record<string, TypeDef>; // shared type definitions by id
  flows: Flow[];
  adrs: Adr[];
}
export interface Context {
  id: string;
  name: string;
  summary: string;
  services: Service[];
}
export interface Service {
  id: string; // "<context>.<slug>", e.g. "shop.oms"
  slug: string;
  name: string;
  repo: string;
  path: string;
  readme: string; // markdown
  provides: RpcService[];
  consumes: RpcCall[];
  aggregates: Aggregate[];
}
export interface RpcService {
  id: string;
  methods: string[];
  source: string;
  /**
   * Request and response shapes, when the generator could read them. Optional:
   * a service whose protos were not parsed still lists its methods.
   */
  messages?: RpcMessage[];
}
export interface RpcMessage {
  name: string; // "PlaceOrderRequest"
  fields: Field[];
}
export interface RpcCall {
  id: string; // "<proto.package.Service>/<Method>"
  peer: string; // service id if resolved, else raw name
  status: Status;
  source: string;
  note?: string;
}
export interface Aggregate {
  id: string;
  slug: string;
  name: string;
  readme: string;
  /** Name of the entity that is the aggregate root; must be one of `entities`. */
  root: string;
  entities: Entity[];
  valueObjects: ValueObject[];
  operations: Operation[];
  events: Event[];
}
export interface Operation {
  id: string;
  kind: "command" | "query";
  doc?: string;
}

/**
 * A DDD building block held inside an aggregate. Entities have identity and
 * value objects do not, but both are named shapes, so they share a structure
 * and are told apart by the list they sit in.
 *
 * The shape is either NAMED - `ref` points at a shared `catalog.defs` entry, and
 * every other block, event field or RPC message naming that same def is
 * knowably the same type - or INLINE, when the type is local to the aggregate.
 */
export interface Block {
  id: string; // "<aggregate id>.<slug>"
  slug: string;
  name: string;
  doc: string;
  ref?: string; // key into catalog.defs
  fields?: Field[]; // inline shape, used when there is no ref
}
export type ValueObject = Block;
export type Entity = Block;
export type BlockKind = "vo" | "entity";
export interface Event {
  id: string; // "<service id>.<aggregate>.<Name>"
  slug: string;
  name: string;
  versions: EventVersion[]; // >=1, oldest first
  consumers: { service: string; status: Status; note?: string }[];
}
export interface EventVersion {
  version: string;
  doc: string;
  source: string;
  fields: Field[];
}
export interface Field {
  name: string;
  type: string;
  doc: string;
  ref?: string;
} // ref -> defs key
export interface TypeDef {
  fields: Field[];
}

export interface Flow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  provenance: Provenance;
  source?: string; // test file for derived-from-test, doc file for authored
  verifiedAt?: string;
  participants: Participant[]; // order is significant - it is the lane order
  steps: FlowNode[];
}
export interface Participant {
  id: string;
  kind: "actor" | "service" | "broker" | "store" | "external" | "unknown";
  context: string | null; // null for actors and brokers
  label?: string;
}
export type FlowNode = Step | Parallel | Alt | Loop;
export interface Step {
  type: "step";
  id: string;
  from: string;
  to: string; // participant ids; from === to is a self-message
  kind: "rpc" | "event" | "call";
  ref?: string; // Event.id or RpcCall.id - resolvable, or status must be unresolved
  label?: string;
  status: Status;
  note?: string;
  line?: string;
}
export interface Parallel {
  type: "parallel";
  id: string;
  title?: string;
  branches: FlowNode[][];
}
export interface Alt {
  type: "alt";
  id: string;
  branches: { title: string; steps: FlowNode[] }[];
}
export interface Loop {
  type: "loop";
  id: string;
  title: string;
  steps: FlowNode[];
}

// ---------------------------------------------------------------------------
// Decision records. An ADR is frozen history: it says what was decided and
// when, not what the model looks like now. Nothing here is regenerated from
// the current catalog, and nothing on an ADR page redraws from it.
// ---------------------------------------------------------------------------

export type AdrStatus =
  "proposed" | "accepted" | "superseded" | "deprecated" | "rejected";

export type AdrScope =
  | { kind: "org" }
  | { kind: "context"; context: string }
  | { kind: "service"; service: string };

export interface Adr {
  id: string; // "shop.oms.0007" - scope prefix plus zero-padded number
  slug: string;
  number: number; // 7
  title: string;
  status: AdrStatus;
  date: string; // decision date, ISO
  scope: AdrScope;
  body: string; // markdown, MADR structure
  supersededBy?: string; // Adr.id
  supersedes?: string[];
  relates: { services?: string[]; events?: string[]; flows?: string[] };
  source: string; // path to the .md in its repo
}

// ---------------------------------------------------------------------------
// Traversal helpers. Coverage is DERIVED here, never stored in the JSON.
// ---------------------------------------------------------------------------

/** Depth-first walk over every Step in a node list, in numbering order. */
export function walkSteps(nodes: FlowNode[]): Step[] {
  const out: Step[] = [];
  const visit = (list: FlowNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case "step":
          out.push(node);
          break;
        case "parallel":
          for (const branch of node.branches) visit(branch);
          break;
        case "alt":
          for (const branch of node.branches) visit(branch.steps);
          break;
        case "loop":
          visit(node.steps);
          break;
      }
    }
  };
  visit(nodes);
  return out;
}

export interface Coverage {
  verified: number;
  declared: number;
  unresolved: number;
  total: number;
}

export function flowCoverage(flow: Flow): Coverage {
  const steps = walkSteps(flow.steps);
  const cov: Coverage = {
    verified: 0,
    declared: 0,
    unresolved: 0,
    total: steps.length,
  };
  for (const step of steps) cov[step.status] += 1;
  return cov;
}

/** Fraction of steps that are verified; 1 for an empty flow so sorting stays stable. */
export function coverageRatio(cov: Coverage): number {
  return cov.total === 0 ? 1 : cov.verified / cov.total;
}

export function allServices(catalog: Catalog): Service[] {
  return catalog.contexts.flatMap((c) => c.services);
}

export function allEvents(catalog: Catalog): Event[] {
  return allServices(catalog).flatMap((s) =>
    s.aggregates.flatMap((a) => a.events),
  );
}

export function allRpcCalls(catalog: Catalog): RpcCall[] {
  return allServices(catalog).flatMap((s) => s.consumes);
}

export function allAggregates(catalog: Catalog): Aggregate[] {
  return allServices(catalog).flatMap((s) => s.aggregates);
}

/**
 * The fields a block actually has: its own when written inline, otherwise the
 * shared def it names. An empty list means the catalog knows the block by name
 * only, which pages say out loud rather than drawing a blank table.
 */
export function blockFields(catalog: Catalog, block: Block): Field[] {
  if (block.fields) return block.fields;
  if (block.ref) return catalog.defs[block.ref]?.fields ?? [];
  return [];
}

/** Value objects and entities of one aggregate, tagged with which they are. */
export function aggregateBlocks(
  aggregate: Aggregate,
): { kind: BlockKind; block: Block }[] {
  return [
    ...aggregate.valueObjects.map((block) => ({ kind: "vo" as const, block })),
    ...aggregate.entities.map((block) => ({ kind: "entity" as const, block })),
  ];
}

/** The entity an aggregate names as its root, if the catalog lists it. */
export function rootEntity(aggregate: Aggregate): Entity | undefined {
  return aggregate.entities.find((e) => e.name === aggregate.root);
}

export interface BlockCounts {
  entities: number;
  valueObjects: number;
  events: number;
  commands: number;
  queries: number;
}

export function blockCounts(aggregate: Aggregate): BlockCounts {
  return {
    entities: aggregate.entities.length,
    valueObjects: aggregate.valueObjects.length,
    events: aggregate.events.length,
    commands: aggregate.operations.filter((o) => o.kind === "command").length,
    queries: aggregate.operations.filter((o) => o.kind === "query").length,
  };
}

/** Contexts touched by a flow, in participant order, ignoring null-context lanes. */
export function flowContexts(flow: Flow): string[] {
  const seen: string[] = [];
  for (const p of flow.participants) {
    if (p.context && !seen.includes(p.context)) seen.push(p.context);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** Everything needed to render or link a block without walking the tree again. */
export interface BlockOwner {
  block: Block;
  kind: BlockKind;
  aggregate: Aggregate;
  service: Service;
  context: Context;
}

export interface CatalogIndex {
  catalog: Catalog;
  serviceById: Map<string, Service>;
  serviceContext: Map<string, Context>;
  aggregateById: Map<string, Aggregate>;
  aggregateOwner: Map<string, Service>;
  eventById: Map<string, Event>;
  eventOwner: Map<string, { service: Service; aggregate: Aggregate }>;
  /** value object and entity id -> the block and everything that owns it */
  blockById: Map<string, BlockOwner>;
  /** defs key -> ids of the blocks that name it */
  blocksByDef: Map<string, string[]>;
  rpcById: Map<string, RpcCall>;
  rpcProviderByMethod: Map<string, Service>;
  flowBySlug: Map<string, Flow>;
  /** event id -> flow slugs that reference it in a step */
  flowsByEvent: Map<string, string[]>;
  adrById: Map<string, Adr>;
  adrBySlug: Map<string, Adr>;
  /** event id -> ADRs that name it in relates.events, newest first */
  adrsByEvent: Map<string, Adr[]>;
}

export function buildIndex(catalog: Catalog): CatalogIndex {
  const serviceById = new Map<string, Service>();
  const serviceContext = new Map<string, Context>();
  const aggregateById = new Map<string, Aggregate>();
  const aggregateOwner = new Map<string, Service>();
  const eventById = new Map<string, Event>();
  const eventOwner = new Map<
    string,
    { service: Service; aggregate: Aggregate }
  >();
  const blockById = new Map<string, BlockOwner>();
  const blocksByDef = new Map<string, string[]>();
  const rpcById = new Map<string, RpcCall>();
  const rpcProviderByMethod = new Map<string, Service>();
  const flowBySlug = new Map<string, Flow>();
  const flowsByEvent = new Map<string, string[]>();
  const adrById = new Map<string, Adr>();
  const adrBySlug = new Map<string, Adr>();
  const adrsByEvent = new Map<string, Adr[]>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceById.set(service.id, service);
      serviceContext.set(service.id, context);
      for (const call of service.consumes) rpcById.set(call.id, call);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          rpcProviderByMethod.set(`${provided.id}/${method}`, service);
        }
      }
      for (const aggregate of service.aggregates) {
        aggregateById.set(aggregate.id, aggregate);
        aggregateOwner.set(aggregate.id, service);
        for (const event of aggregate.events) {
          eventById.set(event.id, event);
          eventOwner.set(event.id, { service, aggregate });
        }
        for (const { kind, block } of aggregateBlocks(aggregate)) {
          blockById.set(block.id, { block, kind, aggregate, service, context });
          if (block.ref) {
            const list = blocksByDef.get(block.ref) ?? [];
            list.push(block.id);
            blocksByDef.set(block.ref, list);
          }
        }
      }
    }
  }

  for (const flow of catalog.flows) {
    flowBySlug.set(flow.slug, flow);
    for (const step of walkSteps(flow.steps)) {
      if (step.ref && eventById.has(step.ref)) {
        const list = flowsByEvent.get(step.ref) ?? [];
        if (!list.includes(flow.slug)) list.push(flow.slug);
        flowsByEvent.set(step.ref, list);
      }
    }
  }

  for (const adr of [...catalog.adrs].sort(byDateDesc)) {
    adrById.set(adr.id, adr);
    adrBySlug.set(adr.slug, adr);
    for (const eventId of adr.relates.events ?? []) {
      const list = adrsByEvent.get(eventId) ?? [];
      list.push(adr);
      adrsByEvent.set(eventId, list);
    }
  }

  return {
    catalog,
    serviceById,
    serviceContext,
    aggregateById,
    aggregateOwner,
    eventById,
    eventOwner,
    blockById,
    blocksByDef,
    rpcById,
    rpcProviderByMethod,
    flowBySlug,
    flowsByEvent,
    adrById,
    adrBySlug,
    adrsByEvent,
  };
}

/** Newest decision first; ties broken by number so the order is total. */
export function byDateDesc(a: Adr, b: Adr): number {
  return b.date.localeCompare(a.date) || b.number - a.number;
}

// ---------------------------------------------------------------------------
// Validation. Throws on the first violation with a message that names the
// offending flow / step / field, so a bad generator run fails loudly.
// ---------------------------------------------------------------------------

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

function fail(message: string): never {
  throw new CatalogError(message);
}

function assertUniqueSlugs(
  slugs: string[],
  parent: string,
  what: string,
): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug))
      fail(`${what} slug "${slug}" is not unique within ${parent}`);
    seen.add(slug);
  }
}

export function validateCatalog(catalog: Catalog): Catalog {
  if (!catalog.generatedAt) fail("catalog.generatedAt is missing");
  if (!catalog.commit) fail("catalog.commit is missing");

  const eventIds = new Set<string>();
  const rpcIds = new Set<string>();

  assertUniqueSlugs(
    catalog.contexts.map((c) => c.id),
    "catalog",
    "context",
  );

  for (const context of catalog.contexts) {
    assertUniqueSlugs(
      context.services.map((s) => s.slug),
      `context "${context.id}"`,
      "service",
    );
    for (const service of context.services) {
      if (service.id !== `${context.id}.${service.slug}`) {
        fail(
          `service "${service.id}" in context "${context.id}" must have id "${context.id}.${service.slug}"`,
        );
      }
      for (const call of service.consumes) rpcIds.add(call.id);
      for (const provided of service.provides) {
        for (const message of provided.messages ?? []) {
          for (const field of message.fields) {
            if (field.ref !== undefined && !(field.ref in catalog.defs)) {
              fail(
                `field "${field.name}" of rpc message "${provided.id}.${message.name}" references unknown def "${field.ref}"`,
              );
            }
          }
        }
      }

      assertUniqueSlugs(
        service.aggregates.map((a) => a.slug),
        `service "${service.id}"`,
        "aggregate",
      );
      for (const aggregate of service.aggregates) {
        validateBlocks(catalog, aggregate);
        assertUniqueSlugs(
          aggregate.events.map((e) => e.slug),
          `aggregate "${aggregate.id}"`,
          "event",
        );
        for (const event of aggregate.events) {
          if (event.versions.length === 0) {
            fail(
              `event "${event.id}" has no versions; at least one is required`,
            );
          }
          eventIds.add(event.id);
          for (const version of event.versions) {
            for (const field of version.fields) {
              if (field.ref !== undefined && !(field.ref in catalog.defs)) {
                fail(
                  `field "${field.name}" of ${event.id}@${version.version} references unknown def "${field.ref}"`,
                );
              }
            }
          }
        }
      }
    }
  }

  for (const [defId, def] of Object.entries(catalog.defs)) {
    for (const field of def.fields) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of def "${defId}" references unknown def "${field.ref}"`,
        );
      }
    }
  }

  assertUniqueSlugs(
    catalog.flows.map((f) => f.slug),
    "catalog",
    "flow",
  );

  for (const flow of catalog.flows) {
    const lanes = new Set(flow.participants.map((p) => p.id));
    if (lanes.size !== flow.participants.length) {
      fail(`flow "${flow.slug}" has duplicate participant ids`);
    }
    const steps = walkSteps(flow.steps);
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (stepIds.has(step.id)) {
        fail(`flow "${flow.slug}" has duplicate step id "${step.id}"`);
      }
      stepIds.add(step.id);

      if (!lanes.has(step.from)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": from "${step.from}" is not a declared participant`,
        );
      }
      if (!lanes.has(step.to)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": to "${step.to}" is not a declared participant`,
        );
      }
      if (step.ref !== undefined && step.status !== "unresolved") {
        const resolves = eventIds.has(step.ref) || rpcIds.has(step.ref);
        if (!resolves) {
          fail(
            `flow "${flow.slug}" step "${step.id}": ref "${step.ref}" resolves to neither an Event nor an RpcCall, and status is "${step.status}" rather than "unresolved"`,
          );
        }
      }
    }
  }

  validateAdrs(catalog, eventIds);

  return catalog;
}

/**
 * An aggregate is a root entity plus the entities and value objects it owns.
 * The root has to be one of those entities: an aggregate that names a root it
 * does not list is a modelling mistake, not a rendering one, and the tree would
 * quietly print a line pointing at nothing.
 */
function validateBlocks(catalog: Catalog, aggregate: Aggregate): void {
  for (const [what, list] of [
    ["entities", aggregate.entities],
    ["valueObjects", aggregate.valueObjects],
  ] as const) {
    if (!Array.isArray(list)) {
      fail(`aggregate "${aggregate.id}" is missing its ${what} list`);
    }
  }

  assertUniqueSlugs(
    aggregate.entities.map((e) => e.slug),
    `aggregate "${aggregate.id}"`,
    "entity",
  );
  assertUniqueSlugs(
    aggregate.valueObjects.map((v) => v.slug),
    `aggregate "${aggregate.id}"`,
    "value object",
  );

  for (const { kind, block } of aggregateBlocks(aggregate)) {
    const what = kind === "vo" ? "value object" : "entity";
    if (block.id !== `${aggregate.id}.${block.slug}`) {
      fail(
        `${what} "${block.id}" in aggregate "${aggregate.id}" must have id "${aggregate.id}.${block.slug}"`,
      );
    }
    if (block.ref !== undefined && !(block.ref in catalog.defs)) {
      fail(`${what} "${block.id}" references unknown def "${block.ref}"`);
    }
    if (block.ref === undefined && (block.fields ?? []).length === 0) {
      fail(
        `${what} "${block.id}" has neither a def ref nor any fields of its own`,
      );
    }
    for (const field of block.fields ?? []) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of ${what} "${block.id}" references unknown def "${field.ref}"`,
        );
      }
    }
  }

  if (!aggregate.root) fail(`aggregate "${aggregate.id}" names no root entity`);
  if (!rootEntity(aggregate)) {
    fail(
      `aggregate "${aggregate.id}" names root "${aggregate.root}", which is not one of its entities`,
    );
  }
}

/**
 * A decision record may only point at things that exist. A dangling relates
 * entry or a half-written supersession would let the UI draw a link to
 * nowhere, so both fail the build instead.
 */
function validateAdrs(catalog: Catalog, eventIds: Set<string>): void {
  if (!Array.isArray(catalog.adrs)) fail("catalog.adrs is missing");

  const serviceIds = new Set(allServices(catalog).map((s) => s.id));
  const contextIds = new Set(catalog.contexts.map((c) => c.id));
  const flowSlugs = new Set(catalog.flows.map((f) => f.slug));

  assertUniqueSlugs(
    catalog.adrs.map((a) => a.slug),
    "catalog",
    "adr",
  );

  const byId = new Map<string, Adr>();
  for (const adr of catalog.adrs) {
    if (byId.has(adr.id)) fail(`adr id "${adr.id}" is not unique`);
    byId.set(adr.id, adr);
  }

  for (const adr of catalog.adrs) {
    const padded = String(adr.number).padStart(4, "0");
    if (!adr.id.endsWith(`.${padded}`)) {
      fail(`adr "${adr.id}" must end with its number, "${padded}"`);
    }
    if (Number.isNaN(new Date(adr.date).getTime())) {
      fail(`adr "${adr.id}" has an unparseable date "${adr.date}"`);
    }

    switch (adr.scope.kind) {
      case "context":
        if (!contextIds.has(adr.scope.context)) {
          fail(
            `adr "${adr.id}" is scoped to unknown context "${adr.scope.context}"`,
          );
        }
        break;
      case "service":
        if (!serviceIds.has(adr.scope.service)) {
          fail(
            `adr "${adr.id}" is scoped to unknown service "${adr.scope.service}"`,
          );
        }
        break;
      case "org":
        break;
    }

    for (const serviceId of adr.relates.services ?? []) {
      if (!serviceIds.has(serviceId)) {
        fail(`adr "${adr.id}" relates to unknown service "${serviceId}"`);
      }
    }
    for (const eventId of adr.relates.events ?? []) {
      if (!eventIds.has(eventId)) {
        fail(`adr "${adr.id}" relates to unknown event "${eventId}"`);
      }
    }
    for (const flowSlug of adr.relates.flows ?? []) {
      if (!flowSlugs.has(flowSlug)) {
        fail(`adr "${adr.id}" relates to unknown flow "${flowSlug}"`);
      }
    }

    // Supersession is a two-way fact. Recording one half of it is a bug in
    // whatever wrote the catalog, not a display problem to paper over.
    if (adr.status === "superseded" && !adr.supersededBy) {
      fail(`adr "${adr.id}" is superseded but names no supersededBy`);
    }
    if (adr.supersededBy !== undefined) {
      if (adr.status !== "superseded") {
        fail(
          `adr "${adr.id}" names supersededBy "${adr.supersededBy}" but its status is "${adr.status}", not "superseded"`,
        );
      }
      const successor = byId.get(adr.supersededBy);
      if (!successor) {
        fail(
          `adr "${adr.id}" is superseded by unknown adr "${adr.supersededBy}"`,
        );
      } else if (!(successor.supersedes ?? []).includes(adr.id)) {
        fail(
          `adr "${adr.id}" is superseded by "${successor.id}", but "${successor.id}" does not list it in supersedes`,
        );
      }
    }
    for (const supersededId of adr.supersedes ?? []) {
      const predecessor = byId.get(supersededId);
      if (!predecessor) {
        fail(`adr "${adr.id}" supersedes unknown adr "${supersededId}"`);
      } else if (predecessor.supersededBy !== adr.id) {
        fail(
          `adr "${adr.id}" supersedes "${supersededId}", but "${supersededId}" is not marked superseded by it`,
        );
      }
    }
  }
}
