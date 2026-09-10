# Value objects in Go

[Email](../../../../examples/auth/internal/user/domain/vo/email/email.go)
constructs a validated value using [composed rules](../../../../examples/auth/internal/user/domain/vo/email/rules/composite.go).
Callers classify its marker with `errors.Is`; rule leaves explain refusal.

Password handling follows [auth.0016](../../../../examples/auth/docs/adr/0016-password-cryptography-is-an-application-port.md):

- [Domain password](../../../../examples/auth/internal/user/domain/vo/password/password.go)
  exposes `Validate`, `ParseHash`, `Hash.String` and `Hash.IsZero`. It owns
  creation policy and a structurally checked opaque stored value.
- [Register port](../../../../examples/auth/internal/user/application/register/port.go),
  [verifier port](../../../../examples/auth/internal/user/application/check_credentials/port.go)
  and [change-password ports](../../../../examples/auth/internal/user/application/change_password/port.go)
  express only the cryptographic operations each slice needs.
- [Infrastructure hasher](../../../../examples/auth/internal/user/infrastructure/password/hasher.go)
  owns randomness, derivation, constant-time verification and algorithm handling.

Do not recreate the old `password.New(plaintext)` / `Hash.Matches` domain API.
Apply creation policy when setting a password; parsing a stored value checks its
structure, and checking credentials does not reapply today's creation policy.
