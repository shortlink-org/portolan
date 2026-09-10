# Adapters in Go

Current sources in `examples/auth`:

| Responsibility | Source |
|---|---|
| State plus events in one transaction | [user repository](../../../../examples/auth/internal/user/infrastructure/repository/postgres.go) |
| Domain to integration mapping | [integration/event](../../../../examples/auth/internal/user/integration/event/event.go) |
| Transactional append and relay handling | [publisher](../../../../examples/auth/internal/user/infrastructure/repository/publisher.go) |
| Shared transaction lookup | [platform UoW](../../../../examples/auth/internal/platform/uow/uow.go) |
| Token cache and invalidation | [session cache](../../../../examples/auth/internal/session/infrastructure/repository/cached.go) |
| Peer module translation | [identity adapter](../../../../examples/auth/internal/session/infrastructure/identity/adapter.go) |
| External verdict translation | [risk adapter](../../../../examples/auth/internal/session/infrastructure/risk/client.go) |
| One adapter implementing several narrow ports | [password hasher](../../../../examples/auth/internal/user/infrastructure/password/hasher.go) |

Migrations and backend tests belong to each repository package. Auth's
in-process buses consume integration DTOs after the producer commit; their
errors fail relay delivery, not the original command.

For a new ordered projector use the atomic checkpoint procedure in
[ddd-cqrs](../../ddd-cqrs/references/go.md). It opens a local transaction after
the producer's transaction has completed. Current auth does not implement that
versioned projector; do not use a timestamp guard as a substitute.
