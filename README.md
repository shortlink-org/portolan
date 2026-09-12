<p align="center">
  <img src="./public/readme-header.webp" alt="A software architecture landscape mapped by Portolan" width="100%" />
</p>

<h1 align="center">Portolan</h1>

<p align="center"><strong>Your architecture, read from the code.</strong></p>

<p align="center">
  Turn code, contracts, schemas, traces and ADRs into a validated, navigable map of your software estate.
</p>

<p align="center">
  <a href="https://shortlink-org.github.io/portolan/landing">View the product tour</a>
  ·
  <a href="https://shortlink-org.github.io/portolan/?catalog=example">Explore the example catalog</a>
</p>

## Make architecture visible — and keep it honest

Architecture documentation loses value when it becomes another system teams
must remember to maintain. Portolan starts with the evidence your repositories
already contain and turns it into one coherent, searchable view of the system.

See how bounded contexts, services, APIs, events, data stores, flows and
decisions fit together. Follow any relationship back to its source. Surface
missing contracts, ownership conflicts and architectural drift before they
become production surprises.

- **Understand the whole estate.** Move from the landscape to a single flow,
  service, schema or decision without losing context.
- **Trust what you see.** Portolan merges and validates facts from code,
  specifications and observed traces instead of relying on a second hand-built
  inventory.
- **Publish anywhere.** The catalog and site are static end to end, require no
  hosted backend and fit naturally into pull requests and CI.

DDD enriches the model when a repository uses it; it is never a prerequisite.
Optional branch comparison and source previews read immutable files from GitHub
or GitLab at runtime, while local development uses a localhost-only control
plane.

## What it does

```mermaid
flowchart TB
  code["Go · TypeScript · Rust<br/>Java · Django"]
  specs["OpenAPI · AsyncAPI · GraphQL<br/>proto · SQL"]
  traces["OTel traces"]
  frag["catalog fragments<br/>beside each service<br/>*/portolan/*.json"]
  merged["merge + validate"]
  site["the site<br/>React SPA"]
  docs["docs/<br/>markdown, llms.txt"]
  exports["exports/<br/>Backstage + Mermaid"]
  c4["likec4/<br/>C4 + one view per flow"]

  code -- extract --> frag
  specs -- extract --> frag
  traces -- verify --> frag
  frag --> merged
  merged --> site
  merged -- generate --> docs
  merged -- generate --> exports
  merged -- likec4:gen --> c4 --> site
```

There is no master catalog file. Every fragment the manifest's `sources` globs
find — what each service publishes beside its own code, plus the estate's
hand-written facts in `data/` (shared types, ADRs, `.flow.md` walkthroughs) —
is merged, then validated as one estate: referential integrity is a property of
the union, so a fragment naming a peer it does not own is normal. Validation
happens at startup; if it fails the shell renders the error instead of a blank
page.

Facts carry a status: `declared` (a fragment says so), `verified` (a recorded
trace showed it happening), `unresolved` (nothing in the catalog answers the
reference).

## What the site shows

- **Entity pages** — context, service, aggregate (entities, value objects,
  lifecycle, events, commands, queries), event, store, schema module, ADR.
- **Flows** — step-by-step walkthroughs with a step rail, cross-protocol chains
  that continue across contexts, and per-step detail. Source locations open an
  inline code window around the exact line; private forge tokens stay in tab
  memory, and the external GitHub/GitLab link remains available.
- **Diagrams** — LikeC4 C4 views (estate landscape, every container in the
  estate with its technology and the protocol on each edge, one per context,
  two per service, one dynamic view per flow), an ELK-routed dependency graph,
  and a context map. The app never draws these itself; `npm run gen` writes
  the model from the catalog as its last step, and holds it to the catalog in
  `gen:check`, and `npm run likec4:gen` writes it on its own before `dev`.
- **ER canvases** — per store: tables, views, keys and crow's feet, plus column
  lineage (`from`) drawn dashed; hovering a column lights the whole chain back
  to where the value came from.
- **API specs** — OpenAPI via Scalar, AsyncAPI via its React component, a
  GraphQL schema as the SDL it was written as.
- **Navigation** — ⌘K palette over everything the catalog names (`e:` events,
  `vo:` value objects, …), sidebar tree, breadcrumbs, "what links here", a
  trail of recent pages, pins, keyboard shortcuts, light/dark and density.
- **Ask the catalog** — a chat that answers from the generated pages: the
  model gets `llms.txt` and opens pages one at a time, names things by their
  ids (which become links), and can end an answer with a card drawn from the
  catalog — a service, a flow's sequence diagram, what runs between two
  contexts, an aggregate's state machine. The demo answers through the worker
  in `proxy/`; a reader can bring their own OpenAI-compatible endpoint and key
  from the panel's settings, kept in their browser.

## What it checks

The **Problems** page lists every edge that leaves the chart, grouped errors
first:

- calls and consumers no service in the catalog answers, and RPC methods a
  known provider does not have;
- a foreign key or a column's lineage crossing a service boundary, a database
  with a second writer, a table that no longer holds the aggregate it claims,
  a column whose type has drifted from its field's, an outbox with no payload;
- a channel with a second publisher, an event on a channel its service does not
  declare, a declared channel no event names, a subscription nothing publishes;
- what the deployer runs from a place no service lives at, and where the GitOps
  tree and the deployer disagree.

Each check is a rule with a passport in `rules/builtin.json` - id, subject,
severity, what it looks for and what to do about a row - and **Settings →
Rules** lists them with the rows each produces now. A rule can be switched off
or re-graded in `portolan.json`, with a reason, and a rule of your own is
written there in CEL over one subject - a service, an event, a channel, a
table, a deployment, a flow, an aggregate or a call - and runs in the page the moment it is saved:

```json
{
  "problemRules": [
    { "id": "shared-store", "enabled": false, "reason": "the estate shares one database by design" },
    {
      "id": "team.quiet-event",
      "over": "event",
      "severity": "warning",
      "title": "Event nobody consumes",
      "when": "size(event.consumers) == 0 && !event.name.endsWith('Audit')",
      "message": "'nothing consumes ' + event.id",
      "peer": "event.service"
    }
  ]
}
```

Expressions are type-checked against the subject's fields when the manifest is
read - `event.nme` is refused, not shown as an empty page - and again in the
page, by the same module. The Rules page writes the entry after a preview of
the rows it would add (portolan.0016).

## Where the facts come from

Plugins, one JSON message in and one out (`plugins/README.md`), declared in
`portolan.json` and run in three phases:

| phase | plugins |
| --- | --- |
| extract | `extract-project`, `extract-go`, `extract-ts`, `extract-rust`, `extract-java`, `extract-django`, `extract-laravel`, `extract-php-ddd`, `extract-csharp-ddd`, `extract-celery`, `extract-python-kafka`, `extract-openapi`, `extract-wsdl`, `extract-http-clients`, `extract-redis`, `extract-asyncapi`, `extract-graphql`, `extract-proto`, `extract-river`, `extract-watermill`, `extract-go-nats`, `extract-go-sqs`, `extract-csr`, `extract-sql`, `extract-flows`, `extract-adr`, `extract-glossary`, `extract-commands`, `extract-k8s`, `extract-argocd` |
| verify | `verify-otel` — reads traces, marks the hops they show as `verified`; `verify-codeowners` — reads CODEOWNERS, says who to ask about each service |
| generate | `gen-markdown` — `docs/`, `gen-mermaid` — standalone flow diagrams, `gen-backstage` — Backstage entities |

`fetch-git`, `fetch-bsr` and `fetch-csr` bring in sources from other
repositories, the Buf Schema Registry and a Confluent Schema Registry, against a
lock, so a later build can reproduce them without a socket. `fetch-k8s` reads a
live cluster through `kubectl` into the names each service answers on and
dials, and replays the committed fragment when there is no cluster to ask.
`fetch-argocd` reads the applications an Argo CD server manages into a snapshot
of where each service runs - environment, cluster, namespace, revision, images -
against the same kind of lock; the service page shows it under "Where it runs".

Each plugin describes its own options; `npm run schema` asks all of them and
composes `schema/portolan.schema.json`, which editors complete against and `gen`
checks before running anything. The same answers are rendered as the site's
plugin reference - `/plugins` on any generated site, grouped by what each reads
or makes, with the options it takes - so the list above is the short form.

Non-fatal extractor diagnostics remain attached to their pipeline step. The
Settings page groups repetitions by plugin, stable rule and severity, and shows
the recommended next action. A reviewed limitation can be hidden from the
active view without discarding it:

```json
{
  "warningPolicies": [
    {
      "when": "plugin == 'openapi' && rule == 'openapi.missing-operation-id' && project == 'aviacore'",
      "action": "suppress",
      "reason": "The partner-owned contract cannot be changed in this repository."
    }
  ]
}
```

The rule id is shown beside the warning. CEL expressions can read `plugin`,
`rule`, `severity`, `project`, `phase`, `ref`, `message`, and the integer
`count` for that rule in the step. Expressions are type-checked when the
manifest is read, must return `bool`, and run during generation. A suppression
requires a reason and remains available through the `suppressed` filter.

## Use it in your project

Run the setup once from the root of a repository:

```bash
npx @shortlink-org/portolan init
npm install --save-dev @shortlink-org/portolan
npx portolan generate
npx portolan dev
```

`init` looks at the repository the way the site's Settings page does when a
project is added: it finds the directories that hold a build file, the domain
layouts, API specifications, schemas, migrations, ADRs and glossaries it can
read, and proposes a `portolan.json` with an extractor for each. In a terminal
it asks which directories are projects, what to read in each, and whether to
run `portolan generate` straight away; every question has the detected answer
as its default. With `--yes`, or without a terminal, it takes those defaults
and asks nothing. A plugin whose toolchain is not on `PATH` is pointed out
before anything is written.

`init` never overwrites an existing `portolan.json`. It adds `.portolan/` to
`.gitignore` and, when the repository has a `package.json`, adds these scripts
without replacing scripts that are already there:

```json
{
  "scripts": {
    "architecture": "portolan dev",
    "architecture:gen": "portolan generate",
    "architecture:check": "portolan check",
    "architecture:build": "portolan build"
  }
}
```

The generated fragments, Markdown, and exports are ordinary reviewable files
and should be committed. `.portolan/` is local build state and `dist/` is the
deployable static site.

| command | purpose |
| --- | --- |
| `portolan init` | inspect the repository and write the first manifest; `--yes` takes every detected default |
| `portolan dev` | run the local site and setup UI |
| `portolan generate` | update fragments, documentation, and exports |
| `portolan check` | fail when committed generated files are stale, without writing them |
| `portolan build` | build the static site into `dist/` |
| `portolan diff BASE` | describe the architecture change from a branch, tag, or commit |
| `portolan doctor` | show which toolchains the manifest's plugins need and which are on `PATH` |

Node.js 24 is required, and for a repository the built-in extractors can
read on their own it is the only requirement: every Go plugin runs as one
wasm module over the workspace (`adr/0006`), the fetchers run inside the
host (`adr/0008`), and the package ships no Go at all. A Go, TypeScript,
OpenAPI, proto, SQL or GraphQL tree is read, and another repository or a
schema registry is vendored, with Node and git alone. An extractor that runs
in its own runtime still needs it: Python 3 for Django and Celery, Java 21
for Java, Cargo for Rust. `portolan doctor` reports what the manifest asks
for against what is on `PATH`. The Docker image contains all of them.

### Add delivery automation

While `portolan dev` is running, open **Settings → Delivery presets**. Portolan
detects GitHub or GitLab from the repository's `origin`, previews the exact CI
changes, and generates only the jobs selected there. Architecture checks and
static catalog publishing are selected by default; pull-request architecture
diffs and GitHub SARIF annotations are opt-in. Check, review, and publication
live in separate GitHub workflows, while SARIF augments the review workflow, so
comment and code-scanning permissions are granted only when those capabilities
are enabled. Existing unmanaged workflow files are never overwritten, and
disabling a capability removes only files managed by Portolan.

### Run without installing Node or language toolchains

The same CLI is published at `ghcr.io/shortlink-org/portolan`. On Linux, pass
the host uid and gid so generated files remain owned by the developer:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD:/workspace" \
  -w /workspace \
  ghcr.io/shortlink-org/portolan:0.2.0 generate
```

Use immutable versions in CI. `latest` is intended for trying the CLI, not for
a reproducible build.

### One repository or an estate repository

For one application or a monorepo, keep `portolan.json` at its root and write
fragments beside each component. An organization-wide catalog can instead
live in a dedicated architecture repository: `fetch-git` pins the service
repositories at immutable commits and the normal merge, check, diff, and build
commands operate on the combined estate.

### A real one: Bagisto

The services under `examples/` are small on purpose. For what the catalog
looks like on a real application, the site ships a third profile: pick
**Bagisto** in the catalog selector. [Bagisto](https://github.com/bagisto/bagisto)
is an open-source e-commerce platform on Laravel - 41 packages, one per
module, talking to each other through named events - read by
`extract-laravel` alone, with nothing annotated for the catalog.

What comes out of Bagisto 2.4, pinned in `vendor/repos/bagisto/bagisto`:

| | |
| --- | --- |
| model groups | 28, one per package with models, 125 Eloquent models and 22 enums between them |
| events | 309, most of them named - `Event::dispatch('sales.order.cancel.after', …)` - owned by the package their name says, 50 with a listener |
| HTTP | 520 operations in 10 interfaces, one per route file, with an inferred OpenAPI document |
| database | 138 tables and 1300 columns replayed from 189 migrations, 185 foreign keys, 120 places the code reads or writes them |
| queues | 17 jobs on one queue, each a hop in the flow that dispatches it and a worker flow of its own |
| flows | 610 |

Go to the service and read it the way the tabs are ordered: **bus** for the
queue, **data** for the schema laid out by model group - the picker beside
the arrangement toggle switches groups off, the search brings a table up
close - and **flows** for `shop-checkout-onepage-orders-store`, the checkout
followed from the controller through the repository it holds to the events
and the job it ends in. Every "view source" link opens the file on GitHub at
the pinned commit.

The warnings the extractor left are findings about Bagisto, not about the
tool: 218 events under the admin package are dispatched by name and declare
no payload; `Settings\CurrencyController` answers admin routes and does not
exist; the sitemap job reads a `pages` table no migration creates; a
foreign key points at a `theme_customizations` table no migration creates;
one listener waits for `bagisto.shop.products.price.after`, which nothing
dispatches, and one for the repository events of a vendored package. How the
fragments were made, and how to refresh them, is in
`vendor/repos/bagisto/bagisto/README.md`; the reading rules are in
`plugins/extract-laravel/README.md`.

### The small one, by the book: CodelyTV php-ddd-example

The fourth profile, **CodelyTV php-ddd-example**, is the opposite kind of
real: [php-ddd-example](https://github.com/CodelyTV/php-ddd-example) is
CodelyTV's reference for DDD, hexagonal architecture and CQRS in PHP, a
Symfony monorepository laid out as `src/<Context>/<Module>/{Domain,Application,Infrastructure}`
with the deployables under `apps/`, read by `extract-php-ddd` alone - the
layout is the claim, and nothing is annotated. What comes out, pinned in
`vendor/repos/CodelyTV/php-ddd-example`: four contexts (Mooc, Backoffice,
Analytics, Retention), six services, five aggregates with their value
objects and three domain events on one RabbitMQ exchange, one queue per
subscriber, the MySQL tables from the Doctrine mappings including a JOINED
`steps` family, and sixteen flows. The one to read is
`backoffice-frontend-courses-post`: the back office's form dispatches
Mooc's `CreateCourseCommand` over an in-memory bus, so the flow crosses to
`mooc.backend` with a `call` step, records `CourseCreated`, saves the
course, and the subscribers in Mooc, Backoffice and Analytics pick the event
up from their own queues.

The warnings are findings about the project: Analytics and Retention have no
application under `apps/`, so their code deploys nowhere and Analytics'
subscriber to every event runs nowhere; `TrimVideoCommandHandler` is named
like a handler and implements neither bus interface; Retention's four modules
and Mooc's Notifications are empty scaffolding; the front end routes
`/api/courses` to a controller that does not exist. How the fragments were
made is in `vendor/repos/CodelyTV/php-ddd-example/README.md`; the reading
rules are in `plugins/extract-php-ddd/README.md`.

### The same lesson in C#: Modular Monolith with DDD

The fifth profile, **Modular Monolith with DDD**, is Kamil Grzybek's
[modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd),
the reference for the pattern in .NET: five modules laid out as
`src/Modules/<Module>/{Domain,Application,Infrastructure,IntegrationEvents}`,
one API host, one SQL Server database with a schema per module, read by
`extract-csharp-ddd` alone - through Roslyn, the compiler's own parser, over
the tree as one compilation and without restoring a single package. What
comes out, pinned in `vendor/repos/kgrzybek/modular-monolith-with-ddd`: five
contexts with one service each, nineteen aggregates and five model groups,
sixty domain events dispatched in process and seven integration events on
the in-memory bus, sixty-one commands and twenty-nine queries, an internal command queue
per module, the forty-three tables and seventeen views of the database
project with the root tables mapped to their aggregates through the EF
configurations, fifty-one HTTP operations across four documents, the
project's seventeen decision records, and a hundred and two flows. The one
to read is `register-new-user`: the User Access controller hands
`RegisterNewUserCommand` to the Registrations module's facade in process,
the flow crosses with a `call` step, `NewUserRegisteredDomainEvent` is
raised and saved, and from there the outbox republishes it to the bus as an
integration event that Meetings, Administration and Payments each hear and
turn into a job on their own internal queue.

The warnings are findings about the project: `MemberCreatedIntegrationEvent`
is declared and published nowhere while User Access subscribes to it;
Payments subscribes to `MeetingGroupProposalAcceptedIntegrationEvent` and
has no handler; the `app` schema belongs to no module; the view is created
as `v_Countriess` and the query reads `v_Countries`; and two modules keep a
`Domain/Users` directory with a typed id and nothing to hold it. How the
fragments were made is in
`vendor/repos/kgrzybek/modular-monolith-with-ddd/README.md`; the reading
rules are in `plugins/extract-csharp-ddd/README.md`.

## Develop Portolan itself

```bash
npm install
npm run dev
```

```bash
npm run gen          # run extract → verify → generate over portolan.json
npm run gen:check    # fail if what is committed no longer follows from the catalog
npm run diff         # what this branch changes about the architecture
npm run schema       # recompose the manifest schema from the plugins
npm test             # vitest; npm run test:go for the Go catalog mirror
npm run build        # likec4:gen + tsc --noEmit + vite build
```

Generated output is committed, so a change to it shows up in a diff. CI builds
the site (`npm run build`); the `--check` variants and the test suites are run
locally before a change lands, since they need the Go, Java, Rust and Python
toolchains the plugins are written in.
