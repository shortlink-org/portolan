# extract-php-ddd

A PHP tree laid out by bounded context, module and hexagonal layer in, a
catalog fragment out - three, when the route files prove an HTTP contract
and the Doctrine mappings a database. The PHP twin of `extract-go`,
`extract-ts` and `extract-rust`: like them, this reads a layout rather than
a framework, and the layout is the claim. Nothing is annotated for the
catalog; the directory a class sits in and the base it extends say what it
is.

The layout is the one [CodelyTV's php-ddd-example](https://github.com/CodelyTV/php-ddd-example)
made common in PHP - `src/<Context>/<Module>/{Domain,Application,Infrastructure}`
with the deployables under `apps/<context>/<app>` - and it is that project the
site ships as a profile, read by this extractor alone.

Written in Rust and run as a process plugin, `cargo run --quiet
--manifest-path plugins/extract-php-ddd/Cargo.toml`, on the same reader as
`extract-laravel`: `plugins/phpscan`, over [Mago](https://github.com/carthage-software/mago)'s
`mago-syntax`. **The application is never run.** No container, no `composer
install`: everything is read from syntax, names are resolved by namespace and
`use` line, and a file that does not parse is read as far as it parsed and
reported.

## The layout it reads

```
src/<Context>/<Module>/Domain          the model: root, entities, value objects, events, ports
src/<Context>/<Module>/Application     the use cases: commands, queries, their handlers, subscribers
src/<Context>/<Module>/Infrastructure  the adapters: repositories, *.orm.xml Doctrine mappings
src/Shared, src/<Context>/Shared       the shared kernel: bases, ids; not a context, not a module
apps/<context>/<app>/config/routes/*.yaml   the HTTP edge of one deployable
apps/<context>/<app>/config/services*.yaml  which contexts' code the deployable loads
apps/<context>/<app>/src/Controller         what answers a route
```

`source` and `apps` in the options rename `src/` and `apps/`. `tests/`,
`vendor/` and everything under an application but `src/` are not read.

## What becomes what

**Context.** A directory under `src/` other than `Shared`, with its slug as
id. `classification` in the options applies to every context the tree
declares; nothing in the tree says which is core.

**Service.** Each application under `apps/<context>/` is a service of that
context - `mooc.backend`, `backoffice.frontend` - with the route files it
carries as its HTTP interfaces, one per file, `mooc.backend.courses`. The
context's model is filed under its `backend` application, or its first one
when it has none of that name. A context with no application at all gets a
service named after itself, `analytics.analytics`, and a warning: the code
is there, nothing deploys it.

**Aggregate.** A module whose `Domain/` has a class extending
`AggregateRoot`. The root's constructor parameters are its fields, typed as
written, `id: CourseId`; a class extending the root is an entity of it, the
joined subclasses of an abstract `Step`. A value object is a class that wraps
one value - it extends a `*ValueObject` base or `Uuid`, or answers `value()` -
with its fields read up the base chain, so `CourseName extends
StringValueObject` has the parent's `value: string`. Exceptions, collections
and domain services are not shape and are skipped. A module with no root but
with use cases - `Auth`, with a command and no aggregate - is a `model-group`
aggregate; one with neither is a warning and nothing else.

**Event.** A class extending `DomainEvent`. Its wire name is what
`eventName()` answers, `course.created`; its fields are the keys of
`toPrimitives()`, typed by the constructor parameter of the same name; its
doc the class docblock. The id is the class name with `DomainEvent` taken
off, `mooc.backend.courses.CourseCreated`. Every event's `wire.channel` is the
RabbitMQ exchange, `exchange` in the options, because the code reads it from
the environment.

**Operation.** A class implementing `CommandHandler` or `QueryHandler`; the
`__invoke` parameter names the message and the operation is the message
without its suffix, `create-course` for `CreateCourseCommand`. The doc is the
handler's, or the use case's it holds (`CourseCreator`), or the message's.

**Subscriber.** A class implementing `DomainEventSubscriber`; `subscribedTo()`
says which events, and `DomainEvent::class` there means every one. Each
subscriber is a consumer on the events it names, a flow from the bus in, and
a channel of its own: the RabbitMQ queue `RabbitMqQueueNameFormatter` would
name for it, `codelytv.mooc.courses_counter.increment_courses_counter_on_course_created`.
A subscriber in a context no application's `services.yaml` loads is reported:
declared, wired nowhere.

**Store.** The tables the `*.orm.xml` mappings under a context declare, as
one `mysql` store per context (`storeKind` in the options), owned by the
context's service: `<id>`, `<field>` and `<embedded>` become columns, the
embeddable's own mapping supplying the column names; a `JOINED` subclass gets
its own table keyed to the parent's. Each table `persists` the aggregate its
entity is the root or an entity of, and its columns `map` to the entity's
fields. A `*Repository` interface under `Domain/` is a port; the adapter
implementing it says what answers it - `Doctrine*`/`MySql*` the database,
`Elasticsearch*` an index, kept as a second store of kind `other` with one
table per index shaped like the root it keeps; `InMemory*` and `File*`
nothing, and a warning. Every `$this->repository->save(...)` on a port is an
access on the port's table, `write CourseRepository.save`, whether or not a
flow reaches it.

**Flow.** One per route whose controller the tree has: the request in, what
the controller `dispatch`es or `ask`s, then what the handler does, followed
through the classes it holds by their constructor types - `$this->creator->__invoke(...)`,
`Course::create(...)`, `apply($this->incrementer, [...])`, a call on a local
variable tried against the module's root. On the way, `record(new Event)`
and `publish(new Event)` are event steps to the bus and a call on a port a
step to its store. When a controller dispatches a command whose handler lives
in another context - the backoffice front end creating a Mooc course - the
flow crosses to that context's service with a `call` step and a note: in
process, over an in-memory bus, but a boundary all the same. One flow per
subscriber does the same from the queue in.

**HTTP.** One OpenAPI 3.1 document per application with routes,
`openapi.<context>-<app>.yaml` (`openapiOut` in the options, `{service}`
where the name goes), one operation per route and verb, the path's `{id}`
as parameters and the controller's docblock as the summary; a route to a
controller not in the tree is kept and reported.

## Options

See `options.schema.json`. `repo` defaults to composer.json's
`support.source` or `homepage`; `exchange` to `domain_events`; `storeKind`
to `mysql`; `classification` to nothing.

## Tests

```bash
cargo test --manifest-path plugins/extract-php-ddd/Cargo.toml
```

`testdata/mooc` is a small tree in the layout: three contexts with
applications and two without, a joined-subclass aggregate, an Elasticsearch
read model, a subscriber to every event, and a front end dispatching another
context's command. `expected.json`, `expected-stores.json` and the
`openapi.*.yaml` beside it are what the extractor writes for it; the fixture
tests explain the rules, the goldens catch what nobody asserted.
