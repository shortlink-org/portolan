# Errors in Go

Follow [auth.0015](../../../../examples/auth/docs/adr/0015-errors-are-owned-and-classified-at-the-edge.md):

- [Domain errors](../../../../examples/auth/internal/user/domain/errors.go)
  own invariant and repository outcomes such as uniqueness/conflict.
- [Application errors](../../../../examples/auth/internal/user/application/errors.go)
  own credential refusal; [login errors](../../../../examples/auth/internal/session/application/login/errors.go)
  own a blocked attempt.
- [Credential checking](../../../../examples/auth/internal/user/application/check_credentials/usecase.go)
  deliberately maps malformed/unknown credentials, lockout and wrong password
  to one refusal while preserving operational failures.
- [Repository](../../../../examples/auth/internal/user/infrastructure/repository/postgres.go)
  translates known database constraints and wraps other causes.
- [HTTP mapping](../../../../examples/auth/internal/user/infrastructure/http/errors.go)
  chooses public codes and text; [mapping tests](../../../../examples/auth/internal/user/infrastructure/http/errors_test.go)
  pin their equivalence and detail limits.

Use `errors.Is` / `errors.As`, and `%w` when adding context. Do not move
`ErrInvalidCredentials` back to the root or infer that every port error must
always be passed through: preservation versus translation follows the consuming
contract. A shared protocol classification is not a shared service-wide error type.
