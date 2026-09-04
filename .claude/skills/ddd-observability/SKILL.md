---
name: ddd-observability
description: Trace a service built in layers so that one request, the events it produced, and the policies those events triggered read as one trace. Use when adding tracing to a service, naming spans, carrying context across an outbox or bus, deciding what an attribute should be called, or making telemetry optional, in any language.
---

# Observability

A reader of a trace should be able to follow a request through the
transport, into the store, across the outbox table and into the policy that
reacted, as one trace with names that say what happened in the domain.

## Rules

**Off by default, and costless when off.** Without a collector address the
provider is the no-op one and every span costs nothing. Instrumentation is
always in the code; only the exporter is configured.

**Server spans are named by route template, not by path.** `POST
/v1/sessions`, not `POST /v1/sessions/abc123`. The template is what lets a
span be read back to the operation in the API document. Rename the span once
the route is matched; the framework opens it earlier, when only the method is
known.

**Storage spans come from the driver's tracer.** The verb and table survive;
the statement parameters are scrubbed before anything is committed, because
for this service they are emails, hashes and tokens.

**Every domain event leaves two spans: where it is written and where it is
handled.** The producer span is opened per event as it goes into the outbox;
the consumer span is opened per event as the policy takes it off the bus.
Both carry the event's name as an attribute. The relay in between traces by
topic alone, and a topic is not a fact.

**The trace is carried across the table.** The publisher puts its span
context on the message, the outbox keeps it in the row, the relay's
middleware reads it back. The consumer span is a child of the producer's,
not a trace of its own. That one line is what lets a reader follow a password
change into the policy that ended the sessions.

**Attribute names follow the semantic conventions where one exists**
(`messaging.system`, `messaging.destination.name`, `http.route`). Where none
exists for the thing a reader most wants, name it for what it is
(`event.name`) and say in the comment that it is not a convention.

**The tracer is named for the package that owns the spans.** `auth/messaging`,
so a span can be traced to its source in the tree.

**A recording of the service doing everything it does is committed.** Every
endpoint driven once, plus the event-driven path, captured as OTLP JSON and
scrubbed. It is reviewed as a diff, and it is what documentation and
verification are checked against. A script reproduces it.

**A span for a swallowed failure is the metric that failure wants.** The
cache adapter swallows outages by design and says it wants a metric; the
place to record one is the adapter, not the use case.

## What is traced, and by what

| Span | Kind | Opened by |
|---|---|---|
| `POST /v1/sessions` | server | HTTP middleware, renamed after route match |
| `SELECT users`, `INSERT sessions` | client | the database driver's tracer |
| `publish auth.PasswordChanged` | producer | the outbox publisher, per event |
| `consume auth.PasswordChanged` | consumer | the event dispatcher, per event |
| calls to another service | client | the RPC library's instrumentation (not yet wired in auth) |

## Checklist

- No-op provider without configuration.
- Route-template span names with `http.route`.
- Producer and consumer spans per event, with `event.name`.
- Context injected on publish, extracted on consume.
- Scrubbed recording committed, script to regenerate it.

Language-specific: [references/go.md](references/go.md).
