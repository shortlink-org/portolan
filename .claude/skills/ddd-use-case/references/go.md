# Use cases in Go

Current [login slice](../../../../examples/auth/internal/session/application/login/usecase.go):

```text
internal/session/application/login/
  usecase.go        orchestration and constructor
  model.go          Command and Result
  port.go           consumer-owned interfaces and verdict values
  errors.go         slice-owned outcomes
  usecase_test.go   tests over local Mockery mocks
  .mockery.yml      generation configuration
  README.md         steps, consequences, answers, derived sequence link
```

[Input/result](../../../../examples/auth/internal/session/application/login/model.go)
stay in package `login`. Use `Handle(ctx, Command) (Result, error)` or
`Handle(ctx, Command) error`; a read uses `Query`. The
[get slice](../../../../examples/auth/internal/user/application/get/model.go)
shows query and read result types.

[Identity adapter](../../../../examples/auth/internal/session/infrastructure/identity/adapter.go)
bridges user credential checking to login's port. Neither application package
imports its peer. The current adapter preserves the already-classified refusal;
where port contracts differ, translate at the adapter without exposing hidden
credential distinctions.

[Credential checking](../../../../examples/auth/internal/user/application/check_credentials/usecase.go)
returns one application credential error and records lockout outcomes. It is a
command despite the word "check". [Password ports](../../../../examples/auth/internal/user/application/change_password/port.go)
keep hashing and verification out of the aggregate.
