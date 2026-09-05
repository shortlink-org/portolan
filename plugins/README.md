# Generators

A generator turns the catalog into something else — markdown here, and
whatever comes next in its own directory beside it.

The contract is one JSON message in and one JSON message out:

```
→ { "portolanVersion": "0.1.0", "catalog": { ... }, "options": { ... } }
← { "files": [{ "name": "shop/oms/README.md", "contents": "..." }] }
```

There is a second question, asked with `"kind": "describe"`, and the answer is
the plugin itself rather than its work:

```
→ { "portolanVersion": "0.1.0", "kind": "describe" }
← { "files": [],
    "describe": { "name": "extract-go", "summary": "...",
                  "phases": ["extract"],
                  "options": { "type": "object", "additionalProperties": false,
                               "properties": { "context": { ... } } } } }
```

The options a plugin takes are facts the source does not carry, so only the
plugin knows what it can be told. `npm run schema` asks all of them and composes
`schema/portolan.schema.json`, which an editor reads while the manifest is being
written and `gen` checks before it runs anything. `additionalProperties: false`
is what makes that worth having: `encoding/json` drops a field it does not
recognise, so before this a misspelled option was no option at all and nothing
said so.

A generator **names** files; it never writes them. `scripts/gen.mjs` writes what
comes back, refuses a name that points outside the output directory, and deletes
pages that stopped being generated. That is what lets a generator run as a wasm
module with no directory preopened at all — the sandbox is not a restriction
worked around, it is the reason the protocol has this shape.

Three obligations, and they are the whole of it:

1. **Valid output.** Every file a generator names is committed and read.
2. **Determinism.** The same catalog produces byte-identical output, so
   reviewing generated documentation is reviewing a diff. Sort anything that
   comes out of a map; never read a clock.
3. **One decisive response.** A malformed request, incompatible protocol,
   unsafe filename or invalid response fails the run. Non-fatal extraction
   notes go to stderr; there is no advisory response property a caller may
   accidentally ignore.

## Adding one

1. Write it. In Go, a new directory here with a `main` that hands its options
   type to `plugin.Serve`, which reads the request, answers a describe and calls
   the work; `catalog.Catalog` from `github.com/shortlink-org/portolan/catalog`
   is the mirror of the schema. In any other language, anything that speaks the
   protocol above.
2. Describe it. An `options.schema.json` beside the source, embedded with
   `go:embed` and returned in the descriptor. `schematest.Check` in a test keeps
   it from drifting from the options struct: a field renamed on one side and not
   the other fails, and so does an option with no description.
3. Build it. For a wasm plugin, `GOOS=wasip1 GOARCH=wasm go build`. Add the
   line to `plugins:build` in `package.json`.
4. Declare it in `portolan.json`, under `plugins` (how to run it) and
   `generate` (what to run it on), then run `npm run schema` so the manifest
   schema learns its options.

```json
{
  "plugins": [
    { "name": "markdown", "wasm": { "url": "file://plugins/gen-markdown.wasm" } }
  ],
  "generate": [
    { "plugin": "markdown", "out": "docs", "options": { "title": "Example estate" } }
  ]
}
```

## Lifecycles

An aggregate whose root has a status gets a `lifecycle` on the catalog: the
states, the first being where a new root starts, and one move per edge - the
method that makes it and the event it hands back. All three extractors read it
off a table the code keeps, never off the branches of the methods, because the
table is the claim and the methods are held to it: an edge in the table no
method makes, a move into a state the table lacks, and a status changed
outside the one way through the table are each reported.

In Go the table is a `go-sdk/fsm` rule set, `var Rules = fsm.TransitionRuleSet{
StateLive: {EventRevoke: StateRevoked}, …}`, with the states and events as
string constants; the method whose body calls `TriggerEvent` is the mover, and
every exported method that hands it a constant makes the edges that constant
names. The event type a method returns is what its last move publishes - a
method lapsing a lock and then locking again hands `AccountLocked` back for
the lock. In TypeScript it is `export const TRANSITIONS = { open: ["checked-out"],
… }` and the method that assigns `this.status`; see `extract-ts/README.md`. In
Rust it is `pub const TRANSITIONS: &[(&str, &[&str])] = &[("placed", &["confirmed"]),
…]` and the method that assigns `self.status`, handed a string or a variant of
the status enum; see `extract-rust/README.md`. In Python it is that mapping on
the Django model, beside the `TextChoices` that names the states, and the
method assigning `self.status` - or django-fsm's `@transition(field=status,
source=…, target=…)`, which is the same table written one edge at a time; see
`extract-django/README.md`. In Java it is `TRANSITIONS` beside the status enum
and the method assigning `this.status`; Java is also the one language here with
a vocabulary for the model, so the rest of `extract-java` reads what jMolecules
declares rather than what the layout implies.
Terminal states are derived on the page - nothing leads out - and never
written down. A move the clock makes, a session expiring, a lock running out,
is not a move: nothing runs when it happens, so it is not in the table.

## Flows written by hand

Some flows will always be written by people: the design doc for something not
built yet, the reconstruction after an incident, the path no test pins. The
catalog's JSON is the wrong place to write one - a tree of nodes, a unique id
per step, every lane declared twice - so `extract-flows` reads a text form
that reads like the sequence diagram it becomes: one file per flow, one line
per hop, frames closed by `end`. The demo estate's flows live in `data/flows`
and are read by the step declared for it in `portolan.json`.

```markdown
# Order accepted
owner: shop
source: services/oms/test/integration/order_accepted_test.go

The narrow slice one integration test pins end to end.

## Participants
- oms-db: store in shop "oms-db (postgres)"
- psp-gateway: external "psp-gateway (external)"

## Steps
shop.oms -> oms-db: insertOrderAndOutboxRow [verified] @internal/oms/adapter/postgres/order_repo.go:141 #a1
  > The order row and the outbox row commit in one transaction.
shop.oms -> bus: event shop.oms.order.OrderPlaced [verified]
shop.oms -> shop.pricing: rpc shop.v1.Pricing/GetQuote as "GetQuote (250 ms)"

alt score below 40 #alt-risk
  bus -> payments.ledger: event shop.oms.order.OrderPlaced
else score at or above 40
  shop.oms -> bus: event shop.oms.order.OrderCancelled
  stop
else
end

par OrderPlaced fan-out
  bus -> payments.ledger: event shop.oms.order.OrderPlaced
and
  bus -> delivery.core: event shop.oms.order.OrderPlaced
end

loop outbox relay, every 200 ms until the batch is empty
  shop.oms -> oms-db: SELECT ... FOR UPDATE SKIP LOCKED
end
```

The head is the name, `owner:` (the context the flow belongs to), an optional
`source:` (where it was read from; the file itself when left out) and an
optional `slug:` (the file's name when left out), then the summary. A hop is
`from -> to: [call|rpc|event] label-or-ref` - `call` when no kind is written -
followed in any order by `as "label"`, `[status]`, `@where` and `#id`. An
event names its ref, `shop.oms.order.OrderPlaced`; an rpc names its call id,
`shop.v1.Pricing/GetQuote`, or, for a call no interface declares - a webhook
arriving on a route - just a label. The label of an event or rpc is the last
segment of its ref unless `as` says otherwise; the status is `declared`
unless written; `@` is a file and line, or wherever the hop was seen. A note is
the `>` lines under the hop. Ids are numbered unless given, and giving them
is what keeps deep links to a step stable across edits.

`alt <when> … else <when> … end` is a choice; `else` alone is "otherwise", a
branch with nothing in it is allowed, and `stop` as the last line of a branch
says the flow ends there rather than rejoining. `par [title] … and … end`
runs its branches side by side; `loop <until> … end` repeats. Frames nest.

Services are known by their `context.service` id, `bus` and `client` by name;
any other lane is declared under Participants, in the order the lanes should
be drawn, as `- <id>: <kind> [in <context>] ["label"]`. Lines starting with
`//` are comments. A mistake fails the run with its file and line, the way a
compiler would: a flow silently left out is the kind of missing nobody
notices. A ref that resolves to nothing is caught later, by the validator,
because only the merged catalog can say.

## Decisions written by hand

Every decision worth keeping is already written down, in a file beside the code
it constrains, in the MADR shape a person reads. Typing it a second time into
the catalog's JSON - an id, a slug, a number, a scope and a body with every
newline escaped - makes the JSON the source and the markdown a copy, and the
copy is the one that goes stale: the three records that lived in
`data/catalog.json` before `extract-adr` existed all named files that were
never in the repository at all.

So the markdown is the source and the fragment is the output. `extract-adr`
reads `docs/adr/*.md` under a service's root - a `README.md` among them is the
directory's index, not a decision, and is skipped - and answers with one
fragment holding the records.

```markdown
# auth.0003 — Session expiry publishes no event

- **Status:** accepted
- **Date:** 2026-08-22
- **Scope:** auth.auth
- **Superseded by:** auth.0007
- **Supersedes:** auth.0001, auth.0002
- **Relates:** auth.auth.session.SessionEnded, shop.cart, checkout
- **Note:** how a revocation is kept out of the cache was decided again in
  auth.0010; the drop described below turned out not to be enough.

## Context and Problem Statement
…
## Decision Outcome
…
```

The title carries the record's id, an em dash, and the title. The id is a
prefix and four padded digits, and the prefix is whatever the record is about -
a service (`auth`, `cart`, `oms`), a context (`payments`) or the organisation
(`org`). The file is named `NNNN-kebab-slug.md` with the same number, because
the slug the catalog keeps is built from both: the id with its dots opened out,
then the file's kebab, as in `auth-0003-expiry-publishes-nothing`. A file
renamed away from its record would silently change the address of a decision
somebody linked to, so the two are held against each other.

`Status`, `Date` and `Scope` are required; the rest are written when there is
something to write, and a bullet the format does not have fails the run rather
than being dropped. A bullet may wrap onto the next line, indented under
itself - the break is the author's line width and closes up into a space.
`Scope` says what the record is about by how many segments it has: none, or
`org`, for the organisation, one for a context, two for `<context>.<service>`.
`Relates` names events, services and flows in one list and they are told apart
by their shape - a flow by its slug, which has no dots, a service by
`<context>.<service>`, an event by the aggregate and `Name` after that -
because an author should not have to remember which of three lists a name
belongs in. `Note` is prose no other field holds, most often that part of a
record was decided again somewhere else without the whole of it being
superseded; it sits in the page's header, above the frozen body.

Everything from the first `##` onward is the record. It goes into the catalog
exactly as written and comes back out onto the page the same way, headings and
all: an ADR is frozen history, and nothing on its page is redrawn from the
model as it stands now. Prose above that first `##` is a mistake - a paragraph
that drifted up there would be read by a person and dropped by the extractor.

`src/catalog.ts` fails the whole app on load if a record breaks any of its
rules, so the extractor breaks first, where the file that caused it can be
named: ids and slugs unique, an id ending in its own zero-padded number, a date
that parses, a status from the five, and both halves of a supersession. That
last one is the reason `Superseded by` and `Supersedes` are two bullets rather
than one derived from the other - supersession is a two-way fact, and half of
it recorded is a bug. The halves that live in one step's tree are held against
each other there; a record superseded by one in another service's tree is a
claim only the merged catalog can check, and the validator checks it. The same
goes for `Scope` and `Relates`: an extractor sees one root, so it validates the
shape of a name and leaves whether the thing exists to the far side.

The demo estate's org-wide and context-wide records live in `data/adr`, beside
the hand-written flows in `data/flows`, and are read by a step that points at
that directory with a glob of its own. Root `docs/` is where `gen-markdown`
writes, so nothing hand-written can live there. `in` is the directory of
records rather than `data` itself for the reason the flows step gives it the
same shape: a step's fragment is only left out of its own stamp when the output
is *inside* the input root, and `in: data` with `out: data` would be stamped
from the file it writes.

```json
{
  "plugins": [{ "name": "adr", "process": { "cmd": "go run ./plugins/extract-adr" } }],
  "extract": [
    {
      "plugin": "adr",
      "in": "data/adr",
      "out": "data",
      "options": { "files": ["*.md"], "out": "adr.json" }
    },
    {
      "plugin": "adr",
      "in": "examples/auth",
      "out": "examples/auth/portolan",
      "options": { "out": "adr.json" }
    }
  ]
}
```

## Vocabulary written by hand

A context's glossary is the one file in a service written for a person and read
by everyone: what a word means inside the boundary it is spoken in. Nothing
generates it and nothing should - a definition is a decision about language,
not a fact about a type - so `extract-glossary` only reads. It takes
`GLOSSARY.md` at a service's root and answers with a fragment of terms.

```markdown
# Glossary — auth

One meaning per word inside this context.

**Session.** Proof that a user logged in, how long that proof is good for, and
whether it has been taken away.
```

A title, an optional line or two saying what the vocabulary covers, then one
paragraph per term in alphabetical order. The paragraph opens with the term in
bold and the full stop inside the bold, so `**Email address.**` names a
two-word term and nothing has to guess where the name ends. Everything after it
is the definition, carried through as written. Hard wrapping is the author's
business: a soft break inside a paragraph is a space, here as in every markdown
renderer.

Nothing reads the definition for structure. A glossary is a person explaining a
word to another person, and a parser that went looking for shapes inside the
explanation would be a parser telling an estate how to phrase itself.

The shapes a glossary is otherwise written in are refused by name: a table, a
bullet list, a heading per term. Also refused: a file that does not open with
`# Glossary`, an entry that defines nothing, and one word defined twice -
inside a file or across the files of one step - because a word with two
meanings in one context is the failure the glossary exists to prevent.

What is merely untidy comes back as a warning and the fragment is still
written: a file that has drifted out of alphabetical order, a root with no
glossary at all.

The term's id is `<context>.<slug>` - `auth.session`, `shop.order` - so the
context has to be told to the step rather than derived from the directory: a
glossary sits beside a SERVICE, and `examples/shop/oms/GLOSSARY.md` holds
words that belong to `shop`. The same word in two contexts is two terms, which
is the point of the id; the same word twice in one context is an error.

```json
{
  "plugins": [{ "name": "glossary", "process": { "cmd": "go run ./plugins/extract-glossary" } }],
  "extract": [
    {
      "plugin": "glossary",
      "in": "examples/auth",
      "out": "examples/auth/portolan",
      "options": { "context": "auth", "out": "glossary.json" }
    }
  ]
}
```

## Verifiers: the third phase

An extractor reads source and runs before there is a catalog; a generator
reads the catalog and writes pages. A **verifier** sits between them. It reads
something observed - traces today, a test's record tomorrow - and answers with
a fragment like an extractor's, but one that only makes sense against the
merged catalog: "this hop was seen running" names a hop somebody else declared.
So a `verify` step is handed both `input` and `catalog`, and the catalog it is
handed leaves out the step's own last output. Without that, what it wrote last
time would count as evidence this time, and the fragment could never be checked
against a clean run.

```json
{
  "plugins": [{ "name": "otel", "process": { "command": "go", "args": ["run", "./plugins/verify-otel"] } }],
  "verify": [
    {
      "plugin": "otel",
      "in": "examples/auth",
      "out": "examples/auth/portolan",
      "options": { "traces": ["telemetry/traces.jsonl"], "out": "observed.json" }
    }
  ]
}
```

What comes back is merged like any other source, under two rules that exist
for it. A flow declared twice is accepted when the second declaration differs
only in status: `declared` steps become `verified`, and anything else that
differs - a lane, a hop, a branch - is the conflict it always was. A consumer
or a call declared twice keeps the first note and takes `verified` if either
side has it.

### verify-otel

Reads OTLP JSON - one batch per file or one per line, as a collector's file
exporter writes it - and turns each trace into hops between lanes:

| span | hop |
| --- | --- |
| kind server, `http.route` | `client → service`, an rpc; matched to the operation whose `http` verb and path the OpenAPI extractor recorded, which is what opens an endpoint flow |
| kind client, `rpc.service` + `rpc.method` | `service → provider`, an rpc; `unknown` lane and `unresolved` when nothing provides it, however often it ran |
| `db.system.name`, `db.operation.name` | `service → its store`, a call; the statement nested under a query is not a second call |
| kind producer, `event.name` | `service → bus`, the event whose name that is among the service's own; a producer span under another for the same name is the relay's and the same publish |
| kind consumer, `event.name` | `bus → service`, and a `verified` consumer on the event |

A trace whose root opens a declared flow raises the steps it shows: the call
in, the events out, the rpcs with a ref. A `call` step is never raised - a
`SELECT` ran, which is not the same claim as "the repository's `ByEmail` was
called" - and `unresolved` is never raised, because a trace does not put the
far end in the catalog. A consumer span inside a trace opens a flow of its own
and is matched the same way, so one password change verifies both the
request's flow and the policy's. A root no flow opens is written down as
`observed-<service>-<route>`, once per shape, with a summary saying how many
traces showed it.

`service.name` is matched to the one service whose slug it is, `event.name` to
the one event whose `wire.name` it is, or failing that to the one event of the
publisher's with that last segment; `services` and `events` in the options say
otherwise where an estate's names differ. A publish span whose
`messaging.destination.name` is not the event's `wire.channel` is a warning:
the event went out, but not where the code says it does.

## wasm or process

`wasm` is the default and should stay that way. The module gets no filesystem,
no network and no environment; a plugin from somebody else's repository can be
run over your source tree without reading it.

`process` is the escape hatch for a generator that needs a toolchain — one
reading Go source has to run `go list`, and no wasm module can spawn anything.
It gets the same protocol and none of the sandbox, which is the trade being made
and the reason it is not the default. It declares `command` and an `args` array;
the host never feeds a command string through a shell.

A plugin fetched over `https://` must declare its `sha256`; the host verifies it
and caches by digest. A `file://` plugin may declare one, but a checksum
protects a download, not a module built from the source next to it.
Downloads do not follow redirects and are bounded in time and size. Every run
has a deadline and bounded stdout/stderr; wasm runs in a worker so even a module
stuck in a loop can be terminated. Responses reject unknown properties,
duplicate or unsafe filenames, and non-string contents before anything is
written.

## Services in other repositories: fetch-git

`fetch-git` is `fetch-bsr` for a repository rather than a registry, and it
lives by the same four rules. A pin is a repository, a commit and the paths
actually read; the step fetches exactly those directories at exactly that
commit and hands them back as files, so the host writes them into the tree
beside a `git.lock.json` naming the commit and the digest of every file. The
paths inside the copy are the repository's own, which is the point: the
extract step that follows points its `in` at the vendored service and reads
it exactly as it would read that service's checkout.

```json
{
  "plugins": [{ "name": "git", "process": { "command": "go", "args": ["run", "./plugins/fetch-git"] } }],
  "extract": [
    {
      "plugin": "git",
      "in": "vendor",
      "out": "vendor/repos",
      "options": {
        "cache": "vendor/repos",
        "repos": [
          { "repo": "github.com/acme/shop", "commit": "c1d2e3f4…", "paths": ["services/oms", "proto"] }
        ]
      }
    },
    {
      "plugin": "go-domain",
      "in": "vendor/repos/acme/shop/services/oms",
      "out": "data/shop",
      "options": { "context": "shop", "service": "oms", "store": "pg" }
    }
  ]
}
```

It runs the `git` the host already needs for stamps: a fetch of the one
commit into a directory that exists for one call, and an archive of the paths
wanted, read straight into memory. Whatever git is configured to do about
credentials and hosts - a helper, a netrc entry, an ssh agent - it does here
too, and the plugin reads none of it. `PORTOLAN_OFFLINE` (or any truthy `CI`)
replays the committed copies against their locks; a commit the manifest does
not pin is resolved online with a warning and refused offline; a fetch that
fails falls back to the committed copy when there is one, and is a red build
when there is not; a vendored file edited by hand is reported by path.

## Schema modules: fetch and parse, kept apart

`fetch-bsr` and `extract-proto` are two plugins on purpose, and the split is
the whole design.

| | `fetch-bsr` | `extract-proto` |
| --- | --- | --- |
| job | registry wire → `.proto` bytes | `.proto` bytes → catalog fragment |
| network | yes | never |
| environment | reads `BUF_TOKEN` | never |
| output | `.proto` files and a `bsr.lock.json` per module | one catalog fragment |
| deterministic | only because it is pinned and cached | absolutely |

Extraction stays a pure function of the tree. Fetching is the step that can
fail, need a credential, or come back with something different than it did
yesterday, and confining that to its own step is what lets everything after it
be replayed byte-for-byte from a checkout.

**The fetched protos are the plugin's `Response.Files`, not a side effect.** The
host writes them like any other generated file, so they get a manifest entry,
are compared by `gen:check`, and are removed when the step stops naming them.
The cache is not a second copy of anything — it *is* the tree. Refreshing a pin
produces one pull request holding the pin bump, the proto diff, the lock diff
and the fragment diff, which is the review worth having.

Declare the fetch step **before** the extract step: steps run in list order, so
its protos and locks are on disk by the time the parser reads them.

```json
{
  "plugins": [
    { "name": "bsr",   "process": { "command": "go", "args": ["run", "./plugins/fetch-bsr"] } },
    { "name": "proto", "process": { "command": "go", "args": ["run", "./plugins/extract-proto"] } }
  ],
  "extract": [
    {
      "plugin": "bsr",
      "in": "examples/shop",
      "out": "examples/shop/vendor/proto",
      "options": {
        "cache": "examples/shop/vendor/proto",
        "modules": [
          { "module": "buf.build/acme/shop", "commit": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" }
        ]
      }
    },
    {
      "plugin": "proto",
      "in": "examples/shop",
      "out": "examples/shop/portolan",
      "options": {
        "context": "shop",
        "service": "oms",
        "paths": ["vendor/proto/acme/shop"],
        "vendored": ["internal/infrastructure/pricing"],
        "peers": { "pricing.v1": "shop.pricing" },
        "out": "proto.json"
      }
    }
  ]
}
```

`cache` repeats the step's `out` because a plugin is never told where its output
goes. That is the shape of the protocol — a plugin returns files and the host
decides what to do with them — and not an oversight to work around.

### Why fetch-bsr can never be wasm

It needs a socket and a credential. `process` exists for exactly that trade, and
`auth.go` is the only file in either plugin that reads the environment. The
protocol's "no ambient state" rule is about *facts*: nothing about the estate may
come from anywhere but the request. A credential is not a fact about the estate —
it decides whether the fetch succeeds, never what the fetch says — and a test
asserts the output is byte-identical with and without a token.

### Pinning, and the offline rule

Pin every module to a commit. A BSR commit is immutable, so a pinned download is
byte-reproducible, which is the only reason replaying from disk is equivalent to
fetching again. An unpinned module is resolved and warned about when online, and
refused when offline — there is nothing to replay against.

`PORTOLAN_OFFLINE=1` (or any truthy `CI`) turns the fetch off. The step then
re-emits the committed copies, checked against their locks. Set it in CI; the
workflow already does.

Four rules govern what happens when a fetch does not:

1. Fetch succeeded → the fetched files and a regenerated lock.
2. Skipped or failed, cache complete and matching its digests → the cached files
   byte-identically, plus a warning. Output unchanged, so `--check` stays clean.
3. Failed **and** no usable cache → a non-zero exit, never a short file list. The
   host deletes files a step stops naming, and dropping a repository's vendored
   protos because a laptop went offline is worse than a red build.
4. A cached file whose digest no longer matches is reported by path — someone
   edited a vendored copy, which is the drift `docs/adr/org.0001.md` wants seen.

### Why the proto parser is hand-written

`docs/adr/org.0001.md` has consumers keeping *narrowed* vendored copies, and a
narrowed copy routinely imports a file nobody vendored beside it. A compiler —
`protocompile`, `protoc` — refuses to produce anything for that input. The whole
point of reading vendored copies is to describe files that do not build
standalone, so the parser is tolerant: every construct it declines to model
(`extend`, a proto2 `group`, an aggregate option body) is named in a diagnostic
rather than dropped, and only a file that cannot be tokenised is fatal.

It also keeps types **as written** — `[]LineItem`, `map[string]Money`, the
`optional` keyword, the author's declaration order — the same stance the catalog
already takes for schemas, and one a descriptor has already thrown away.

### What extract-proto will not claim

`status` is only ever `declared` or `unresolved`, **never `verified`**. Reading a
`.proto` proves a call was written down. `verified` in the shipped catalog means
a test exercises it end to end, which is a property of the merged catalog — and
every extractor runs before one exists.

A message named `OrderPlaced` in an `events.proto` stays an `RpcMessage` and does
not become a catalog `Event`. `Event.id` is `<service>.<aggregate>.<Name>` and
this extractor knows the package, not the aggregate; a guess would collide with
the event `extract-go` already emits, or invent a ghost aggregate that would sit
beside the real one forever.

## Schema registry subjects: the same split, one topic further

`fetch-csr` and `extract-csr` are the Confluent Schema Registry half of the same
argument, and they are shaped like `fetch-bsr` and `extract-proto` on purpose:
one owns the socket and the credential, the other owns the reading, and CI runs
the reading over a tree it can verify without a registry existing at all.

| | `fetch-csr` | `extract-csr` |
| --- | --- | --- |
| job | registry wire → schema files | schema files → catalog fragment |
| network | yes | never |
| environment | reads `CSR_API_KEY`/`CSR_API_SECRET`, or `CSR_TOKEN` | never |
| output | one schema and a `csr.lock.json` per subject | one catalog fragment |
| deterministic | only because it is pinned and cached | absolutely |

A registered version is immutable: subject `orders-value` at version 3 is the
same bytes today and next year, and re-registering a changed schema makes
version 4. That is the promise a BSR commit makes, so the same four rules govern
a fetch that does not happen, and `PORTOLAN_OFFLINE=1` replays the committed
copies against their locks exactly as it does there.

A subject a fetched schema **references** is fetched too, pinned by the
reference rather than by the manifest, and needs no entry of its own — the
version is part of the bytes we already have, so following one adds no lottery.
Each lands in its own directory, and the referring subject's lock is what an
offline run follows to find them.

Avro and JSON schemas arrive minified onto one line. They are written out
indented — with `json.Indent`, which reformats without reordering, so the file
still says what the registry said in the order it said it — because a version
bump that is one unreadable line is a review nobody can do. The digest is over
the bytes as written, so verifying needs no reformatting of anything.

### The strategy the registry does not record

A subject name is whatever the producer's serializer decided to call the
registration, and the rule it used — the `SubjectNameStrategy` — is nowhere in
the registry's answer. `shop.oms.order-value` is a topic plus a suffix under
`TopicNameStrategy` and a record's full name under `RecordNameStrategy`, and
nothing but the manifest can say which. So `strategy` is an option, and
everything `extract-csr` does with a name follows from being told it.

Under `topic-record` the separator is a hyphen and both halves may contain one,
so the split is made by matching the **schema's own full name** as the suffix
rather than by searching for a delimiter.

A `-key` subject is kept as a shape and put on no channel: a key is part of
every message on the topic, not a message on it. Under `record` there is no
topic at all, and a fragment with no channels is the right answer rather than a
gap — that strategy exists so a record can be reused across many.

### What extract-csr will not claim

**It emits no events.** An `Event` in the catalog belongs to an aggregate, and a
registry holds schemas, not domains — it has no idea which aggregate raises
what. So the shapes land in `defs`, where a shared shape belongs, and the topics
land in the service's channels beside the ones an AsyncAPI document declares.
The domain extractor says an aggregate raises `OrderPlaced` and calls it
`shop.oms.OrderPlaced` on the wire; this says a schema by that name is
registered against topic `shop.oms.order` and has these fields. Neither knows
the other exists, and the pages hold the two against each other.

**It does not say who produces.** A registry records no producer and no
consumer. `direction` is told, per step and per subject, or it would be invented.

**It does not parse protobuf.** That is `extract-proto`'s whole job, and a
second, worse parser here would be a second answer to one question. A `PROTOBUF`
subject still names its topic — which is the one thing a `.proto` file cannot
say — and a diagnostic points at `extract-proto` for the fields.

A field referencing a shape nothing in the estate vendored keeps its **name**
and loses its **ref**. The catalog validates that every ref resolves, and
failing a run over a reference that is genuinely true — the shape really does
live in another estate — would be the wrong end of the trade.

## The bus: a channel is a claim, not an event

`extract-asyncapi` reads an AsyncAPI document and answers with the channels a
service declares — the address the broker knows, and each message on it with the
direction it travels. What it does **not** answer with is events.

That looks like a gap and is a boundary. `Event.id` is
`<service>.<aggregate>.<Name>`, and an AsyncAPI document knows the message on the
wire, not the aggregate that raised it. An extractor that guessed would either
collide with the event `extract-go` and `extract-ts` already emit or invent a
ghost aggregate that would sit beside the real one forever — the same rule
`extract-proto` keeps about a message called `OrderPlaced`.

So the two sources meet in the merge instead, and the pages hold them against
each other. The domain says an aggregate raises `BasketCreated` and how it leaves,
in `wire`; the document says the service sends `cart.BasketCreated` on
`shop.cart.basket`. Where they agree the catalog says the same thing twice, which
is worth nothing. Where they disagree it is worth a row on the Problems page,
because one of the two is stale:

- an event whose channel the document does not declare — a subscriber reading
  the document does not know the message exists;
- a channel the document declares and no event names — a promise nothing keeps;
- a message the document listens for that nothing in the estate publishes.

That last one is the only edge in the catalog that runs from the subscriber
outwards. Everywhere else a publisher names its consumers; here the subscriber
names a message and the estate is searched for whoever puts it on the wire. A
subscription that resolves is how two repositories that never mention each other
are found to be joined — and a channel that two services both declare a send on
is a second publisher, which is an error for the reason a second writer in a
database is.

### 2.x says publish and subscribe backwards

In AsyncAPI 3.x an operation carries `action: send` or `action: receive`, from
the application's side, and there is nothing to get wrong. In 2.x a channel has
`publish` and `subscribe`, and both are written from the **client's** side:
`publish` is what somebody else publishes *to* the application, so the
application receives it, and `subscribe` is what the application produces for
somebody else to subscribe to.

Reading 2.x the obvious way puts every arrow in the estate the wrong way round.
The extractor reads both versions and answers in 3.x's vocabulary, which is the
one the catalog keeps.
