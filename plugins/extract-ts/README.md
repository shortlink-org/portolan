# extract-ts

A TypeScript service in, a catalog fragment out. The TypeScript twin of
`extract-go`: it describes one service - its aggregates, what they publish,
what runs when somebody calls in, what the service calls - by reading the
tree, and it reads the tree by its layout. Nothing is annotated for the
catalog; the layout is the claim.

Written in TypeScript and run as a process plugin, `node plugins/extract-ts/main.ts`,
because the right parser for TypeScript is the TypeScript compiler, and the
catalog's own types in `src/catalog.ts` are the fragment's types. The parser
is TypeScript 5's, installed as `ts-api` beside the project's TypeScript 7,
which is a native compiler with no syntax tree to offer; there is no type
checker, everything is resolved by name and by relative import, which is all
a layout that is the claim needs. It is the only plugin so far that is not Go,
which is the point of it having the same protocol.

## The layout it reads

```
src/
  domain/<aggregate>/
    <aggregate>.ts        the root: a class named like the directory, in PascalCase
    *.ts                  entities: other classes exported from the directory's own files
    vo/*.ts               value objects: one class per file
    rules/*.ts            specifications; skipped, they are not shapes
    events/*.ts           one class per event, `readonly name = "<service>.<Name>"`
    port.ts               interfaces a use case holds: repositories, publishers
    status.ts             optional: `export const TRANSITIONS = { open: ["checked-out"], … }`, the root's lifecycle
    README.md             the aggregate's page, or the doc comment above the root class
  application/<aggregate>/usecases/<name>/
    usecase.ts            `export class UseCase` with a `handle(...)` method
    README.md             the operation's doc, or the doc comment above the class
  application/policy/*.ts   one class per policy, `handle(event)` reacting to one event
  infrastructure/transport/http/
    gen/openapi.yaml      the document; operationIds name the handlers
    <pkg>/*.ts            handlers: `async <operationId>(...)` methods on a class holding use cases
  infrastructure/<peer>/
    gen/openapi.yaml + gen/types.ts     an HTTP peer: the vendored document and `openapi-typescript` output
    proto/**/*.proto + gen/*_pb.ts       a gRPC peer: the vendored contract and Connect-ES output
    client.ts             the adapter over the generated client, implementing a use case's port
  infrastructure/repository/<aggregate>/
    migrations/*.sql      read by extract-sql, with `repositories` pointed at the directory above
  di/**/*.ts              which adapter or use case fills a port: `export function provideX(deps): Port`,
                          or an Inversify container's `bind<Port>(TOKENS.X).to(Impl)` or
                          `.toConstantValue(new Impl(...))`; a port bound more than once - the adapter
                          behind a setting, a stand-in without - shows as the binding that reaches a
                          peer; a use case's constructor may carry `@inject(TOKENS.X)`, the type
                          beside it is still the port
```

## What becomes what

**Aggregate.** Every directory under `src/domain/` whose name has a root class
in it. The root is the class whose name is the directory's in PascalCase
(`basket` → `Basket`); a directory without one is reported and skipped. Its
fields are the class's property declarations and constructor parameter
properties, `readonly id: string` and `constructor(readonly id: string)` alike,
with the type as written. Other classes exported from the directory's top-level
files are entities; classes in `vo/` are value objects; `rules/` is skipped.
The readme is `README.md` in the directory, or the JSDoc above the root.

**Event.** Each class in `events/` with a `name` property initialised to a
string literal - `readonly name = "cart.BasketCheckedOut"` or `static readonly
name` - is an event of the aggregate, its id `<service>.<aggregate>.<Class>`.
Fields as for a root; doc from JSDoc; one version, `v1`; `consumers` empty,
because a service does not know who listens - the merge is where the other end
arrives, and the flows imply the rest.

**Operation.** Each `application/<aggregate>/usecases/<name>/usecase.ts`
exporting a class `UseCase` with a method `handle`. The id is the directory's
name in PascalCase (`add_item` → `AddItem`). It is a command when `handle` -
or a private method it calls - calls `save`, `delete`, `create`, `update` or
`publish` on a port, else a query. The doc is the directory's `README.md`
first paragraph, or the JSDoc above the class. `exposedBy` names the HTTP
operations that run it, read from the handlers.

**Port.** A constructor parameter of `UseCase` typed with an interface or a
class. What it is decides what a call on it becomes:

| the type is | a call on it is |
| --- | --- |
| an interface from `domain/<aggregate>/port.ts` | a `call` into the store lane, named by the method; an argument that holds an event is the event leaving for the bus |
| another `UseCase` | a `call` to the service itself, and that use case's own steps, inlined two deep at most |
| an interface bound in `di/` to a use case | the same |
| an interface bound in `di/` to an adapter over a generated client | an `rpc` to the peer, read through the adapter's method to the client's call |
| an interface another use case declares, imported from its `usecase.ts` | whatever that use case's binding says: the port is looked up under the use case that declares it |
| the generated client itself | an `rpc` to the peer |
| a function type, `() => Date` | nothing: a clock is a port with nobody at the other end |

**Lifecycle.** An aggregate whose directory exports a `TRANSITIONS` table -
an object literal, each state to the states it may become - gets a
`lifecycle`: the states in the table's order, the first being where a new
root starts, and one move per edge. The method of the root that assigns
`this.status` is the mover; every public method that calls it with a literal
(`this.moveTo("checked-out", now)`) makes the edges into that state, and
`emits` is the event its return type names. A status assigned anywhere else,
a move into a state the table lacks, and an edge in the table no method makes
are each reported. A state nothing leads out of is terminal; that is derived
on the page, never written down.

**Flow, from an endpoint.** Each handler method named by an `operationId` in
`transport/http/gen/openapi.yaml` opens a flow: `client → service : rpc
<operationId>`, then the steps of every use case the handler runs, in the order
it runs them. **Flow, from a policy.** Each class in `application/policy/` with
a `handle` opens a flow on the bus: `bus → service : event <ref>`, where the
event is what the body tests for - `event instanceof BasketCheckedOut`, `event
.name === "cart.BasketCheckedOut"`, or a `switch` on `event.name`. An event
imported from outside `src/domain` is another service's; with a line in the
`events` option mapping the import to an aggregate id it resolves, without one
the step names the type and is unresolved.

**Inside a body.** Statements are read in source order. A call on a port is a
hop; a call on `this.<method>` is followed into the method; `if` and `switch`
become an `alt` when some arm holds a hop, an arm that `return`s or `throw`s
is terminal; `for`, `for … of`, `while` become a note on the steps inside;
`await` is transparent; a `.then(...)` chain is followed as a call. Every step
is `declared`: this reads code, and code is a claim about behaviour, not a
record of it. A call whose peer the manifest does not name is `unresolved`.

**What a name holds.** A value is followed back to its type by name, without a
checker: what a domain constructor, a domain method or a port method hands
back, as its return type is written - `Promise<[Basket, BasketCreated]>` binds
both by position - and what a helper function anywhere under `src/` returns
when its return type names something of an aggregate (`holderOf(repo, id,
token): Promise<Basket>`). `for (const basket of idle)` holds one of what
`idle` holds; `into = created` holds what `created` held; `events.push(x)`
collects what `x` holds, and `...events` handed to a port is each event
collected, once. An event handed to a domain port is the event leaving for the
bus; a field read off one is not.

**HTTP peer.** A generated `openapi-fetch` client is called with the verb and
the path in the code - `client.GET("/v1/sessions/current", …)` - and the
document vendored beside `gen/types.ts` says which operation answers on that
route and which interface it belongs to, spelled by `plugins/openapi` so the
call and the method on the other side share one id: `auth.v1.Sessions/validateSession`.
**gRPC peer.** A Connect-ES client is created from a service descriptor whose
`typeName` is the proto service, `shop.v1.Pricing`, and a call on it is the
method in the descriptor's own case: `client.getQuote(…)` is
`shop.v1.Pricing/GetQuote`. The descriptor is imported from under `gen/`,
however deep its package path put it, and the service is looked up in the
`.proto` files vendored under `proto/` beside that `gen/`. Either way the peer is the manifest's `peers`
entry for the api id or the proto package; without one the lane is `unknown`
and the step unresolved, and the call is recorded on the service's `consumes`
with the vendored document as its source.

## Options

```json
{
  "context": "shop",
  "contextName": "Shop",
  "service": "cart",
  "store": "pg",
  "peers": { "auth.v1": "auth.auth", "shop.v1": "shop.pricing" },
  "events": { "@acme/payments-events": "payments.ledger.payment" },
  "source": "src",
  "out": "domain.json"
}
```

`source` is the directory the layout starts in, `src` unless said otherwise.
Everything else means what it means for `extract-go`.

## Diagnostics

Reported beside the fragment, never papered over inside it:

- a domain directory with no root class of its name;
- a use case directory with no `UseCase`, or a `UseCase` with no `handle`;
- a port whose type is neither a domain port, a use case, nor a client, whose
  calls are therefore left out;
- a handler named by no `operationId`, and an `operationId` with no handler;
- a policy whose `handle` tests for no event;
- a peer package with no document beside it, or a route the document does not
  declare;
- an event no flow reaches;
- a proto package or api id the manifest names no peer for.

## Manifest

```json
{
  "plugins": [{ "name": "ts-domain", "process": { "cmd": "node plugins/extract-ts/main.ts" } }],
  "extract": [
    { "plugin": "ts-domain", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart", "store": "pg",
                   "peers": { "auth.v1": "auth.auth", "shop.v1": "shop.pricing" }, "out": "domain.json" } },
    { "plugin": "openapi", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart",
                   "spec": "src/infrastructure/transport/http/gen/openapi.yaml", "out": "api.json" } },
    { "plugin": "sql", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart", "store": "pg", "name": "Cart database",
                   "repositories": "src/infrastructure/repository", "out": "stores.json" } }
  ],
  "verify": [
    { "plugin": "otel", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "traces": ["telemetry/traces.jsonl"], "out": "observed.json" } }
  ]
}
```

`extract-sql`'s `repositories` points it at the adapters: its default is the
Go layout, `internal/infrastructure/repository`, and a TypeScript service
keeps the same shape one directory over, `<aggregate>/migrations` under it.

## Tests

The reader is held to fixtures under `testdata/`: a small service in the
layout above, each shape it claims to read present once, and a golden
fragment. `examples/shop/cart/portolan/domain.json` is the second golden, held
by `gen:check` like every other fragment.
