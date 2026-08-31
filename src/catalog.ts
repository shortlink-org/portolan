// The contract. Every fact rendered by portolan comes from a Catalog value,
// and every Catalog value is validated before the app is allowed to draw it.

export type Status = "verified" | "declared" | "unresolved";
export type Provenance = "authored" | "derived-from-test" | "derived-from-otel";

export interface Catalog {
  generatedAt: string; // ISO 8601
  commit: string; // short sha
  contexts: BoundedContext[];
  defs: Record<string, TypeDef>; // shared type definitions by id
  flows: Flow[];
  adrs: Adr[];
}
/**
 * A bounded context: the estate's top grouping level, and nothing more. It owns
 * services; it states no relationships to its neighbours. The map of who talks
 * to whom is already drawn from the calls and events themselves.
 */
export interface BoundedContext {
  /** A context sits at the root, so its id is its slug. The validator holds them equal. */
  id: string;
  slug: string;
  name: string;
  summary: string;
  /**
   * How strategically the domain is rated. A badge, and only a badge: it never
   * orders, groups or filters anything. Absent means the estate has not made
   * the call, which renders as nothing at all rather than a default.
   */
  classification?: Classification;
  /** LikeC4 view to embed on the context page, when the derived `ctx_<id>` is not the one wanted. */
  viewId?: string;
  services: Service[];
}

export type Classification = "core" | "supporting" | "generic";

export const CLASSIFICATIONS: readonly Classification[] = [
  "core",
  "supporting",
  "generic",
] as const;
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
/**
 * A choice. Exactly one branch runs, so the branches are not a sequence and
 * nothing that reads a flow may treat them as one.
 *
 * `terminal` marks a branch that ENDS the flow rather than rejoining it — the
 * cancel arm of a risk check, say. Without it a reader has no way to tell that
 * the steps drawn after the alt do not follow that branch, and the sequence
 * reads as "the order was cancelled and then charged".
 */
export interface Alt {
  type: "alt";
  id: string;
  branches: AltBranch[];
}
export interface AltBranch {
  /** The condition under which this branch runs, in words. */
  title: string;
  steps: FlowNode[];
  /** True when the flow stops here instead of continuing past the alt. */
  terminal?: boolean;
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
// Traversal helpers. Everything here is DERIVED from the steps, never stored in
// the JSON.
//
// There is deliberately no flow-level score. How far a flow can be trusted is
// said by its `provenance` and, step by step, by each `Step.status`; a ratio
// over those averaged claims that are not comparable, hid the only actionable
// one (`unresolved`), and — once alt branches are counted — divided by a number
// no single execution ever reaches.
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

/**
 * One frame enclosing a step: the alt, parallel or loop it sits inside.
 *
 * This is what the rail and the detail panel need in order to say *under what
 * condition* a step runs. Without it a step is just a line in a sequence, and
 * a reader cannot tell an alternative apart from a consequence.
 */
export interface StepFrame {
  kind: "parallel" | "alt" | "loop";
  /** Id of the Parallel / Alt / Loop node. */
  id: string;
  /** Loop or parallel title. An alt carries its condition on the branch. */
  title?: string;
  /** Alt: the branch condition. Parallel: the 1-based branch number. */
  branch?: string;
  /** Alt only: this branch ends the flow rather than rejoining it. */
  terminal?: boolean;
}

/**
 * The frames around every step, outermost first. Steps not inside any frame
 * map to an empty list, so callers never have to special-case the flat case.
 */
export function stepFrames(nodes: FlowNode[]): Map<string, StepFrame[]> {
  const out = new Map<string, StepFrame[]>();
  const visit = (list: FlowNode[], stack: StepFrame[]): void => {
    for (const node of list) {
      switch (node.type) {
        case "step":
          out.set(node.id, stack);
          break;
        case "parallel":
          node.branches.forEach((branch, i) =>
            visit(branch, [
              ...stack,
              {
                kind: "parallel",
                id: node.id,
                title: node.title,
                branch: String(i + 1),
              },
            ]),
          );
          break;
        case "alt":
          for (const branch of node.branches) {
            visit(branch.steps, [
              ...stack,
              {
                kind: "alt",
                id: node.id,
                branch: branch.title,
                terminal: branch.terminal,
              },
            ]);
          }
          break;
        case "loop":
          visit(node.steps, [
            ...stack,
            { kind: "loop", id: node.id, title: node.title },
          ]);
          break;
      }
    }
  };
  visit(nodes, []);
  return out;
}

/**
 * The conditions a step runs under, outermost first — the alt branches around
 * it and nothing else. A step with none of these runs on every path.
 */
export function stepConditions(frames: readonly StepFrame[]): StepFrame[] {
  return frames.filter((f) => f.kind === "alt");
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
  context: BoundedContext;
}

export interface CatalogIndex {
  catalog: Catalog;
  serviceById: Map<string, Service>;
  serviceContext: Map<string, BoundedContext>;
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
  const serviceContext = new Map<string, BoundedContext>();
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
  /**
   * Where the violation is, as a reader would name it: "flow checkout-happy /
   * step s4", "aggregate shop.oms.order". The message already says what is
   * wrong; this says which line of the generator run to go and look at, and it
   * is what the error page prints under the message.
   */
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "CatalogError";
    this.path = path;
  }
}

function fail(message: string, path?: string): never {
  throw new CatalogError(message, path);
}

function assertUniqueSlugs(
  slugs: string[],
  parent: string,
  what: string,
): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug))
      fail(`${what} slug "${slug}" is not unique within ${parent}`, parent);
    seen.add(slug);
  }
}

export function validateCatalog(catalog: Catalog): Catalog {
  if (!catalog.generatedAt) fail("catalog.generatedAt is missing", "catalog");
  if (!catalog.commit) fail("catalog.commit is missing", "catalog");

  const eventIds = new Set<string>();
  const rpcIds = new Set<string>();

  assertUniqueSlugs(
    catalog.contexts.map((c) => c.id),
    "catalog",
    "context",
  );

  for (const context of catalog.contexts) {
    // A context is a root, so it has nothing to be a slug relative to: id and
    // slug are the same string, and holding them equal here keeps every route
    // built from `context.id` addressing the same thing the slug names.
    if (context.slug !== context.id) {
      fail(
        `context "${context.id}" has slug "${context.slug}"; a context sits at the root, so its slug must equal its id`,
        `context ${context.id}`,
      );
    }
    if (
      context.classification !== undefined &&
      !CLASSIFICATIONS.includes(context.classification)
    ) {
      fail(
        `context "${context.id}" has classification "${context.classification}"; expected one of ${CLASSIFICATIONS.join(", ")}`,
        `context ${context.id}`,
      );
    }
    assertUniqueSlugs(
      context.services.map((s) => s.slug),
      `context "${context.id}"`,
      "service",
    );
    for (const service of context.services) {
      if (service.id !== `${context.id}.${service.slug}`) {
        fail(
          `service "${service.id}" in context "${context.id}" must have id "${context.id}.${service.slug}"`,
          `service ${service.id}`,
        );
      }
      for (const call of service.consumes) rpcIds.add(call.id);
      for (const provided of service.provides) {
        for (const message of provided.messages ?? []) {
          for (const field of message.fields) {
            if (field.ref !== undefined && !(field.ref in catalog.defs)) {
              fail(
                `field "${field.name}" of rpc message "${provided.id}.${message.name}" references unknown def "${field.ref}"`,
                `service ${service.id} / rpc ${provided.id}.${message.name} / field ${field.name}`,
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
              `event ${event.id}`,
            );
          }
          eventIds.add(event.id);
          for (const version of event.versions) {
            for (const field of version.fields) {
              if (field.ref !== undefined && !(field.ref in catalog.defs)) {
                fail(
                  `field "${field.name}" of ${event.id}@${version.version} references unknown def "${field.ref}"`,
                  `event ${event.id}@${version.version} / field ${field.name}`,
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
          `def ${defId} / field ${field.name}`,
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
      fail(
        `flow "${flow.slug}" has duplicate participant ids`,
        `flow ${flow.id}`,
      );
    }
    validateFlowFrames(flow, flow.steps);

    const steps = walkSteps(flow.steps);
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (stepIds.has(step.id)) {
        fail(
          `flow "${flow.slug}" has duplicate step id "${step.id}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      stepIds.add(step.id);

      if (!lanes.has(step.from)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": from "${step.from}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (!lanes.has(step.to)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": to "${step.to}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.ref !== undefined && step.status !== "unresolved") {
        const resolves = eventIds.has(step.ref) || rpcIds.has(step.ref);
        if (!resolves) {
          fail(
            `flow "${flow.slug}" step "${step.id}": ref "${step.ref}" resolves to neither an Event nor an RpcCall, and status is "${step.status}" rather than "unresolved"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
    }
  }

  validateAdrs(catalog, eventIds);

  return catalog;
}

/**
 * Frames have to mean what they say. An alt with one branch is not a choice, an
 * untitled branch states no condition, and steps written after an alt whose
 * every branch is terminal can never run — each of those would be drawn as a
 * perfectly ordinary sequence, which is exactly the reading we are trying to
 * stop, so they fail the build instead.
 */
function validateFlowFrames(flow: Flow, nodes: FlowNode[]): void {
  nodes.forEach((node, i) => {
    switch (node.type) {
      case "step":
        break;
      case "parallel":
        for (const branch of node.branches) validateFlowFrames(flow, branch);
        break;
      case "loop":
        if (!node.title) {
          fail(
            `flow "${flow.slug}" loop "${node.id}" has no title, so the diagram cannot say what it repeats until`,
            `flow ${flow.id} / loop ${node.id}`,
          );
        }
        validateFlowFrames(flow, node.steps);
        break;
      case "alt": {
        if (node.branches.length < 2) {
          fail(
            `flow "${flow.slug}" alt "${node.id}" has ${node.branches.length} branch(es); an alt states a choice and needs at least two`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        const titles = new Set<string>();
        for (const branch of node.branches) {
          if (!branch.title) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has a branch with no title, so nothing says when it runs`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          if (titles.has(branch.title)) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has two branches titled "${branch.title}"`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          titles.add(branch.title);
          validateFlowFrames(flow, branch.steps);
        }
        if (node.branches.every((b) => b.terminal) && i < nodes.length - 1) {
          fail(
            `flow "${flow.slug}" alt "${node.id}": every branch is terminal, so the ${nodes.length - 1 - i} node(s) after it can never run`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        break;
      }
    }
  });
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
      fail(
        `aggregate "${aggregate.id}" is missing its ${what} list`,
        `aggregate ${aggregate.id}`,
      );
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
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    if (block.ref !== undefined && !(block.ref in catalog.defs)) {
      fail(
        `${what} "${block.id}" references unknown def "${block.ref}"`,
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    if (block.ref === undefined && (block.fields ?? []).length === 0) {
      fail(
        `${what} "${block.id}" has neither a def ref nor any fields of its own`,
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    for (const field of block.fields ?? []) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of ${what} "${block.id}" references unknown def "${field.ref}"`,
          `aggregate ${aggregate.id} / ${what} ${block.slug} / field ${field.name}`,
        );
      }
    }
  }

  if (!aggregate.root) {
    fail(
      `aggregate "${aggregate.id}" names no root entity`,
      `aggregate ${aggregate.id}`,
    );
  }
  if (!rootEntity(aggregate)) {
    fail(
      `aggregate "${aggregate.id}" names root "${aggregate.root}", which is not one of its entities`,
      `aggregate ${aggregate.id}`,
    );
  }
}

/**
 * A decision record may only point at things that exist. A dangling relates
 * entry or a half-written supersession would let the UI draw a link to
 * nowhere, so both fail the build instead.
 */
function validateAdrs(catalog: Catalog, eventIds: Set<string>): void {
  if (!Array.isArray(catalog.adrs)) fail("catalog.adrs is missing", "catalog");

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
    if (byId.has(adr.id))
      fail(`adr id "${adr.id}" is not unique`, `decision ${adr.id}`);
    byId.set(adr.id, adr);
  }

  for (const adr of catalog.adrs) {
    const padded = String(adr.number).padStart(4, "0");
    if (!adr.id.endsWith(`.${padded}`)) {
      fail(
        `adr "${adr.id}" must end with its number, "${padded}"`,
        `decision ${adr.id}`,
      );
    }
    if (Number.isNaN(new Date(adr.date).getTime())) {
      fail(
        `adr "${adr.id}" has an unparseable date "${adr.date}"`,
        `decision ${adr.id}`,
      );
    }

    switch (adr.scope.kind) {
      case "context":
        if (!contextIds.has(adr.scope.context)) {
          fail(
            `adr "${adr.id}" is scoped to unknown context "${adr.scope.context}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "service":
        if (!serviceIds.has(adr.scope.service)) {
          fail(
            `adr "${adr.id}" is scoped to unknown service "${adr.scope.service}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "org":
        break;
    }

    for (const serviceId of adr.relates.services ?? []) {
      if (!serviceIds.has(serviceId)) {
        fail(
          `adr "${adr.id}" relates to unknown service "${serviceId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const eventId of adr.relates.events ?? []) {
      if (!eventIds.has(eventId)) {
        fail(
          `adr "${adr.id}" relates to unknown event "${eventId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const flowSlug of adr.relates.flows ?? []) {
      if (!flowSlugs.has(flowSlug)) {
        fail(
          `adr "${adr.id}" relates to unknown flow "${flowSlug}"`,
          `decision ${adr.id}`,
        );
      }
    }

    // Supersession is a two-way fact. Recording one half of it is a bug in
    // whatever wrote the catalog, not a display problem to paper over.
    if (adr.status === "superseded" && !adr.supersededBy) {
      fail(
        `adr "${adr.id}" is superseded but names no supersededBy`,
        `decision ${adr.id}`,
      );
    }
    if (adr.supersededBy !== undefined) {
      if (adr.status !== "superseded") {
        fail(
          `adr "${adr.id}" names supersededBy "${adr.supersededBy}" but its status is "${adr.status}", not "superseded"`,
          `decision ${adr.id}`,
        );
      }
      const successor = byId.get(adr.supersededBy);
      if (!successor) {
        fail(
          `adr "${adr.id}" is superseded by unknown adr "${adr.supersededBy}"`,
          `decision ${adr.id}`,
        );
      } else if (!(successor.supersedes ?? []).includes(adr.id)) {
        fail(
          `adr "${adr.id}" is superseded by "${successor.id}", but "${successor.id}" does not list it in supersedes`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const supersededId of adr.supersedes ?? []) {
      const predecessor = byId.get(supersededId);
      if (!predecessor) {
        fail(
          `adr "${adr.id}" supersedes unknown adr "${supersededId}"`,
          `decision ${adr.id}`,
        );
      } else if (predecessor.supersededBy !== adr.id) {
        fail(
          `adr "${adr.id}" supersedes "${supersededId}", but "${supersededId}" is not marked superseded by it`,
          `decision ${adr.id}`,
        );
      }
    }
  }
}
