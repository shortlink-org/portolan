# Layout in Go

Read off `examples/auth`. Paths are relative to the service root.

```
README.md                             what it does / does not do / domain / rules
GLOSSARY.md                           the context's terms
docs/adr/                             decision records
cmd/<service>/main.go                 entry point; builds the app via wire, runs it
internal/
  domain/<aggregate>/
    README.md                         states and transitions
    <aggregate>.go                    root type, constructors, commands, sentinel errors
    port.go                           Repository and Publisher interfaces
    event/                            one file per event + event.go with the interface and topic names
    vo/<value>/                       value object; rules/ beneath it, one spec per file
    services/                         domain services, pure
  application/
    <aggregate>/usecases/<use_case>/
      usecase.go                      UseCase struct, New, Handle
      port.go                         ports only this use case needs (optional)
      dto/input.go, dto/output.go     what crosses the edge
      README.md                       what it does / what follows / answers
    policy/                           "when X happened, do Y" across aggregates
  infrastructure/
    repository/<aggregate>/           postgres.go, cached.go, publisher.go, dto/, migrations/
    bus/<aggregate>/                  in-process bus for tests and local runs
    reader/<query>/                   SQL reader for one query's Reader port, scanning into its dto
    projector/<projection>/           bus subscriber that keeps one projection; its migrations/ beside it
    <external-service>/               adapter over a generated client; proto/ and gen/ beside it
    transport/http/                   server.go, gen/ (from openapi.yaml), <aggregate>/ handlers
  di/
    app.go, wire.go, wire_gen.go      the assembled application
    provider/                         one file per concern: clock, storage, bus, usecase, transport
  pkg/
    uow/                              unit of work
    postgrestest/, redistest/         test harnesses
```

Package naming: the aggregate package is the noun (`user`, `session`); the
use case package is the verb phrase in snake_case (`change_password`,
`end_after_credential_change`); the infrastructure package repeats the
aggregate name under the port it serves (`repository/user`, `bus/user`).

Import direction is checked by eye and by the compiler: `domain/*` imports
only the standard library, the value objects beneath it, and a specification
helper; `application/*` imports `domain/*`; `infrastructure/*` imports both;
`di` imports everything.
