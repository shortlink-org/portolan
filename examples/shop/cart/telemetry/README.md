# Telemetry

`traces.jsonl` is a recording of this service running: a basket created,
filled, merged and checked out against a running `auth`, captured by an
OpenTelemetry collector as OTLP JSON. It is what the catalog is verified
against - a hop in a flow is `verified` when this recording shows the same
message going the same way, and `declared` when only the code says so.

`record.sh` makes a new one; it needs Docker for the database and the
collector, Node for the service, and `auth` running on port 8080 for the
checkout to be a real call rather than the stand-in's answer. What it writes
is scrubbed by `scrub.mjs` first, because the database spans carry query
parameters.

| span | from |
| --- | --- |
| `POST /v1/baskets/{basketId}/checkout` and the other routes, kind server | the http instrumentation, named per route in `transport/http/server.ts` |
| `SELECT baskets`, `INSERT outbox`, … kind client | the pg instrumentation; the statement is dropped by the scrub, the verb and table stay |
| `GET /v1/sessions/current`, kind client | the http instrumentation, for the call to `auth` |
| `publish cart.BasketCheckedOut`, kind producer | `startPublish`, in the repository, with `event.name` |
| `consume cart.BasketCheckedOut`, kind consumer | `startConsume`, in the relay, with `event.name`, under the producer's span |
