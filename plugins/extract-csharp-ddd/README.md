# extract-csharp-ddd

A C# tree laid out by module and layer in, a catalog fragment out - three
kinds, when the API host proves an HTTP contract and the database project a
schema. The .NET twin of `extract-php-ddd`: like it, this reads a layout
rather than a framework, and the layout is the claim. Nothing is annotated
for the catalog; the directory a class sits in and the base it extends say
what it is.

The layout is the one [kgrzybek's modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd)
made common in .NET - `src/Modules/<Module>/{Domain,Application,Infrastructure,IntegrationEvents}`
with one API host under `src/API` and one SQL Server database project under
`src/Database` - and it is that project the site ships as a profile, read by
this extractor alone.

Written in C# and run as a process plugin, `dotnet plugins/extract-csharp-ddd/bin/portolan-extract-csharp-ddd.dll`,
built by `npm run plugins:build` with the .NET SDK (8 or later). The parser
is Roslyn, the compiler's own, and the one dependency; every `.cs` under the
root goes into one `Compilation`, so a partial class is one type, a base
chain is followed across files and modules, and the type of `new X(...)` or
of a variable is a fact rather than a guess. **The application is never
built or run, and none of its packages is restored.** What comes from NuGet
- MediatR's `INotificationHandler`, EF's `IEntityTypeConfiguration`,
ASP.NET's `ControllerBase` - is an error type with a name, and every rule
that touches one goes by the name as written on the base list. Only the
runtime's own assemblies are referenced, so that `Guid`, `string` and
`List<T>` read as themselves.

## The layout it reads

```
src/Modules/<Module>/Domain/<Aggregate>/      the model: root, entities, value objects, events, ports
src/Modules/<Module>/Application/<Group>/     the use cases: commands, queries, their handlers, notification handlers
src/Modules/<Module>/Infrastructure/          the adapters: repositories, EF configurations, the bus subscriptions
src/Modules/<Module>/IntegrationEvents/       what the module tells the other modules
src/API/**/Modules/<Module>/*Controller.cs    the HTTP edge of that module
src/Database/**/Structure/<schema>/Tables/    the tables, one file each, T-SQL
src/Database/**/Structure/<schema>/Views/     the views over them
src/BuildingBlocks/                           the bases: Entity, ValueObject, DomainEventBase, IntegrationEvent
```

`modules`, `api` and `database` in the options rename the three roots. A
directory named `Tests`, or ending in `Tests`, is not read; neither is `bin/`
or `obj/`.

## What becomes what

**Context.** A directory under `src/Modules` with `Domain` or `Application`
under it, with its slug as id - `user-access` for `UserAccess`.
`classification` in the options applies to every module the tree declares;
nothing in the tree says which is core.

**Service.** One per module, `<module>.module` - `meetings.module` - because
a module here has its own schema, its own outbox, its own composition root
and its own slice of the API. There is one deployable, and the catalog says
so where it matters: a call from one module to another is drawn as a `call`
step with a note that it is in process. The controllers filed under the
module's directory of the API host are its HTTP interfaces, one per
controller, `meetings.module.meetings`.

**Aggregate.** A directory under `Domain/` whose own files declare a root: a
class implementing `IAggregateRoot` or extending a class named
`AggregateRoot` (the event-sourced base Payments keeps in its `SeedWork`).
Subdirectories with no root of their own fold in - `Events/`, `Rules/` - and
one with a root is an aggregate in its own right, `Members/MemberSubscriptions`.
`SharedKernel`, `SeedWork`, `Shared`, `Rules`, `Events` and `Exceptions` at
the top of `Domain/` are not aggregates. A directory with types and no root
is a group the application layer may claim as a `model-group`; unclaimed, it
is reported.

The root and every class extending `Entity` are the entities, the root first.
Their fields are the public properties inherited from a base that is not the
framework's, then their own members in source order, a private `_title`
read as `title`, the `_domainEvents` list left out. A value object is a
class extending `ValueObject`, `TypedIdValueBase` or `AggregateId<T>`, with
its public properties read up the base chain, so `MeetingId` has the base's
`value: Guid`; one with no fields is reported and not written. A C# `enum` in
the directory is a closed set with its members, `[Obsolete]` carried as
deprecated. Rules, exceptions, domain services and `I*Context` interfaces are
not shape and are skipped.

**Domain event.** A class extending `DomainEventBase` or implementing
`IDomainEvent`, in the aggregate's directory. Its fields are its own public
properties - `Id` and `OccurredOn` are the envelope. It has no wire: a
domain event here is a MediatR notification in the same transaction, and a
notification replayed from the outbox after it. Its consumers are the
module's `INotificationHandler<TheEvent>` classes, and its
`INotificationHandler<TheNotification>` classes where the notification
extends `DomainNotificationBase<TheEvent>`, each `declared` with the
handler's name. The id keeps the class name whole,
`meetings.module.meetings.MeetingCreatedDomainEvent`, because the
integration event that follows it is a different fact with the same stem.

**Integration event.** A class extending `IntegrationEvent` under the
module's `IntegrationEvents/`. Its publisher is the module whose application
layer calls `IEventsBus.Publish(new X(...))`, and its aggregate is the one
whose domain event the publishing handler's notification wraps; an event
nobody publishes is reported and filed under the owning module's
`integration-events` group. Its wire is the class name on its own channel,
`<bus>.<Event>` with `bus` from the options, `integration-events` by
default, because the code names the class `InMemoryEventBus` and nothing
else. Its consumers are the modules whose
infrastructure says `SubscribeToIntegrationEvent<X>` or
`new IntegrationEventGenericHandler<X>()`, each with the
`INotificationHandler<X>` that hears it - `declared` when both are there,
`unresolved` and reported when a module subscribes without a handler or
handles without subscribing.

**Channel.** The bus has no named channels - `InMemoryEventBus` routes by
type and a module subscribes to a type - so each integration event is a
channel of its own, `<bus>.<Event>`, of kind `event`: the module that
publishes it sends on it, the modules that subscribe receive. Every module
whose application layer calls `ICommandsScheduler.EnqueueAsync(new C(...))`
has a `job` channel, `<module>.internal-commands`: the command written to
its `InternalCommands` table in the same transaction, read by the
ProcessInternalCommands job and handed to its handler. A command enqueued
that no handler in the module takes is reported.

**Operation.** A class under `Application/` whose base list says
`ICommandHandler<C>` or `ICommandHandler<C, R>` or `IQueryHandler<Q, R>`; the
message names the operation, `create-meeting` for `CreateMeetingCommand`.
Its fields are the message's widest constructor's parameters, or its
settable properties when it has none; its doc the handler's `<summary>`, or
the message's; its source the handler's `Handle`. The aggregate is the
domain directory named like the first directory under `Application/`
(`Application/Meetings/CreateMeeting/` is `Domain/Meetings`), and a group
with no such directory - `Countries`, `Authentication` - is a model-group
named after it. A message extending `InternalCommandBase` is reached from
the job channel; one implementing `IRecurringCommand` runs on a Quartz
schedule. A handler under `Infrastructure/` is plumbing - `ProcessOutboxCommandHandler`
- and is not read. `exposedBy` names the actions of the module's own
controllers that new the message up; an action in another module's
controller is a call across contexts and lives in the flow.

**Store.** One per schema of the database project, owned by the module
whose EF configurations `ToTable("X", "schema")` into it, else the module
named like it, else the module that writes it; a read owns nothing, and a
schema with no owner - `app`, written by the building blocks - is reported
and not read. The module's home schema is its `db`, `meetings.module.db`;
a second schema keeps its name. `storeKind` in the options says what the
schemas live in, `other` for SQL Server. A table is read from its
`CREATE TABLE`: columns with type and nullability, the primary key from the
constraint or the column, foreign keys, and the indexes created beside it.
A view is read from its `CREATE VIEW`: the select list's names, each typed
from the column it selects when the alias resolves, the tables it reads,
and the SELECT itself as the definition.

An `IEntityTypeConfiguration<T>` in the module's infrastructure says which
table holds T: the `ToTable` in `Configure` is the table, `Property<X>("_f").HasColumnName("C")`
and `Property(x => x.P)` map its columns to T's fields, an `OwnsOne` maps
the value object's parts to the owner's field, and an `OwnsMany` with a
`ToTable` of its own is the child's table. The table `persists` the block
and takes the role `aggregate-root` or `child`; a table nobody maps is
`outbox` when it is the outbox, `projection` when the application
layer writes it with SQL, `lookup` when it is only ever read, `other`
otherwise. A `Messages` or `Streams` table is where an event-sourced
module's `IAggregateStore` keeps its streams.

Accesses come from two places. A class in the infrastructure implementing an
`I*Repository` port from the domain, or `IAggregateStore`, reads and writes
the table that holds the port's root - `write MeetingRepository.AddAsync` -
by the method's name: `Add`, `Save`, `Update`, `Append` write, `Remove` and
`Delete` delete, the rest read. Every string in a method of the application
or infrastructure layer is read as SQL: `FROM`, `JOIN`, `INSERT INTO`,
`UPDATE` and `DELETE FROM` against a schema-qualified name are accesses by
that method; a view read is an access on the tables the view reads; a name
the database project does not declare is reported - which is how the
project's `v_Countriess` was found.

**Flow.** One per controller action: the request in, the command or query
the action news up, then what the handler does, followed through the
classes it holds and the domain methods it calls, by symbol. A call on a
port is a step to the store; a Dapper query a step to the tables its SQL
names; `AddDomainEvent(...)` an event raised in process, drawn as a
self-message with the event's id; `IEventsBus.Publish(...)` an event on the
bus with a `message` handoff; `ICommandsScheduler.EnqueueAsync(...)` a `job`
handoff to the module's internal queue; a command handed to another module's
facade a `call` across the boundary, followed there. One flow per
notification handler of a domain event, from the event in; one per
subscription a module handles, from the bus in; one per internal command,
from the queue in; one per recurring command, on its schedule. Each flow
carries the trigger it was read from: `http`, `event`, `message`, `job` or
`scheduled`.

**HTTP.** One OpenAPI 3.1 document per module with controllers,
`openapi.<module>.yaml` (`openapiOut` in the options), one operation per
action: the path from `[Route]` and `[HttpGet("...")]` with `[controller]`
filled in, the `{parameters}` typed from the action's, the `[FromBody]`
class as the request schema one level deep, `[ProducesResponseType]` as the
responses, `[HasPermission]` as `x-portolan-permission`, the action's
`<summary>` or its name as the summary.

## Options

See `options.schema.json`. `modules`, `api` and `database` default to
`src/Modules`, `src/API` and `src/Database`; `bus` to `integration-events`;
`storeKind` to `other`; `repo` and `classification` to nothing.

## Tests

```bash
dotnet run --project plugins/extract-csharp-ddd/test
```

`testdata/mymeetings` is a small tree in the layout: three modules, one of
them event-sourced, a module publishing an integration event two others
hear, an internal command enqueued from a subscription, a recurring command,
an EF configuration with owned types and a child table, views, and a
controller filed under a module the tree does not have. `expected.json`,
`expected-stores.json` and the `openapi.*.yaml` beside it are what the
extractor writes for it, and `expected-warnings.txt` what it says on the
way; `UPDATE_GOLDEN=1` writes them again after a deliberate change, and the
diff is the review.
