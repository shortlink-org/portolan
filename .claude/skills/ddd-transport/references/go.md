# Transport in Go

Current auth separates the shared generated server from feature handlers:

- [OpenAPI](../../../../examples/auth/internal/transport/http/gen/openapi.yaml)
  and [generation entrypoint](../../../../examples/auth/internal/transport/http/gen/generate.go).
- [Shared server](../../../../examples/auth/internal/transport/http/server.go)
  mounts module handlers; [telemetry](../../../../examples/auth/internal/transport/http/telemetry.go)
  names matched routes.
- [User handler](../../../../examples/auth/internal/user/infrastructure/http/handler.go)
  and [password change](../../../../examples/auth/internal/user/infrastructure/http/change_password.go)
  map generated requests into slice-owned `Command` types.
- [User errors](../../../../examples/auth/internal/user/infrastructure/http/errors.go)
  and [session errors](../../../../examples/auth/internal/session/infrastructure/http/errors.go)
  map domain/application outcomes to public status and text.

Use the actual `Command`, `Query` and `Result` types; no `dto` import is required.
The generated strict server expects typed responses; framework errors and
business refusals have different return paths. Test public mappings with the
module's `errors_test.go`, and generate only when the contract changes.
