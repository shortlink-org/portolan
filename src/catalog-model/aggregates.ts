// The domain model inside a service: aggregates with their lifecycle,
// operations, entities, value objects and enums, and the helpers that read a
// block's fields and count what an aggregate holds.

import type { Catalog } from "./catalog.ts";
import type { Field } from "./shared.ts";
import type { Event } from "./events.ts";
import { allServices } from "./contexts.ts";

export interface Aggregate {
  id: string;
  slug: string;
  name: string;
  readme: string;
  /** A source grouping has no confirmed aggregate boundary. Omitted for aggregates. */
  kind?: "model-group";
  /** Name of the root entity; empty only for a model-group. */
  root: string;
  entities: Entity[];
  valueObjects: ValueObject[];
  operations: Operation[];
  events: Event[];
  /**
   * The closed sets the aggregate's fields take values from: a reason, a
   * status, a code. Read through `enumsOf`, which answers [] for a source
   * that declared none - the same shape every other optional list here has.
   */
  enums?: Enum[];
  /**
   * Where the root can go from where it is, when the aggregate has a status
   * and the code writes its transitions down as one table. Absent means the
   * aggregate has no lifecycle worth the name, or the extractor found none.
   */
  lifecycle?: Lifecycle;
}
/**
 * A state machine read off the aggregate: the states in the order the code
 * lists them, the first being the one a new root starts in, and every move
 * between them. A state nothing leads out of is terminal; that is derived,
 * never declared.
 */
export interface Lifecycle {
  states: string[];
  transitions: Transition[];
}
export interface Transition {
  from: string;
  to: string;
  /** The method on the root that makes the move, as written: `checkout`. */
  on: string;
  /** The event the method hands back for it, by id, when it hands one back. */
  emits?: string;
  /** Where the move is made, `file:line`. */
  source?: string;
}
export interface Operation {
  id: string;
  kind: "command" | "query";
  doc?: string;
  /** Still callable, but the source says not to: a JSDoc `@deprecated`. */
  deprecated?: boolean;
  /**
   * The interface methods that expose this operation, by the name they carry
   * in `RpcService.methods` - an OpenAPI `operationId`, a proto method.
   *
   * A method rather than a full `<service>/<method>` id, because the two ends
   * are read by different generators out of different files: one reads the
   * handlers and knows which use case an endpoint runs, the other reads the
   * document and knows what the interface is called. Neither can state the
   * other's half, and the pairing resolves once they are merged.
   *
   * Empty is a fact, not an omission: an operation nothing exposes is one the
   * estate can only reach from inside, which is sometimes exactly the point.
   */
  exposedBy?: string[];
  /**
   * What the caller hands in: the command's or query's own shape, as the
   * message class declares it - the fields of `CreateCourseCommand`. Absent
   * when the extractor does not read messages; empty is a message that
   * carries nothing, `FindCoursesCounterQuery`.
   */
  fields?: Field[];
  /**
   * The events running the operation can publish, by `Event.id`, in the
   * aggregate's event order: what the domain calls it makes hand back or
   * record, read from the handler's code. A command that fails its guards
   * publishes nothing, and one that takes several branches publishes one of
   * these rather than all of them - the list is what can come out, not what
   * always does.
   *
   * Only the service's own events: an operation changes its own aggregates,
   * and a fact another service publishes is that service's to say. Absent
   * when the extractor found none or does not read it: silence here is not a
   * claim that the operation publishes nothing.
   */
  emits?: string[];
  /** Where the handler is, `path:line`, for the reader who wants the code. */
  source?: string;
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
  /** The shape is on its way out, per a `@deprecated` on its class. */
  deprecated?: boolean;
  ref?: string; // key into catalog.defs
  fields?: Field[]; // inline shape, used when there is no ref
}
export type ValueObject = Block;
export type Entity = Block;
export type BlockKind = "vo" | "entity";

/**
 * A closed set of values a field can hold. What a consumer switches on: an
 * order hearing `PaymentDeclined` reads `reason` and does one thing for
 * CARD_REFUSED and another for ORDER_CANCELLED, and this is the list it has
 * to handle. Not a Block - it has no fields - and told apart from a status
 * the lifecycle already knows by nothing: the lifecycle keeps the moves, the
 * enum keeps the doc on each value, and a page may draw both.
 */
export interface Enum {
  id: string; // "<aggregate id>.<slug>"
  slug: string;
  name: string;
  doc: string;
  /** The whole set is on its way out. */
  deprecated?: boolean;
  values: EnumValue[];
}
export interface EnumValue {
  /**
   * What a consumer sees on the wire when the source says so - a Go
   * constant's literal, a Rust `as_str` arm - and the variant's own name
   * otherwise.
   */
  name: string;
  doc: string;
  deprecated?: boolean;
}

export function allAggregates(catalog: Catalog): Aggregate[] {
  return allServices(catalog).flatMap((s) => s.aggregates);
}

/**
 * The fields a block actually has: its own when written inline, otherwise the
 * shared def it names. An empty list means the catalog knows the block by name
 * only, which pages say out loud rather than drawing a blank table.
 */
/** The enums an aggregate declares; [] for a source that wrote none. */
export function enumsOf(aggregate: Aggregate): Enum[] {
  return aggregate.enums ?? [];
}

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
  enums: number;
  events: number;
  commands: number;
  queries: number;
}

export function blockCounts(aggregate: Aggregate): BlockCounts {
  return {
    entities: aggregate.entities.length,
    valueObjects: aggregate.valueObjects.length,
    enums: enumsOf(aggregate).length,
    events: aggregate.events.length,
    commands: aggregate.operations.filter((o) => o.kind === "command").length,
    queries: aggregate.operations.filter((o) => o.kind === "query").length,
  };
}
