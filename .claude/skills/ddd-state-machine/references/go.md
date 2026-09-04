# State machine in Go

From `examples/auth/internal/domain/session/session.go`. The state is
derived from two fields; no `State` enum is stored, because the store needs
the timestamps anyway and a stored enum would be a second source of truth.

```go
type Session struct {
    ID, UserID string
    Token      token.Token
    IssuedAt   time.Time
    ExpiresAt  time.Time
    RevokedAt  time.Time // zero while live
    Version    int64
}

// [*] -> Live
func Start(id, userID string, now time.Time) (*Session, event.SessionStarted, error)

// Live -> Revoked. Terminal. Second call: nothing to do, no event.
func (s *Session) Revoke(reason event.Reason, now time.Time) (event.SessionEnded, bool) {
    if !s.RevokedAt.IsZero() {
        return event.SessionEnded{}, false
    }
    s.RevokedAt = now
    return event.NewSessionEnded(s.ID, s.UserID, reason, now), true
}

// Derived state, read with now. Expiry is not a transition.
func (s *Session) Live(now time.Time) bool {
    return s.RevokedAt.IsZero() && now.Before(s.ExpiresAt)
}

// The refusal form: says which state forbids use.
func (s *Session) Validate(now time.Time) error {
    if !s.RevokedAt.IsZero() { return ErrRevoked }
    if !now.Before(s.ExpiresAt) { return ErrExpired }
    return nil
}
```

When states are many or stored explicitly, use a closed set and keep
transitions in commands; do not build a transition table the commands then
consult, because the guard usually needs more than the source state (a
reason, a time, a value), and the table becomes a second place the rule
lives.

```go
type State string

const (
    StateLive    State = "live"
    StateRevoked State = "revoked"
)
```

Tests (`session_test.go`): one test per arrow, and one per refused or
no-op transition, named for it: `TestRevokeTwiceEndsNothing`,
`TestValidateAfterExpiry`.
