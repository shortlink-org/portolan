// The contract. Every fact rendered by portolan comes from a Catalog value,
// and every Catalog value is validated before the app is allowed to draw it.

export type Status = "verified" | "declared" | "unresolved";

export interface Catalog {
  generatedAt: string; // ISO 8601
  commit: string; // short sha
  contexts: BoundedContext[];
  defs: Record<string, TypeDef>; // shared type definitions by id
  flows: Flow[];
  adrs: Adr[];
  /**
   * Where the estate keeps its state. Optional in the file and never optional
   * downstream: a catalog written before the extractor learned to read
   * migrations still loads, and every reader sees an empty list rather than an
   * undefined one.
   */
  stores?: Store[];
  /**
   * The schema modules the estate publishes and vendors. Optional in the file
   * and never optional downstream, exactly like `stores`: a catalog written
   * before anything read a proto still loads.
   */
  modules?: ProtoModule[];
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
  /**
   * Stores this service touches, by id — the ones it owns and the ones it only
   * reads. Ownership is not stated here: a store names its own owner, so a
   * service listing a store it does not own is reading it, and the pages say
   * so rather than guessing.
   */
  stores?: string[];
  /**
   * Schema modules this service publishes or vendors, by id. Which of the two
   * is not stated here: a module names its own owner, so a module in this list
   * that does not call this service its owner is one the service reads.
   */
  modules?: string[];
}
export interface RpcService {
  id: string;
  methods: RpcMethod[];
  source: string;
  /**
   * Request and response shapes, when the generator could read them. Optional:
   * a service whose protos were not parsed still lists its methods.
   */
  messages?: RpcMessage[];
  /** The schema module declaring this interface, by `ProtoModule.id`. */
  module?: string;
}

/**
 * One method of one interface.
 *
 * A string would have done for the name, and did until protos were read. What
 * a string could not carry is the shapes on either side: an endpoint whose
 * request and response are named is one a reader can follow without opening
 * the source, and a streaming method drawn as a unary call is a lie about how
 * the two ends are coupled.
 *
 * Only `name` is required. An interface read from an OpenAPI document supplies
 * nothing else, and must keep reading the way it always did.
 *
 * There is no id here. `<rpcServiceId>/<name>` is already how the app spells
 * one, everywhere it needs one, and a stored copy would be a second place for
 * it to be wrong.
 */
export interface RpcMethod {
  /**
   * The name as the interface declares it - a proto method, an OpenAPI
   * `operationId`. This is what `Operation.exposedBy` names.
   */
  name: string;
  doc?: string;
  /**
   * The request and response messages, by the name they carry in
   * `RpcService.messages`. `ref` keys `catalog.defs` when the shape is shared -
   * the same pairing, for the same reason, as `Field.type` and `Field.ref`.
   */
  request?: string;
  requestRef?: string;
  response?: string;
  responseRef?: string;
  /** How the method streams. Absent is unary, which is most of them. */
  streaming?: Streaming;
  deprecated?: boolean;
}

export type Streaming = "client" | "server" | "bidi";

export const STREAMING: readonly Streaming[] = [
  "client",
  "server",
  "bidi",
] as const;
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
  /** The module the vendored copy this call was read from belongs to. */
  module?: string;
}

/**
 * A schema module: a set of .proto files with a name, a version and a
 * publisher - `buf.build/acme/shop`.
 *
 * It sits at the top level rather than inside the service that publishes it,
 * because the interesting fact about a module is usually who ELSE reads it.
 *
 * Its id is the module's own registry-global name and NOT `<owner>.<slug>` the
 * way a store's is. A store is declared by exactly one source - the service
 * that owns it - so deriving its id from its owner is safe. A module is
 * declared by several sources that do not know each other: the producer's
 * extractor knows which service publishes it, and the consumer's extractor,
 * reading a vendored copy in another repository, knows only the module name.
 * Since the merge unions top-level entities BY ID, an owner-derived id would
 * grow one module per consumer.
 *
 * What it carries is identity and inventory, not schema. The interfaces are
 * found through `RpcService.module` and the shapes live in `RpcService.messages`
 * and `catalog.defs`, in one place rather than two that can disagree.
 */
export interface ProtoModule {
  /** "buf.build/acme/shop", or "local:proto/shop" for a set never published. */
  id: string;
  /** Unique across the catalog, and what the URL uses: "acme-shop". */
  slug: string;
  name: string; // "acme/shop"
  /** "buf.build". Absent when the module was never published to one. */
  registry?: string;
  /**
   * The service that publishes it, by id, when the estate knows.
   *
   * Optional on purpose, and the first entity where "nobody here owns this" is
   * an honest answer rather than a defect: a module published by a team, or by
   * a repository outside the estate, is the ordinary case.
   */
  owner?: string;
  /** The commit this catalog was built from. */
  commit?: string;
  /** The registry's content digest of that commit - what makes a copy checkable. */
  digest?: string;
  /** Proto packages declared inside it, sorted. */
  packages: string[];
  /** Files, module-relative and sorted. */
  files: string[];
  /** Modules it depends on, by id. */
  deps?: string[];
  /** Where the copy in this repository lives, as a reader would type it. */
  source: string;
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

// ---------------------------------------------------------------------------
// Persistence. Where an aggregate actually lives when nothing is running.
//
// This axis is deliberately shallow: a store, its tables, their columns, and
// the foreign keys between them. It says nothing about how the rows got there.
// What it does say — through `persists` and `maps` — is which domain object a
// table holds and which domain field a column carries, which is the only
// question that makes a schema readable next to a model rather than beside it.
// ---------------------------------------------------------------------------

export type StoreKind =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "redis"
  | "mongodb"
  | "clickhouse"
  | "s3"
  | "kafka-topic"
  | "other";

export const STORE_KINDS: readonly StoreKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "mongodb",
  "clickhouse",
  "s3",
  "kafka-topic",
  "other",
] as const;

export interface Store {
  id: string; // "shop.oms.pg"
  slug: string;
  name: string;
  kind: StoreKind;
  /** Service id. Exactly one service owns a store; everyone else reads it. */
  owner: string;
  tables: Table[];
  /**
   * Views declared over those tables. Optional in the file for the same reason
   * `stores` is: a catalog written before the extractor learned to read
   * `CREATE VIEW` still loads, and every reader sees an empty list.
   */
  views?: View[];
  /** Migrations directory or config path, as a reader would open it. */
  source?: string;
}

/**
 * What a table is FOR. The role is not decoration: an outbox and a projection
 * are read completely differently from the table that holds the aggregate, and
 * a canvas that draws all three the same way hides the only structural fact a
 * reader came for.
 */
export type TableRole =
  "aggregate-root" | "child" | "outbox" | "projection" | "lookup" | "other";

export const TABLE_ROLES: readonly TableRole[] = [
  "aggregate-root",
  "child",
  "outbox",
  "projection",
  "lookup",
  "other",
] as const;

export interface Table {
  id: string; // "<store id>.<table>"
  name: string;
  doc?: string;
  columns: Column[];
  indexes?: TableIndex[];
  /** The domain object this table holds: an aggregate id, and optionally a block id. */
  persists?: { aggregate?: string; block?: string };
  role?: TableRole;
}

export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Column {
  name: string;
  /** The db type as declared — uuid, timestamptz, jsonb — not a normalised one. */
  type: string;
  nullable: boolean;
  pk?: boolean;
  /** `table` is a Table.id, so a foreign key names its target unambiguously. */
  fk?: { table: string; column: string; onDelete?: string };
  /**
   * The columns this one is computed from, as "<table or view id>.<column>".
   *
   * A foreign key says which row this value points AT; lineage says where the
   * value CAME FROM, which is a different question and the only one that can
   * be asked of a view column or of a projection rebuilt from an event. It is
   * declared on the derived end because that is the end that knows: a source
   * table has no idea who reads it.
   */
  from?: string[];
  /** Domain field path, e.g. "Order.CustomerID". */
  maps?: string;
  doc?: string;
}

/**
 * A view: a query the database has a name for.
 *
 * It is kept apart from Table rather than folded in behind a flag because the
 * two answer different questions. A table is where rows live; a view is a
 * reading of rows that live somewhere else, so it has no primary key, no
 * foreign keys, and no migrations of its own — what it has instead is the list
 * of things it reads, which is the only reason it is on the canvas at all.
 */
export interface View {
  id: string; // "<store id>.<view name>"
  name: string;
  doc?: string;
  /**
   * True when the database keeps the rows rather than recomputing them. A
   * matview can be stale, which is the one fact a reader has to have before
   * believing a row, so it is drawn differently rather than noted in prose.
   */
  materialized?: boolean;
  columns: Column[];
  /**
   * Tables and views this one is defined over, by id. Column lineage already
   * implies most of them; this is what a view whose columns nobody has mapped
   * still says out loud, and it is what the canvas draws when a column-level
   * edge would be a guess.
   */
  reads?: string[];
  /** The SELECT, as the migration declares it. Shown, never parsed. */
  definition?: string;
  /** The domain object this view presents, when it presents exactly one. */
  persists?: { aggregate?: string; block?: string };
  /** Migration or model file, as a reader would open it. */
  source?: string;
}

/**
 * A sequence read out of source.
 *
 * Every flow in the catalog is derived the same way, so none of them carries a
 * note about where it came from: a field with one possible value tells a reader
 * nothing they did not already know.
 */
export interface Flow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  source?: string; // the file the flow was read out of
  /**
   * The bounded context this flow belongs to. Whatever derived the flow read
   * one service's tree to find it and therefore knows the answer, so the flow
   * states it instead of leaving a reader to recover it from `source` - and the
   * validator holds every flow to it, because a flow with no owner has nowhere
   * to sit in the tree.
   */
  owner: string;
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
// said step by step, by each `Step.status`; a ratio over those averaged claims
// that are not comparable, hid the only actionable one (`unresolved`), and —
// once alt branches are counted — divided by a number no single execution ever
// reaches.
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

/** Every store, whether or not any service lists it. Absent means none. */
export function allStores(catalog: Catalog): Store[] {
  return catalog.stores ?? [];
}

export function allModules(catalog: Catalog): ProtoModule[] {
  return catalog.modules ?? [];
}

export function allTables(catalog: Catalog): Table[] {
  return allStores(catalog).flatMap((s) => s.tables);
}

/** Every view in every store. Absent means none, exactly as with tables. */
export function allViews(catalog: Catalog): View[] {
  return allStores(catalog).flatMap((s) => s.views ?? []);
}

/** The views of one store, without the caller having to know the field is optional. */
export function storeViews(store: Store): View[] {
  return store.views ?? [];
}

/**
 * What a view reads, table by table: what it declares, then everything its
 * columns point at that it forgot to declare. A view is allowed to state only
 * one of the two — the coarse list is easier to write by hand, the column
 * lineage is what an extractor produces — and readers should not have to know
 * which of the two the catalog happened to carry.
 */
export function viewReads(view: View): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const id of view.reads ?? []) add(id);
  for (const column of view.columns) {
    for (const ref of column.from ?? []) add(relationOfColumnId(ref));
  }
  return out;
}

/**
 * The relation half of a column id. Ids are dotted all the way down and only
 * the last segment is the column name, so this is a right split, not a left
 * one: "shop.oms.pg.orders.status" is the `status` column of `shop.oms.pg.orders`.
 */
export function relationOfColumnId(id: string): string {
  return id.split(".").slice(0, -1).join(".");
}

/** The column half of a column id — everything after the last dot. */
export function columnNameOfId(id: string): string {
  return id.split(".").at(-1) ?? "";
}

/**
 * A column's id. Columns are not addressed in the JSON, but the selection layer
 * needs one identifier per selectable thing, and "<table id>.<column>" is the
 * spelling a reader would type.
 */
export function columnId(tableId: string, column: string): string {
  return `${tableId}.${column}`;
}

/** The columns a collapsed table card shows: its key, then everything it points at. */
export function keyColumns(table: Table): Column[] {
  return table.columns.filter((c) => c.pk || c.fk);
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

/** A column and everything holding it, so a row can be drawn without a lookup. */
export interface ColumnOwner {
  column: Column;
  table: Table;
  store: Store;
}

/** The same, for a column of a view. Kept apart so `owner.table` never lies. */
export interface ViewColumnOwner {
  column: Column;
  view: View;
  store: Store;
}

/**
 * The block a `maps` path points into, by name. A path is "<Type>.<Field>", and
 * the type is resolved inside the aggregate the table already says it persists
 * — the only scope in which a bare type name is unambiguous.
 */
export function mapsBlockId(
  aggregate: Aggregate | undefined,
  maps: string | undefined,
): string | null {
  if (!aggregate || !maps) return null;
  const head = maps.split(".")[0];
  if (!head) return null;
  const found = aggregateBlocks(aggregate).find((b) => b.block.name === head);
  return found ? found.block.id : null;
}

/** The field half of a `maps` path — everything after the type name. */
export function mapsFieldPath(maps: string): string {
  const at = maps.indexOf(".");
  return at < 0 ? maps : maps.slice(at + 1);
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
  storeById: Map<string, Store>;
  /** table id -> the table and the store holding it */
  tableById: Map<string, { table: Table; store: Store }>;
  /** view id -> the view and the store declaring it */
  viewById: Map<string, { view: View; store: Store }>;
  /** column id -> the column and everything that owns it */
  columnById: Map<string, ColumnOwner>;
  /** column id -> the view column and everything that owns it */
  viewColumnById: Map<string, ViewColumnOwner>;
  /** table or view id -> the views reading it, in catalog order */
  viewsReading: Map<string, View[]>;
  /** column id -> the column ids it is computed from, in declaration order */
  lineageFrom: Map<string, string[]>;
  /** column id -> the column ids computed from it, in catalog order */
  lineageInto: Map<string, string[]>;
  /** service id -> stores it owns, in catalog order */
  storesOwnedBy: Map<string, Store[]>;
  /** aggregate id -> tables naming it in `persists`, in catalog order */
  tablesByAggregate: Map<string, Table[]>;
  /** aggregate id -> views naming it in `persists`, in catalog order */
  viewsByAggregate: Map<string, View[]>;
  /** block id -> columns whose `maps` path lands in that block */
  columnsByBlock: Map<string, ColumnOwner[]>;
  /** table id -> the columns pointing at it through a foreign key */
  fkIntoTable: Map<string, ColumnOwner[]>;
  flowBySlug: Map<string, Flow>;
  /** event id -> flow slugs that reference it in a step */
  flowsByEvent: Map<string, string[]>;
  moduleById: Map<string, ProtoModule>;
  moduleBySlug: Map<string, ProtoModule>;
  /** module id -> the interfaces declaring themselves part of it, with their service */
  interfacesByModule: Map<string, InterfaceOwner[]>;
  /**
   * module id -> services that publish it, vendor it, or name it on a call.
   *
   * The interesting fact about a module is usually who ELSE reads it, and no
   * single field says so: a producer names it on an interface, a consumer on a
   * call, and either may list it under `Service.modules`. One map answers it.
   */
  servicesUsingModule: Map<string, Service[]>;
  adrById: Map<string, Adr>;
  adrBySlug: Map<string, Adr>;
  /** event id -> ADRs that name it in relates.events, newest first */
  adrsByEvent: Map<string, Adr[]>;
}

/** An interface and the service that answers on it. */
export interface InterfaceOwner {
  service: Service;
  provided: RpcService;
}

export function buildIndex(catalog: Catalog): CatalogIndex {
  const serviceById = new Map<string, Service>();
  const serviceContext = new Map<string, BoundedContext>();
  const moduleById = new Map<string, ProtoModule>();
  const moduleBySlug = new Map<string, ProtoModule>();
  const interfacesByModule = new Map<string, InterfaceOwner[]>();
  const servicesUsingModule = new Map<string, Service[]>();
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
  const storeById = new Map<string, Store>();
  const tableById = new Map<string, { table: Table; store: Store }>();
  const viewById = new Map<string, { view: View; store: Store }>();
  const columnById = new Map<string, ColumnOwner>();
  const viewColumnById = new Map<string, ViewColumnOwner>();
  const viewsReading = new Map<string, View[]>();
  const lineageFrom = new Map<string, string[]>();
  const lineageInto = new Map<string, string[]>();
  const storesOwnedBy = new Map<string, Store[]>();
  const tablesByAggregate = new Map<string, Table[]>();
  const viewsByAggregate = new Map<string, View[]>();
  const columnsByBlock = new Map<string, ColumnOwner[]>();
  const fkIntoTable = new Map<string, ColumnOwner[]>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceById.set(service.id, service);
      serviceContext.set(service.id, context);
      for (const call of service.consumes) rpcById.set(call.id, call);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          rpcProviderByMethod.set(`${provided.id}/${method.name}`, service);
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

  // Lineage is recorded from the derived end, which is the only end that
  // declares it, and both directions are kept: "where did this come from" and
  // "who reads this" are asked as often as each other, and answering the
  // second by scanning every column in the catalog is what an index is for.
  const recordLineage = (id: string, column: Column): void => {
    const sources = column.from ?? [];
    if (sources.length === 0) return;
    lineageFrom.set(id, [...sources]);
    for (const source of sources) {
      const list = lineageInto.get(source) ?? [];
      if (!list.includes(id)) list.push(id);
      lineageInto.set(source, list);
    }
  };

  // Modules are collected from both ends: the top-level list says what exists,
  // and the services say who touches it. A module named by a service the
  // catalog has no entry for is refused by the validator, so nothing here has
  // to guess.
  for (const module of allModules(catalog)) {
    moduleById.set(module.id, module);
    moduleBySlug.set(module.slug, module);
  }

  const uses = (moduleId: string, service: Service) => {
    const list = servicesUsingModule.get(moduleId) ?? [];
    if (!list.includes(service)) list.push(service);
    servicesUsingModule.set(moduleId, list);
  };

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const moduleId of service.modules ?? []) uses(moduleId, service);
      for (const provided of service.provides) {
        if (provided.module === undefined) continue;
        const list = interfacesByModule.get(provided.module) ?? [];
        list.push({ service, provided });
        interfacesByModule.set(provided.module, list);
        uses(provided.module, service);
      }
      for (const call of service.consumes) {
        if (call.module !== undefined) uses(call.module, service);
      }
    }
  }

  // Stores come after the domain tree because they point into it: a table says
  // which aggregate it persists, and a column which block it maps to, so both
  // are resolved against maps that are already full.
  for (const store of allStores(catalog)) {
    storeById.set(store.id, store);
    const owned = storesOwnedBy.get(store.owner) ?? [];
    owned.push(store);
    storesOwnedBy.set(store.owner, owned);

    for (const table of store.tables) {
      tableById.set(table.id, { table, store });
      // A table may name only the block it holds. That block belongs to an
      // aggregate, and an aggregate's Persistence section has to list it, so
      // the owner is filled in here rather than asked for twice in the JSON.
      const aggregateId =
        table.persists?.aggregate ??
        (table.persists?.block
          ? blockById.get(table.persists.block)?.aggregate.id
          : undefined);
      if (aggregateId) {
        const list = tablesByAggregate.get(aggregateId) ?? [];
        list.push(table);
        tablesByAggregate.set(aggregateId, list);
      }
      const aggregate = aggregateId
        ? aggregateById.get(aggregateId)
        : undefined;

      for (const column of table.columns) {
        const owner: ColumnOwner = { column, table, store };
        columnById.set(columnId(table.id, column.name), owner);
        recordLineage(columnId(table.id, column.name), column);
        if (column.fk) {
          const into = fkIntoTable.get(column.fk.table) ?? [];
          into.push(owner);
          fkIntoTable.set(column.fk.table, into);
        }
        // `persists.block` names the block outright; otherwise the head of the
        // maps path is resolved inside the aggregate the table persists.
        const blockId =
          table.persists?.block ?? mapsBlockId(aggregate, column.maps);
        if (blockId && column.maps) {
          const list = columnsByBlock.get(blockId) ?? [];
          list.push(owner);
          columnsByBlock.set(blockId, list);
        }
      }
    }

    // Views after the tables of the same store: a view reads tables, and the
    // ones it reads are usually its neighbours in the same file.
    for (const view of storeViews(store)) {
      viewById.set(view.id, { view, store });
      const aggregateId =
        view.persists?.aggregate ??
        (view.persists?.block
          ? blockById.get(view.persists.block)?.aggregate.id
          : undefined);
      if (aggregateId) {
        const list = viewsByAggregate.get(aggregateId) ?? [];
        list.push(view);
        viewsByAggregate.set(aggregateId, list);
      }
      for (const readId of viewReads(view)) {
        const list = viewsReading.get(readId) ?? [];
        if (!list.includes(view)) list.push(view);
        viewsReading.set(readId, list);
      }
      for (const column of view.columns) {
        const id = columnId(view.id, column.name);
        viewColumnById.set(id, { column, view, store });
        recordLineage(id, column);
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
    storeById,
    tableById,
    viewById,
    columnById,
    viewColumnById,
    viewsReading,
    lineageFrom,
    lineageInto,
    storesOwnedBy,
    moduleById,
    moduleBySlug,
    interfacesByModule,
    servicesUsingModule,
    tablesByAggregate,
    viewsByAggregate,
    columnsByBlock,
    fkIntoTable,
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
        // A duplicate method name is not a cosmetic problem: `exposedBy` names
        // a method by name alone, and `rpcProviderByMethod` is keyed by it, so
        // two methods called the same thing make one of them unreachable.
        assertUniqueSlugs(
          provided.methods.map((method) => method.name),
          `interface "${provided.id}"`,
          "method",
        );
        for (const method of provided.methods) {
          if (
            method.streaming !== undefined &&
            !STREAMING.includes(method.streaming)
          ) {
            fail(
              `method "${provided.id}/${method.name}" streams "${method.streaming}"; expected one of ${STREAMING.join(", ")}`,
              `service ${service.id}`,
            );
          }
        }
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

      // Every method this service answers on, whichever interface declares it.
      // An operation says which of them expose it, and a name that matches none
      // of them is a link into nothing.
      const methods = new Set(
        service.provides.flatMap((provided) =>
          provided.methods.map((method) => method.name),
        ),
      );

      assertUniqueSlugs(
        service.aggregates.map((a) => a.slug),
        `service "${service.id}"`,
        "aggregate",
      );
      for (const aggregate of service.aggregates) {
        for (const operation of aggregate.operations) {
          for (const method of operation.exposedBy ?? []) {
            if (!methods.has(method)) {
              fail(
                `operation "${operation.id}" of aggregate "${aggregate.id}" says it is exposed by "${method}", which no interface of service "${service.id}" declares`,
                `aggregate ${aggregate.id} / operation ${operation.id}`,
              );
            }
          }
        }
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

  const flowContextIds = new Set(catalog.contexts.map((c) => c.id));

  for (const flow of catalog.flows) {
    const lanes = new Set(flow.participants.map((p) => p.id));
    if (lanes.size !== flow.participants.length) {
      fail(
        `flow "${flow.slug}" has duplicate participant ids`,
        `flow ${flow.id}`,
      );
    }
    // Whatever derived the flow knew which service's tree it was reading, so
    // there is no case where the owner is unknowable. Without it the flow has
    // no group to sit under and the tree files it as a defect.
    if (flow.owner === undefined) {
      fail(
        `flow "${flow.slug}" names no owner; a flow must state the context it belongs to`,
        `flow ${flow.id}`,
      );
    }
    if (flow.owner !== undefined && !flowContextIds.has(flow.owner)) {
      fail(
        `flow "${flow.slug}" names owner "${flow.owner}", which is not a bounded context`,
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

  validateStores(catalog);
  validateModules(catalog);
  validateAdrs(catalog, eventIds);

  return catalog;
}

/**
 * A module reference may only point at a module that exists.
 *
 * `deps` are the exception, and deliberately NOT checked. A module's
 * dependencies come from its own lock file and routinely name modules this
 * estate never vendored - the same kind of fact as an `RpcCall` to a peer
 * outside the catalog. Requiring them to resolve would mean a module could only
 * be recorded once everything it transitively depends on had been vendored too,
 * which is a rule about the estate's homework rather than about the catalog
 * being coherent. A dangling dep is shown as a name the catalog does not hold.
 *
 * Also NOT checked: whether a method's `request` names a message the interface
 * actually lists, and whether a module is pinned to a commit. Both are
 * legitimate mid-migration states - a copy vendored before the producer
 * published, a module tracked by label - and refusing to render the catalog
 * over either would be refusing to describe the estate as it is. They belong on
 * the Problems page, which is where the rest of that judgement already lives.
 */
function validateModules(catalog: Catalog): void {
  const modules = allModules(catalog);
  const ids = new Set(modules.map((m) => m.id));
  const serviceIds = new Set(allServices(catalog).map((s) => s.id));

  assertUniqueSlugs(
    modules.map((m) => m.id),
    "catalog",
    "module",
  );
  // Slugs are what the URL uses, so two modules sharing one would put two
  // entities at the same address.
  assertUniqueSlugs(
    modules.map((m) => m.slug),
    "catalog",
    "module slug",
  );

  for (const module of modules) {
    if (module.owner !== undefined && !serviceIds.has(module.owner)) {
      fail(
        `module "${module.id}" is owned by "${module.owner}", which is not a service in this catalog`,
        `module ${module.id}`,
      );
    }
  }

  const refers = (module: string, where: string, path: string) => {
    if (!ids.has(module)) {
      fail(
        `${where} names module "${module}", which is not in this catalog`,
        path,
      );
    }
  };

  for (const service of allServices(catalog)) {
    for (const module of service.modules ?? []) {
      refers(module, `service "${service.id}"`, `service ${service.id}`);
    }
    for (const provided of service.provides) {
      if (provided.module !== undefined) {
        refers(
          provided.module,
          `interface "${provided.id}"`,
          `service ${service.id}`,
        );
      }
    }
    for (const call of service.consumes) {
      if (call.module !== undefined) {
        refers(call.module, `call "${call.id}"`, `service ${service.id}`);
      }
    }
  }
}

/**
 * A schema may only point at things that exist. A foreign key into a table
 * nobody declared, or a `persists` naming an aggregate that is not in the
 * catalog, would draw an edge into open water on a canvas whose whole job is
 * to show where the edges land — so both fail the build.
 *
 * What is NOT checked here: whether an outbox actually carries a payload, and
 * whether a table's columns still match the aggregate it claims to persist.
 * Those are judgements about a model that is allowed to be mid-migration, and
 * they are reported on the Problems page as warnings rather than refusing to
 * render the catalog at all.
 */
function validateStores(catalog: Catalog): void {
  const stores = allStores(catalog);
  if (stores.length === 0) return;

  const serviceIds = new Set(allServices(catalog).map((s) => s.id));
  const aggregates = new Map(allAggregates(catalog).map((a) => [a.id, a]));

  assertUniqueSlugs(
    stores.map((s) => s.id),
    "catalog",
    "store",
  );

  // Every table id first: a foreign key may point forwards, at a table in a
  // store declared later in the file.
  const columnsOfTable = new Map<string, Set<string>>();
  for (const store of stores) {
    for (const table of store.tables) {
      if (columnsOfTable.has(table.id)) {
        fail(`table id "${table.id}" is not unique`, `store ${store.id}`);
      }
      columnsOfTable.set(table.id, new Set(table.columns.map((c) => c.name)));
    }
  }

  // Views join the same namespace: a database will not let a view and a table
  // share a name, and lineage points at both, so one map answers "does this id
  // exist, and does it have that column" for either.
  const columnsOfRelation = new Map(columnsOfTable);
  for (const store of stores) {
    for (const view of storeViews(store)) {
      if (columnsOfRelation.has(view.id)) {
        fail(
          `view id "${view.id}" collides with another table or view`,
          `store ${store.id}`,
        );
      }
      columnsOfRelation.set(view.id, new Set(view.columns.map((c) => c.name)));
    }
  }

  /** A column reference — "<relation id>.<column>" — that has to resolve. */
  const checkColumnRef = (ref: string, where: string, what: string): void => {
    const relation = relationOfColumnId(ref);
    const columns = columnsOfRelation.get(relation);
    if (!columns) {
      fail(
        `${what} names "${ref}", and "${relation}" is not a table or view in the catalog`,
        where,
      );
    } else if (!columns.has(columnNameOfId(ref))) {
      fail(
        `${what} names "${ref}", and "${relation}" has no column "${columnNameOfId(ref)}"`,
        where,
      );
    }
  };

  for (const store of stores) {
    if (store.id !== `${store.owner}.${store.slug}`) {
      fail(
        `store "${store.id}" is owned by "${store.owner}", so its id must be "${store.owner}.${store.slug}"`,
        `store ${store.id}`,
      );
    }
    if (!serviceIds.has(store.owner)) {
      fail(
        `store "${store.id}" is owned by "${store.owner}", which is not a service in the catalog`,
        `store ${store.id}`,
      );
    }
    if (!STORE_KINDS.includes(store.kind)) {
      fail(
        `store "${store.id}" has kind "${store.kind}"; expected one of ${STORE_KINDS.join(", ")}`,
        `store ${store.id}`,
      );
    }

    for (const table of store.tables) {
      const where = `store ${store.id} / table ${table.name}`;
      if (table.id !== `${store.id}.${table.name}`) {
        fail(
          `table "${table.id}" in store "${store.id}" must have id "${store.id}.${table.name}"`,
          where,
        );
      }
      if (table.role !== undefined && !TABLE_ROLES.includes(table.role)) {
        fail(
          `table "${table.id}" has role "${table.role}"; expected one of ${TABLE_ROLES.join(", ")}`,
          where,
        );
      }

      const own = columnsOfTable.get(table.id) ?? new Set<string>();
      if (own.size !== table.columns.length) {
        fail(`table "${table.id}" has duplicate column names`, where);
      }

      const aggregateId = table.persists?.aggregate;
      const aggregate = aggregateId ? aggregates.get(aggregateId) : undefined;
      if (aggregateId && !aggregate) {
        fail(
          `table "${table.id}" persists unknown aggregate "${aggregateId}"`,
          where,
        );
      }
      const blockId = table.persists?.block;
      if (blockId) {
        // A block is named "<aggregate id>.<slug>", so a block belonging to
        // another aggregate than the one the table persists is a contradiction
        // the id itself spells out.
        const owner =
          aggregate ??
          aggregates.get(blockId.split(".").slice(0, -1).join("."));
        const found = owner
          ? aggregateBlocks(owner).some((b) => b.block.id === blockId)
          : false;
        if (!found) {
          fail(
            `table "${table.id}" persists block "${blockId}", which is not a block of ${aggregateId ? `aggregate "${aggregateId}"` : "any aggregate in the catalog"}`,
            where,
          );
        }
      }

      for (const index of table.indexes ?? []) {
        for (const column of index.columns) {
          if (!own.has(column)) {
            fail(
              `index "${index.name}" on table "${table.id}" names column "${column}", which the table does not have`,
              where,
            );
          }
        }
      }

      for (const column of table.columns) {
        for (const ref of column.from ?? []) {
          const self = `${table.id}.${column.name}`;
          if (ref === self) {
            fail(
              `column "${self}" is declared as derived from itself`,
              `${where} / column ${column.name}`,
            );
          }
          checkColumnRef(
            ref,
            `${where} / column ${column.name}`,
            `column "${column.name}" of table "${table.id}" is derived from a column that`,
          );
        }
        if (!column.fk) continue;
        const target = columnsOfTable.get(column.fk.table);
        if (!target) {
          fail(
            `column "${column.name}" of table "${table.id}" has a foreign key into "${column.fk.table}", which is not a table in the catalog`,
            `${where} / column ${column.name}`,
          );
        } else if (!target.has(column.fk.column)) {
          fail(
            `column "${column.name}" of table "${table.id}" has a foreign key into "${column.fk.table}.${column.fk.column}", and that table has no such column`,
            `${where} / column ${column.name}`,
          );
        }
      }
    }

    for (const view of storeViews(store)) {
      const where = `store ${store.id} / view ${view.name}`;
      if (view.id !== `${store.id}.${view.name}`) {
        fail(
          `view "${view.id}" in store "${store.id}" must have id "${store.id}.${view.name}"`,
          where,
        );
      }

      const own = columnsOfRelation.get(view.id) ?? new Set<string>();
      if (own.size !== view.columns.length) {
        fail(`view "${view.id}" has duplicate column names`, where);
      }

      const aggregateId = view.persists?.aggregate;
      if (aggregateId && !aggregates.has(aggregateId)) {
        fail(
          `view "${view.id}" presents unknown aggregate "${aggregateId}"`,
          where,
        );
      }

      for (const readId of view.reads ?? []) {
        if (readId === view.id) {
          fail(`view "${view.id}" is declared as reading itself`, where);
        }
        if (!columnsOfRelation.has(readId)) {
          fail(
            `view "${view.id}" reads "${readId}", which is not a table or view in the catalog`,
            where,
          );
        }
      }

      for (const column of view.columns) {
        const at = `${where} / column ${column.name}`;
        // A view has no rows of its own, so it has no key of its own either.
        // Saying otherwise would put a key glyph on a card that cannot enforce
        // one, which is the sort of small lie a schema browser exists to stop.
        if (column.pk) {
          fail(
            `column "${column.name}" of view "${view.id}" is marked as a primary key; a view has no key of its own`,
            at,
          );
        }
        if (column.fk) {
          fail(
            `column "${column.name}" of view "${view.id}" declares a foreign key; a view states what it reads through lineage, not through constraints`,
            at,
          );
        }
        for (const ref of column.from ?? []) {
          if (ref === `${view.id}.${column.name}`) {
            fail(
              `column "${view.id}.${column.name}" is declared as derived from itself`,
              at,
            );
          }
          checkColumnRef(
            ref,
            at,
            `column "${column.name}" of view "${view.id}" is derived from a column that`,
          );
        }
      }
    }
  }

  const storeIds = new Set(stores.map((s) => s.id));
  for (const service of allServices(catalog)) {
    for (const storeId of service.stores ?? []) {
      if (!storeIds.has(storeId)) {
        fail(
          `service "${service.id}" lists unknown store "${storeId}"`,
          `service ${service.id}`,
        );
      }
    }
  }
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
