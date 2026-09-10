# Events in Go

Current auth has two representations, following
[auth.0013](../../../../examples/auth/docs/adr/0013-domain-events-become-integration-events-at-the-outbox.md):

- [Domain facts](../../../../examples/auth/internal/user/domain/event/event.go)
  expose name, aggregate id and occurred-at through methods. Commands return
  immutable value types.
- [Integration DTOs and mapping](../../../../examples/auth/internal/user/integration/event/event.go)
  define public JSON fields, names, topic and explicit marshal/unmarshal.
- [Publisher](../../../../examples/auth/internal/user/infrastructure/repository/publisher.go)
  maps domain facts and appends messages using the active transaction.
- [Policy](../../../../examples/auth/internal/session/infrastructure/messaging/policy/revoke_sessions_on_password_change.go)
  consumes the user's integration DTO, then calls a session use case.

`auth.PasswordChanged` is an event name; `auth_user` is its module topic.
The current DTOs do not contain the strict stream version contract. When adding
an ordered stream, extend the envelope and producer/consumer persistence first;
do not claim ordering guarantees from occurred-at or the existing message UUID.

An illustrative new envelope (not an existing auth type):

```go
type Record struct {
    StreamID      string          `json:"streamId"`
    Version       int64           `json:"version"`       // sequence, starts at 1
    SchemaVersion int             `json:"schemaVersion"` // payload shape
    Name          string          `json:"name"`
    OccurredAt    time.Time       `json:"occurredAt"`
    Payload       json.RawMessage `json:"payload"`
}
```

Allocate position under the same transaction as state and outbox, preserve it
across delivery retries, and enforce uniqueness of `(stream_id, version)`.
One position denotes one immutable record, optionally an atomic batch. Use the
strict progression and recovery rules in [SKILL.md](../SKILL.md).
