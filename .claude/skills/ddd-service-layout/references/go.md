# Layout in Go

The current reference follows [auth.0012](../../../../examples/auth/docs/adr/0012-feature-slices-own-their-layers.md).
Paths below are relative to `examples/auth`:

```text
internal/
  user/                               session/ and lockout/ follow the same shape
    domain/                           root, errors, rules, ports, event/, vo/
    application/<use_case>/           usecase.go, model.go or command.go, port.go, tests
    infrastructure/                   repository/, password/, lockout/, http/, bus/
    integration/event/                wire DTOs and outbox mapping
    di/                               application.go, infrastructure.go, http.go, set.go
  session/infrastructure/messaging/policy/
  platform/                           uow/, messaging/, tracing/
  transport/http/                     shared server, telemetry, generated contract
  di/                                 root composition and shared resource providers
```

Ports belong to consumers. Adapters in the consuming feature may bridge two
modules; domain/application may not. Each application slice owns its `Command`
or `Query` and `Result`; a `dto` subpackage is not mandatory. Test fixtures and
Mockery configuration are package-local.

Use [.golangci.yml](../../../../examples/auth/.golangci.yml) for executable
`depguard` boundaries. Read [README](../../../../examples/auth/README.md) and
scoped ADRs before applying this layout to another service.
