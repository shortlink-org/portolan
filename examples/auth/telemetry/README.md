# Telemetry

`traces.jsonl` is a recording of this service running: every endpoint driven
once, plus the password change that makes the policy run, captured by an
OpenTelemetry collector as OTLP JSON. It is what the catalog is verified
against - a hop in a flow is `verified` when this recording shows the same
message going the same way, and `declared` when only the code says so.

The recording is committed for the same reason the catalog fragments are: the
facts in it are reviewed as a diff, and `gen:check` refuses a catalog that no
longer follows from it. `record.sh` makes a new one; it needs Docker for the
database and the collector, and Go for the service. What it writes is scrubbed
by `scrub.mjs` first, because the database spans carry query parameters, and
for this service those are emails, password hashes and session tokens.

What the recording contains, and where each span comes from:

| span | from |
| --- | --- |
| `POST /v1/sessions` and the other routes, kind server | otelhttp around the router, named per operation in `transport/http/telemetry.go` |
| `SELECT users`, `INSERT sessions`, … kind client | the SDK's pgx tracer; the statement is dropped by the scrub, the verb and table stay |
| `publish auth.PasswordChanged`, kind producer, `messaging.system=outbox` | `messaging.StartPublish`, in the repository publishers, with `event.name` |
| `publish auth.PasswordChanged`, kind producer, `messaging.system=inproc`, under the one above | `messaging.StartRelay`, in the relay handlers, as the event is put on the bus |
| `consume auth.PasswordChanged`, kind consumer | `messaging.StartConsume`, in the in-process bus, around the subscriber |

The relay's span is a child of the outbox's, and the consumer's a child of
the relay's, not a trace of its own: the publisher puts its span context on
the message, the outbox keeps it in the row, and the relay's middleware reads
it back. That one line is what lets a reader of the trace, and of the
catalog, follow a password change through the table and into the policy that
ends the sessions. Every event the outbox holds gets the first two spans;
only the ones something subscribes to get the third, which is how the catalog
reads auth as consuming `PasswordChanged` and nothing else it wrote
(docs/adr/0011).

Nothing here reaches the risk service. There is none in the estate, so the
login's call to `risk.v1` stays unresolved in the catalog whatever the
recording says - a trace can show a call was made, not that its far end exists.
