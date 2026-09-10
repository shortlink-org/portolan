# Assembly in Go

Current auth uses module-local Wire sets:

- [User set](../../../../examples/auth/internal/user/di/set.go) composes its
  [application](../../../../examples/auth/internal/user/di/application.go),
  [infrastructure](../../../../examples/auth/internal/user/di/infrastructure.go)
  and HTTP providers.
- [Session set](../../../../examples/auth/internal/session/di/set.go) also owns
  [policy](../../../../examples/auth/internal/session/di/policy.go) and
  [risk configuration](../../../../examples/auth/internal/session/di/risk.go).
- [Root wire](../../../../examples/auth/internal/di/wire.go) composes feature sets;
  [providers](../../../../examples/auth/internal/di/provider) own shared resources,
  buses, subscriptions and outbox topics.
- [App](../../../../examples/auth/internal/di/app.go) exposes resource lifecycle.

A cross-module implementation belongs to consuming infrastructure, such as
[identity](../../../../examples/auth/internal/session/infrastructure/identity/adapter.go),
not a translation type in root DI. Local sets bind it to consumer ports.

Verify shared transaction lookup with the focused
[outbox composition tests](../../../../examples/auth/internal/di/provider/outbox_test.go).
Regenerate the affected Wire graph when bindings change; do not copy a stale
`wire.Build` list from a skill.
