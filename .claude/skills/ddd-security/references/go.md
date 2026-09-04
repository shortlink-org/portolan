# Security in Go

Hash value object, `domain/user/vo/password/password.go`:

```go
func New(plaintext string) (Hash, error)        // policy applied; fresh salt via crypto/rand
func ParseHash(stored string) (Hash, error)     // no policy: reading a fact
func (h Hash) Matches(plaintext string) bool {
    got, _ := pbkdf2.Key(sha256.New, plaintext, h.salt, h.iterations, len(h.digest))
    return subtle.ConstantTimeCompare(got, h.digest) == 1
}
func (h Hash) String() string                   // "pbkdf2-sha256$210000$<salt>$<digest>"
```

Token, `domain/session/vo/token/token.go`: 32 random bytes from
`crypto/rand`, unpadded base64url, `Parse` applies shape rules only,
comparison in the store is by the stored string on an indexed column.

One error, `domain/user/user.go`:

```go
func (u *User) Authenticate(plaintext string) error {
    if !u.Password.Matches(plaintext) {
        return ErrInvalidCredentials
    }
    return nil
}
```

`ByEmail` returning `ErrNotFound` is mapped to the same
`ErrInvalidCredentials` inside the authenticate use case before it leaves.

Block path, `usecases/login/usecase.go`:

```go
if verdict == VerdictBlock {
    if err := uc.endAll(ctx, userID); err != nil { return dto.Output{}, err }
    return dto.Output{}, ErrBlocked
}
// endAll: repo.ByUserID, s.Revoke(event.ReasonRiskBlocked, now), repo.Save per session
```

Transport, `transport/http/session/errors.go`: `ErrBlocked`,
`ErrInvalidCredentials`, `ErrNotFound`, `ErrExpired`, `ErrRevoked` all map to
`401, "invalid credentials"` / `"unauthorized"`. `bearer()` returns `""` for a
non-bearer header.

Scrubbing, `telemetry/scrub.mjs`: drops `db.query.text` parameters and
keeps the verb and table.
