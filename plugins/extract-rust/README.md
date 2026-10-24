# extract-rust

A Rust service in, a catalog fragment out. The Rust twin of `extract-go` and
`extract-ts`: it describes one service - its aggregates, what they publish,
what runs when somebody calls in, what the service calls, the Kafka topics its
`rdkafka` adapters use, and the Temporal workflows its workers register - by
reading the tree, and it reads the tree by its layout. Nothing is annotated
for the catalog; the source is the claim.

Written in Rust and run as a process plugin, `cargo run --quiet --manifest-path
plugins/extract-rust/Cargo.toml`, because the right parser for Rust is Rust's
own: `syn` reads the whole language, and `proc-macro2`'s span locations turn a
node back into `file:line`. There is no type checker; everything is resolved
by name and by `use` path, which is all a layout that is the claim needs.

## The layout it reads

```
src/
  domain/<aggregate>/
    <aggregate>.rs        the root: a pub struct named like the directory, in PascalCase
    *.rs                  entities: other pub structs in the directory's own files
    vo/*.rs               value objects: pub structs under vo/
    *.rs, vo/*.rs         enums: pub enums whose every variant is a bare name; `Error` is skipped
    rules/*.rs            specifications; skipped, they are not shapes
    event/*.rs            one pub struct per event, named by `fn name(&self) -> &'static str { "oms.OrderPlaced" }`
                          in any impl of it, or by `pub const NAME: &str`
    port.rs               traits a use case holds: repositories, publishers
    status.rs             optional: `pub const TRANSITIONS: &[(&str, &[&str])] = &[("placed", &["confirmed"]), …]`
    README.md             the aggregate's page, or the doc comment above the root
  domain/*.rs             flat modules: each public struct with an inherent
                          public `&mut self` method is an aggregate root
  application/<aggregate>/usecases/<name>/
    mod.rs                `pub struct UseCase` with a `handle(&self, …)` method; its fields are the ports
    README.md             the operation's doc, or the doc comment above the struct
  application/policy/*.rs   one pub struct per policy, `handle(&self, event)` reacting to one event
  infrastructure/transport/grpc/<aggregate>/
    proto/**/*.proto      the contract this service publishes: the service and its rpcs
    *.rs                  `impl <Service> for <Handlers>`: a method per rpc, running use cases held as fields
  **/*.rs                 generated gRPC client fields and their method calls
  **/*.proto              contracts available anywhere in the Cargo workspace
  **/*.rs                 Temporal `register_workflow`, workflow macros, signals,
                          durable timers and scheduled activities
  infrastructure/repository/<aggregate>/
    *.rs                  `pub const TOPIC: &str` names the channel the aggregate's events leave on;
    migrations/*.sql      read by extract-sql, with `repositories` pointed at the directory above
```

## What becomes what

**Aggregate.** A directory under `src/domain/` may declare its root by name:
the pub struct whose name is the directory's in PascalCase (`order` →
`Order`). A flat `src/domain/*.rs` module instead declares roots semantically:
each public struct with an inherent public method taking `&mut self` is
stateful and becomes an aggregate, regardless of the file's name. Its fields
are the struct's fields with the type as written. In a directory aggregate,
other pub structs in the directory's top-level files are entities, structs
under `vo/` are value objects, and `rules/` is skipped. The readme is
`README.md` in the directory, or the doc comment above the root.

**Enum.** A pub enum in the directory's own files or under `vo/` whose every
variant is a bare name is a closed set of values, id
`<aggregate>.<slug>`. A variant carrying data makes the enum a sum type, which
is a shape rather than a set, and it is not read; `Error` is not read either,
being what a command refuses with. A value's name is the string literal an
inherent method answers for the variant - `as_str`, or any method whose body
is a `match self` with a literal per arm - and the variant's own name when
there is none; the doc is the variant's doc comment, and `#[deprecated]` on a
variant or the enum is carried.

**Event.** Each pub struct under `event/` whose name on the bus can be read -
a `name` method returning a string literal in any of its impl blocks,
inherent or of a trait, or a `NAME` constant - is an event of the aggregate,
its id `<service>.<aggregate>.<Struct>`. Fields as for a root; doc from the
doc comment; one version, `v1`; `consumers` empty, because a service does not
know who listens. The channel is the `TOPIC` constant of the aggregate's
repository module, the adapter that turns an event into a message.

**Operation.** Each `application/<aggregate>/usecases/<name>/mod.rs`
declaring a `pub struct UseCase` with a method `handle`. The id is the
directory's name in PascalCase (`place_order` → `PlaceOrder`). It is a command
when `handle` - or any other method of the struct - calls `save`, `delete`,
`create`, `update`, `publish`, `remove`, `insert` or `upsert` on a port, else a
query. The doc is the directory's `README.md` first paragraph, or the doc
comment above the struct. `exposedBy` names the rpcs that run it, read from
the handlers. `emits` lists the aggregate's events the use case can publish,
in the aggregate's order: a root method or a function of the aggregate's
module produces the events its return type names by position - `(Order,
OrderPlaced)` under a `Result` - and those it builds, `OrderPlaced { … }` or
`OrderPlaced::new(…)`, and, to a fixpoint, what the domain functions and
`self.` methods it calls produce; the use case emits what the root methods
(`order.cancel(…)`, `Order::place(…)`) and the domain functions it calls
through a `use` of the aggregate's module produce, and the events it builds
itself. Matched by name; an enum of events in a return type is not read,
only the variants a body builds.

**Port.** A field of `UseCase`, typed with a trait: `orders: Arc<dyn Orders>`,
`orders: O` under `O: Orders`, in the generics or a `where` clause. A field
typed with a function, `Box<dyn Fn() -> …>`, is a clock and no port. What the
trait is decides what a call on it becomes:

| the trait is | a call on it is |
| --- | --- |
| declared in `domain/<aggregate>/port.rs` | a `call` into the store lane, named by the method; an argument that holds an event is the event leaving for the bus |
| declared in a use case's `mod.rs` and implemented by an adapter under `infrastructure/` | an `rpc` to the peer, read through the adapter's method to the client's call |
| another use case's `UseCase` held outright, `place_order: Arc<PlaceOrder>` | a `call` to the service itself, and that use case's own steps, inlined two deep at most |

A trait implemented more than once - the adapter over a real peer, a stand-in
without - shows as the implementation that reaches a peer.

**Lifecycle.** An aggregate whose directory declares a `TRANSITIONS` table -
a slice of `(state, &[states it may become])` - gets a `lifecycle`: the states
in the table's order, the first being where a new root starts, and one move
per edge. The method of the root that assigns `self.status` is the mover;
every public method that calls it with a literal - a string, or a variant of
the status enum, `Status::Confirmed` read as `confirmed` - makes the edges
into that state, and `emits` is the event its return type names. A status
assigned anywhere else, a move into a state the table lacks, and an edge in
the table no method makes are each reported. A state nothing leads out of is
terminal; that is derived on the page, never written down.

**Flow, from an endpoint.** Each rpc of the proto under
`transport/grpc/<aggregate>/proto/` that a method of `impl <Service> for …`
answers - `GetOrder` and `get_order` are one name - opens a flow: `client →
service : rpc GetOrder`, then the steps of every use case the method runs
through `self.<field>.handle(…)`, in the order it runs them. Its `callback`
trigger keeps the gRPC method identity. **Flow, from a
policy.** Each pub struct under `application/policy/` with a `handle` opens a
flow on the bus: `bus → service : event <ref>`, where the event is the type of
`handle`'s event parameter and also names the flow's `event` trigger, or failing
that the name the body compares the
message's against - `message.name != "…"`, a `match` arm. A type from under
`src/domain` is the service's own; one from another module is another
service's, and a line in the `events` option mapping that module to an
aggregate id resolves it, without one the step names the type and is
unresolved.

**Inside a body.** Statements are read in source order. A call on a port is a
hop; a call on `self.<method>` is followed into the method; `if`, `if let` and
`match` become an `alt` when some arm holds a hop, an arm that ends in
`return`, an `Err(…)` or a `bail!` is terminal; `for`, `while` and `loop`
become a note on the steps inside; `?` and `.await` are transparent. Every
step is `declared`: this reads code, and code is a claim about behaviour, not
a record of it. A call whose peer the manifest does not name is `unresolved`.

**What a name holds.** A value is followed back to its type by name: what an
associated function on a domain struct, a method on a domain value or a port
method hands back, as its return type is written - `Result<(Order,
OrderPlaced), E>` binds both by position, through `Ok(…)`, `Some(…)` and a
tuple pattern. `for order in idle` holds one of what `idle` holds;
`events.push(x)` and `vec![x]` collect what `x` holds, and the list handed to
a port is each event collected, once. An event handed to a domain port -
`&placed`, `&[&placed]`, `&events` - is the event leaving for the bus; a field
read off one is not.

**gRPC peer.** An adapter holds tonic's generated client; a method call in the
adapter's body whose name is an rpc of that client's service is that rpc, in
the proto's own case: `self.inner.authorize(…)` is
`payments.v1.PaymentService/Authorize`. Contracts are indexed across the
nearest Cargo workspace, so sibling crates, root-level contract directories
and registry-generated clients can meet the same checked-in proto without a
copy beside the adapter. Direct fields, local type aliases and cloned local
bindings are followed. This service-level dependency is extracted even when
the application has no recognizable domain/use-case layout. A flow includes
the same call only when the reader can also prove the path from its endpoint.
The peer is the manifest's `peers` entry for the proto package; without one
the lane is `unknown` and the step unresolved, and the call is recorded on the
service's `consumes` with the matched proto as its source.

**Kafka through rdkafka.** Literal topic constants and string literals passed
to `Consumer::subscribe` become receive channels and one-step inbound flows.
Topics passed to `FutureRecord::to` become send channels and outbound flows.
The channel and handoff use protocol `kafka`, so Debezium and Rust facts with
the same address share the same broker participant in generated diagrams. The
client call proves the topic and direction, but not the message name; messages
remain empty until a contract extractor supplies their wire names.

**Temporal.** Every type passed to `register_workflow::<Type>()` becomes a
flow when the type also has `#[workflow]` and a `#[workflow_methods]` impl.
The registration proves the workflow is active; `#[run]` supplies its body,
`#[signal]` methods become inbound Temporal events, `context.timer(...)`
becomes a durable-timer step, `wait_condition(...)` becomes a durable wait,
and `execute_activity(Type::method, ...)` becomes a scheduled activity. A
phase match in the run method becomes alternative branches rather than a
misleading linear sequence. Local helper functions reached from `run` are
followed, and timers inside `select!` are detected from the macro body. When
an activity delegates through one of its fields to an extracted gRPC client,
the flow continues from the activity to that RPC peer. The result uses a
generated Temporal external participant and job handoffs; no workflow names,
paths or participants are configured manually.

## Options

```json
{
  "context": "shop",
  "contextName": "Shop",
  "service": "oms",
  "store": "pg",
  "peers": { "payments.v1": "payments.ledger" },
  "events": { "crate::infrastructure::cart": "shop.cart.basket" },
  "source": "src",
  "out": "domain.json"
}
```

`source` is the directory the layout starts in, `src` unless said otherwise.
`events` is keyed by the module path another service's events are decoded
in. Everything else means what it means for `extract-go`.

## Extraction limits

These cases do not become facts in the fragment:

- a domain directory with no root struct of its name;
- a use case directory with no `UseCase`, or a `UseCase` with no `handle`;
- a port whose trait is neither a domain port, a use case, nor implemented by
  an adapter, whose calls are therefore left out;
- an rpc in the proto with no method answering it;
- a policy whose `handle` tests for no event, or for one the repository does
  not declare and the manifest does not place;
- a generated client whose service cannot be matched uniquely to a proto in
  the Cargo workspace;
- an event no flow reaches;
- a proto package the manifest names no peer for.
- a Temporal workflow type that is declared but never registered by a worker.

## Manifest

```json
{
  "plugins": [{ "name": "rust-domain", "process": { "command": "cargo", "args": ["run", "--quiet", "--manifest-path", "plugins/extract-rust/Cargo.toml"] } }],
  "extract": [
    { "plugin": "rust-domain", "in": "examples/shop/oms", "out": "examples/shop/oms/portolan",
      "options": { "context": "shop", "service": "oms", "store": "pg",
                   "peers": { "payments.v1": "payments.ledger" },
                   "events": { "crate::infrastructure::cart": "shop.cart.basket" }, "out": "domain.json" } }
  ]
}
```

`cargo run` builds the plugin the first time and reuses the build after; the
target directory is not committed.

## Tests

The reader is held to a fixture under `testdata/oms`: a small service in the
layout above, each shape it claims to read present once, and a golden
fragment, `expected.json`. `cargo test --manifest-path
plugins/extract-rust/Cargo.toml` runs it, and CI runs it beside the Go and
TypeScript suites.
