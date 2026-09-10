// The contract. Every fact rendered by portolan comes from a Catalog value,
// and every Catalog value is validated before the app is allowed to draw it.

export type Status = "verified" | "declared" | "unresolved";

/** Every status, best first: the order a count or a filter lists them in. */
export const STATUSES: readonly Status[] = [
  "verified",
  "declared",
  "unresolved",
];

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
  /**
   * The vocabulary each context speaks, read out of its `GLOSSARY.md`.
   * Optional in the file and never optional downstream, exactly like `stores`
   * and `modules`: an estate that has written no glossary renders as it did
   * before there was one to read.
   */
  terms?: Term[];
  /**
   * Where the estate's code was read, for the repositories that are not this
   * one. Optional in the file and never optional downstream, exactly like
   * `stores` and `modules`: an estate whose services all live here has nothing
   * to pin and renders as it did before there was anything to pin.
   */
  repos?: RepoPin[];
  /**
   * The systems outside the estate that a service calls on a contract: a
   * payment provider, a tax API, a carrier. Nobody here builds one, so it has
   * no context, no aggregates and no repository - only the interfaces it
   * answers on, read from the copy of its document vendored beside the adapter
   * that calls it. Optional in the file and never optional downstream, like
   * `stores`: an estate that calls nobody outside renders as it did before.
   */
  externals?: External[];
}
/**
 * A system outside the estate, with a contract.
 *
 * The difference from a service is what the catalog may claim about it: what it
 * answers on, and nothing else. The difference from an `unknown` participant
 * is that the calls land: a step to an external names an operation its
 * document declares, so the arrow is `declared`, not `unresolved` - and the
 * catalog still does not pretend to own the far end.
 */
export interface External {
  /** Sits at the root beside the contexts, so its id is its slug and has no dot. */
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Where the third party documents itself, for a reader who needs more than the copy. */
  url?: string;
  provides: RpcService[];
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
  /** Semantic role of this top-level group. Absent preserves the historical bounded-context meaning (portolan.0004). */
  kind?: GroupKind;
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

export type GroupKind =
  "bounded-context" | "system" | "product" | "team" | "namespace";

export const GROUP_KINDS: readonly GroupKind[] = [
  "bounded-context",
  "system",
  "product",
  "team",
  "namespace",
] as const;

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
  /** Runtime or code role. Absent preserves the historical service meaning. */
  kind?: ComponentKind;
  /** Technology names discovered from build and deployment manifests. */
  technologies?: string[];
  provides: RpcService[];
  consumes: RpcCall[];
  /** Interfaces read from vendored proto copies, retained for drift checks. */
  copies?: RpcService[];
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
  /**
   * Channels this service declares it publishes on or listens to, read out of
   * an AsyncAPI document. Absent for a service with no such document, which is
   * not the same as a service that speaks to nobody.
   */
  channels?: Channel[];
  /**
   * Who to ask about it, as CODEOWNERS spells them: `@acme/oms-team`,
   * `@someone`, `dev@acme.io`.
   *
   * Handles, and deliberately nothing more. Resolving one to the people in it
   * is a call to a forge's API, which needs a credential, answers differently
   * tomorrow, and would put the estate's documentation behind an outage. A
   * handle is what the reviewer types and what the file says, so a handle is
   * what the page shows.
   *
   * Absent means nobody was named, which is not the same as nobody owning it -
   * an estate that keeps no CODEOWNERS has an owner for everything and has
   * written it down nowhere.
   */
  owners?: string[];
  /**
   * What a developer types against the checkout: the make targets, npm
   * scripts, just recipes and task-runner tasks the repository declares. Read
   * from the runner files, never from the README, so the list is the one the
   * runner would accept. Absent when nothing declares any, which is not the
   * same as a service that cannot be built.
   */
  commands?: Command[];
}

/**
 * One entry of a task runner's file: a make target, an npm script, a just
 * recipe, a Taskfile task, a poe or pdm task.
 *
 * `run` is the whole point - the line a reader copies - and it is spelled
 * here rather than rebuilt from the runner and the name, because `npm test`
 * and `npm run typecheck` are two spellings of one runner and the page should
 * not have to know which scripts npm treats specially.
 */
export interface Command {
  /** The tool the line is typed at: make, npm, pnpm, yarn, bun, just, task, poe, pdm. */
  runner: string;
  /** The target, script, recipe or task as its file spells it. */
  name: string;
  /** The line to type at a shell in the service's directory. */
  run: string;
  /**
   * What the file says the command is for, when it says anything: a `##`
   * comment on a make target, a `#` line over a just recipe, a task's `desc`,
   * a poe task's `help`. Most files say nothing.
   */
  doc?: string;
  /**
   * What the runner executes for it: the recipe, the script line, the cmds.
   * Carried so a name that says nothing can still be read, and shown folded,
   * because a build script is not a sentence.
   */
  body?: string;
  /** The file and line the entry was read at. */
  source?: string;
}

export type ComponentKind =
  | "service"
  | "application"
  | "webapp"
  | "worker"
  | "job"
  | "function"
  | "cli"
  | "library"
  | "data-pipeline";

export const COMPONENT_KINDS: readonly ComponentKind[] = [
  "service",
  "application",
  "webapp",
  "worker",
  "job",
  "function",
  "cli",
  "library",
  "data-pipeline",
] as const;

/** Neutral vocabulary for consumers that do not assume DDD. */
export type Group = BoundedContext;
export type Component = Service;
export interface RpcService {
  id: string;
  methods: RpcMethod[];
  source: string;
  /**
   * Request and response shapes, when the generator could read them. Optional:
   * a service whose protos were not parsed still lists its methods.
   */
  messages?: RpcMessage[];
  /**
   * The enums the messages' fields name, reached the way `messages` are:
   * from the methods, through the fields, as far as the document declares.
   */
  enums?: RpcEnum[];
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
  /**
   * The route, for a method read from an OpenAPI document: the verb and the
   * path template as the document writes them. This is what lets a request
   * seen on the wire be read back to the operation it ran.
   */
  http?: HttpRoute;
  /** Concrete SOAP binding read from a WSDL operation. */
  soap?: SoapRoute;
}

export interface HttpRoute {
  /** Upper case: `POST`. */
  method: string;
  /** As templated in the document: `/v1/users/{id}`. */
  path: string;
}

export interface SoapRoute {
  action?: string;
  version?: "1.1" | "1.2";
  style?: string;
  endpoint?: string;
  binding?: string;
  faults?: string[];
  headers?: string[];
}

export type Streaming = "client" | "server" | "bidi";

export const STREAMING: readonly Streaming[] = [
  "client",
  "server",
  "bidi",
] as const;
/** An enum a proto declares. The number is what a binary message carries. */
export interface RpcEnum {
  name: string;
  doc?: string;
  values: RpcEnumValue[];
}
export interface RpcEnumValue {
  name: string;
  number: number;
  doc?: string;
}

export interface RpcMessage {
  name: string; // "PlaceOrderRequest"
  fields: Field[];
  /** How this OpenAPI message selects one concrete variant on the wire. */
  discriminator?: RpcDiscriminator;
}

export interface RpcDiscriminator {
  /** JSON property carrying the discriminator value. */
  property: string;
  variants: RpcVariant[];
}

export interface RpcVariant {
  /** Value carried in `property`. */
  value: string;
  /** Concrete message selected by that value. */
  message: string;
}
/**
 * Where a derived edge was read from: the flow step that implies it. A
 * consumer or a call carrying `via` was not declared by any source; it is
 * what a flow already said, written where the graph can read it. It is kept
 * as a field rather than a note because the UI links back to the step.
 */
export interface EdgeVia {
  flow: string; // Flow.slug
  step: string; // Step.id
}
/** Source facts remain separate from the merge's choice of provider. */
export interface HTTPDestination {
  callSite: string;
  endpointExpression: string;
  method: string;
  localPath?: string;
  baseURL?: HTTPBaseURL;
  serviceDiscoveryAlias?: string;
  fullPath?: string;
  join?: { expression: string; source: string };
  /** Runtime URL modifiers after the proven join; not evaluated statically. */
  transforms?: { expression: string; source: string }[];
  resolution?: { basis: "full-path" | "exact-route" | "unique-suffix"; provider: string; route: string };
}
export interface HTTPBaseURL {
  expression: string;
  configField?: string;
  environmentVariable?: string;
  value?: string;
  kind: "literal" | "config-default" | "symbolic";
  source: string;
  optionSource?: string;
}
export interface RpcCall {
  destination?: HTTPDestination;
  id: string; // "<proto.package.Service>/<Method>"
  peer: string; // service id if resolved, else raw name
  status: Status;
  source: string;
  note?: string;
  /** The module the vendored copy this call was read from belongs to. */
  module?: string;
  /** Set when the call was derived from a flow step rather than declared. */
  via?: EdgeVia;
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

/**
 * A repository the estate was read at, and the commit it was read at.
 *
 * It exists so a source path can be a link when the code is not in this
 * repository. A service says which repository it lives in; only whoever
 * fetched that repository knows which commit the copy is of, and by the time
 * an extractor runs, that fact is in a lock file no page ever reads.
 *
 * It is a list on the catalog rather than a field on `Service` because the pin
 * is a fact about the estate and not about one service: a repository holding
 * three services is fetched once, at one commit, and writing that commit three
 * times would be three places for it to disagree with itself.
 */
export interface RepoPin {
  /** The repository, spelled the way `Service.repo` spells it: "github.com/acme/shop". */
  repo: string;
  /** The commit the copy was made of. Full sha: it is not resolved locally, so there is nothing to expand it against. */
  commit: string;
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
export interface Event {
  id: string; // "<service id>.<aggregate>.<Name>"
  slug: string;
  name: string;
  versions: EventVersion[]; // >=1, oldest first
  consumers: EventConsumer[];
  /**
   * How the event leaves the service. Optional because a hand-written catalog
   * may not know, and an extractor only says what the source declares.
   */
  wire?: EventWire;
}
/**
 * The event as the bus sees it: its name on the message and the channel it
 * is published on. The two are different facts - one topic carries every
 * event of an aggregate, and a subscriber dispatches on the name - and a
 * trace carries both, as `event.name` and `messaging.destination.name`.
 * This is the one place the catalog and a running system meet by string.
 */
export interface EventWire {
  /** "cart.BasketCreated" - the name on the message, as a trace's event.name. */
  name: string;
  /**
   * "cart_basket" - the topic, subject or stream it is published on. Absent
   * when the source names the event but does not say where it goes.
   */
  channel?: string;
}
/**
 * A topic, subject or stream a service says it uses, and the messages that
 * travel on it. This is what an AsyncAPI document declares - the async half of
 * what an OpenAPI document says about routes.
 *
 * The catalog knew about channels before this, but only by inference: an event
 * carries a wire, and a channel was whatever the events happened to name. A
 * declaration is a different fact, and it says two things inference could not.
 * What the service means to put on the bus, whether or not an extractor found
 * an event saying so - and what it listens for, which nothing in a publisher's
 * source could ever say.
 */
export interface Channel {
  /**
   * "shop.cart.basket" - the channel as the broker knows it. The same string an
   * event's `wire.channel` carries, and comparing the two is how a document and
   * the code beside it are held against each other.
   */
  address: string;
  /** Domain event by default; jobs are work queues and messages are generic streams. */
  kind?: "event" | "job" | "message";
  title?: string;
  doc?: string;
  messages: ChannelMessage[];
  /** The document this was read out of. */
  source?: string;
}
/**
 * Which way a message travels, from this service's side.
 *
 * It decides ownership: a service that sends on a channel publishes on it, and
 * a channel has one publisher. A service that only receives is a subscriber,
 * and any number of those is the point of a bus.
 */
export type ChannelDirection = "send" | "receive";
export interface ChannelMessage {
  /** "cart.BasketCreated" - the name on the message, as an event's wire.name. */
  name: string;
  title?: string;
  doc?: string;
  direction: ChannelDirection;
  /** Normalized payload serialization, such as `msgpack`. */
  encoding?: string;
  /** Exact media type declared by the source contract. */
  contentType?: string;
}
export interface EventConsumer {
  service: string;
  status: Status;
  note?: string;
  /** Set when the consumer was derived from a flow step rather than declared. */
  via?: EdgeVia;
}
export interface EventVersion {
  version: string;
  doc: string;
  /** This version is superseded, per a `@deprecated` on the class that carries it. */
  deprecated?: boolean;
  source: string;
  fields: Field[];
}
export interface Field {
  name: string;
  type: string;
  doc: string;
  /** Still on the wire, but not to be written or read anew: a `@deprecated` on the field. */
  deprecated?: boolean;
  ref?: string;
  /** Protobuf field number; absent for sources whose wire has no field numbers. */
  number?: number;
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
  | "other";

export const STORE_KINDS: readonly StoreKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "mongodb",
  "clickhouse",
  "s3",
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
  /** Redis key families proved by client calls. Dynamic parts use `{name}`. */
  keyspaces?: RedisKeyspace[];
  /** Migrations directory or config path, as a reader would open it. */
  source?: string;
}

export type RedisOperation =
  "read" | "write" | "delete" | "exists" | "expire" | "count";

export const REDIS_OPERATIONS: readonly RedisOperation[] = [
  "read",
  "write",
  "delete",
  "exists",
  "expire",
  "count",
] as const;

/** A source-backed family of Redis keys, not a relational table. */
export interface RedisKeyspace {
  pattern: string;
  operations: RedisOperation[];
  /** Source spelling of a fixed, configured or caller-provided expiry. */
  ttl?: string;
  /** Value type where a write or marshal call proves it. */
  value?: string;
  source?: string;
  /** Aggregate or block whose value this key family holds, when provable. */
  persists?: { aggregate?: string; block?: string };
  /** Individual client calls, before they are folded into `operations`. */
  accesses?: RedisAccess[];
}

export interface RedisAccess {
  operation: RedisOperation;
  /** Enclosing adapter method, for example `Store.Get`. */
  method?: string;
  ttl?: string;
  value?: string;
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
  /** Source-backed repository methods that read or write this table. */
  accesses?: TableAccess[];
}

export type TableOperation = "read" | "write" | "delete";

export const TABLE_OPERATIONS: readonly TableOperation[] = [
  "read",
  "write",
  "delete",
] as const;

export interface TableAccess {
  operation: TableOperation;
  /** Enclosing adapter method, for example `Postgres.Save`. */
  method?: string;
  source?: string;
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
 * Extractors may attach the execution trigger they proved. Authored flows omit
 * it when that evidence is not part of the document.
 */
export interface Flow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  source?: string; // the file the flow was read out of
  /** Source-backed execution root and the strength of that evidence. */
  trigger?: FlowTrigger;
  /** Source function this flow expands, used for evidence-backed composition. */
  entrypoint?: string;
  /** Source-backed flow fragments composed into this root flow. */
  includes?: string[];
  /**
   * The top-level group this flow belongs to. Whatever derived the flow read
   * one component's tree to find it and therefore knows the answer, so the flow
   * states it instead of leaving a reader to recover it from `source` - and the
   * validator holds every flow to it, because a flow with no owner has nowhere
   * to sit in the tree.
   */
  owner: string;
  participants: Participant[]; // order is significant - it is the lane order
  steps: FlowNode[];
}
export interface FlowTrigger {
  kind:
    | "http"
    | "callback"
    | "event"
    | "message"
    | "job"
    | "startup"
    | "scheduled"
    | "manual"
    | "unproven";
  label?: string;
  confidence: "high" | "medium" | "low";
}
export interface Participant {
  id: string;
  kind: "actor" | "service" | "broker" | "store" | "external" | "unknown";
  context: string | null; // null for actors and brokers
  label?: string;
}
export type FlowNode = Step | Parallel | Alt | Loop;
export interface Step {
  destination?: HTTPDestination;
  type: "step";
  id: string;
  from: string;
  to: string; // participant ids; from === to is a self-message
  kind: "rpc" | "event" | "call" | "response";
  ref?: string; // Event.id, RpcCall.id or provided RPC method id; otherwise unresolved
  label?: string;
  status: Status;
  note?: string;
  line?: string;
  /** Synchronous request step this synthesized response returns from. */
  replyTo?: string;
  /** Proven HTTP wire contract for a response step. */
  http?: HTTPResponse;
  /** Source function execution enters here, when an extractor can prove it. */
  continuesAt?: string;
  /** Source functions proven to execute on the path represented by this step. */
  reaches?: string[];
  /** Exact asynchronous send/receive evidence used for flow composition. */
  handoff?: FlowHandoff;
  /** Repository call resolved to a concrete store operation after merge. */
  storeAccess?: FlowStoreAccess;
}
export interface HTTPResponse {
  status?: number;
  contentType?: string;
  body?: string;
  /** RPC method whose response value is serialized into this body. */
  bodyRef?: string;
  encoding?: string;
  outcome?: "success" | "error";
  warning?: string;
  source?: string;
  /** Shape recovered directly from a literal response body. */
  fields?: Field[];
}
export interface FlowHandoff {
  kind: "message" | "job";
  transport: string;
  channel: string;
  message?: string;
  direction: "send" | "receive";
}
export interface FlowStoreAccess {
  store: string;
  method?: string;
  operation?: RedisOperation;
  keyspace?: string;
  /** Concrete adapter call rather than the use-case-side repository call. */
  source?: string;
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
// The ubiquitous language. One meaning per word inside a context, written down
// where the code that uses the word lives, and the leaf everything else points
// to: a term links nowhere, and nothing here is derived from the model.
//
// A word and a sentence, and nothing else. What the sentence says is the
// author's business - the one thing in this catalog that no extractor could
// have worked out from the code, and the one thing a parser has no business
// taking apart.
// ---------------------------------------------------------------------------

export interface Term {
  /** "<context>.<slug>" - auth.session. A word means one thing per context. */
  id: string;
  slug: string;
  /** The context whose vocabulary this is, never the service the file sat in. */
  context: string;
  /** As the glossary spells it, which is how the code spells it: "Email address". */
  name: string;
  /** What it means, as the glossary's own paragraph: markdown, one line. */
  definition: string;
  /** `path:line` of the entry, as everything else in the catalog spells a source. */
  source: string;
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
  // Prose about the record that no other field holds - most often that part of
  // it was decided again elsewhere without the whole of it being superseded.
  // It sits in the header, above the frozen body, because it is the thing to
  // read before the decision rather than after it.
  note?: string;
  supersededBy?: string; // Adr.id
  supersedes?: string[];
  relates: { services?: string[]; events?: string[]; flows?: string[] };
  source: string; // path to the .md in its repo
  // What git says about the file: the commit that first added it, and the one
  // that last touched it when that is a different commit. Absent when the
  // tree had no history to read.
  created?: AdrCommit;
  revised?: AdrCommit;
}

export interface AdrCommit {
  commit: string; // full sha
  author: string; // author name as git records it
  date: string; // committer date, ISO
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

/** Neutral alias for allServices; both names intentionally address the same wire model. */
export function allComponents(catalog: Catalog): Component[] {
  return allServices(catalog);
}

export function groupKind(group: Group): GroupKind {
  return group.kind ?? "bounded-context";
}

export function componentKind(component: Component): ComponentKind {
  return component.kind ?? "service";
}

/** Every system outside the estate with a contract, in catalog order. */
export function allExternals(catalog: Catalog): External[] {
  return catalog.externals ?? [];
}

export function allEvents(catalog: Catalog): Event[] {
  return allServices(catalog).flatMap((s) =>
    s.aggregates.flatMap((a) => a.events),
  );
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

/** Every term in every glossary. Absent means none, exactly as with modules. */
export function allTerms(catalog: Catalog): Term[] {
  return catalog.terms ?? [];
}

/** Every repository the estate was read at. Absent means none, exactly as with modules. */
export function allRepos(catalog: Catalog): RepoPin[] {
  return catalog.repos ?? [];
}

/** Who to ask about a service, without the caller having to know the field is optional. */
export function ownersOf(service: Service): string[] {
  return service.owners ?? [];
}

export function technologiesOf(component: Component): string[] {
  return component.technologies ?? [];
}

export function commandsOf(component: Component): Command[] {
  return component.commands ?? [];
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

/** Contexts touched by a flow, in participant order, ignoring null-context lanes. */
export function flowContexts(flow: Flow): string[] {
  const seen: string[] = [];
  for (const p of flow.participants) {
    if (p.context && !seen.includes(p.context)) seen.push(p.context);
  }
  return seen;
}
