# Credential ownership in Go

Read [auth.0016](../../../../examples/auth/docs/adr/0016-password-cryptography-is-an-application-port.md)
and the current [password adapter](../../../../examples/auth/internal/user/infrastructure/password/hasher.go).
The domain keeps an opaque hash and password policy; hashing, salt generation
and verification are infrastructure mechanisms behind application ports.

[Credential checking](../../../../examples/auth/internal/user/application/check_credentials/usecase.go)
classifies malformed/unknown credentials, lockout and wrong passwords into one
application refusal. Operational errors remain errors. [Password change](../../../../examples/auth/internal/user/application/change_password/usecase.go)
verifies the current password through its port before storing a new hash.

[Login](../../../../examples/auth/internal/session/application/login/usecase.go)
owns the auth-specific risk-block reaction. [Token](../../../../examples/auth/internal/session/domain/vo/token/token.go)
and [token ADR](../../../../examples/auth/docs/adr/0014-session-token-lifecycle.md)
document opaque credentials. These are auth's scoped decisions.

[HTTP error mapping](../../../../examples/auth/internal/session/infrastructure/http/errors.go)
keeps credential responses non-enumerating; [telemetry scrubber](../../../../examples/auth/telemetry/scrub.mjs)
removes recorded query detail. Plaintext is transient application input, never
aggregate or repository state. Do not copy obsolete domain `Authenticate` or
`Hash.Matches` methods from earlier layouts.
