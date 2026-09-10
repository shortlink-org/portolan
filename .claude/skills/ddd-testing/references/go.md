# Testing in Go

Current auth references:

- [Login tests](../../../../examples/auth/internal/session/application/login/usecase_test.go)
  use package-local Mockery mocks for repository and external ports.
- [Policy tests](../../../../examples/auth/internal/session/infrastructure/messaging/policy/revoke_sessions_on_password_change_test.go)
  mock the receiving use case.
- [Domain tests](../../../../examples/auth/internal/user/domain/user_test.go)
  run with values and fixed time.
- [Repository tests](../../../../examples/auth/internal/user/infrastructure/repository/postgres_test.go)
  and [local fixture](../../../../examples/auth/internal/user/infrastructure/repository/database_test.go)
  own their real backend; [publisher tests](../../../../examples/auth/internal/user/infrastructure/repository/publisher_test.go)
  cover the event boundary.
- [UoW tests](../../../../examples/auth/internal/platform/uow/uow_test.go) and
  [composition tests](../../../../examples/auth/internal/di/provider/outbox_test.go)
  cover shared transaction wiring.
- [Dependency configuration](../../../../examples/auth/.golangci.yml) forbids
  testcontainers in application tests.

Inspect the package's `.mockery.yml` and generation directive before changing a
port; regenerate affected local mocks. Avoid requiring hand-written function
fakes or banning the mocking library already adopted by the project.

Real-store tests establish persistence guarantees; mocked use-case tests establish
orchestration. Run the affected packages with the service's documented tooling,
report backend skips, and enforce backend availability in required CI jobs.
