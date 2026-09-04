# Domain service and policy in Go

Domain service, `examples/auth/internal/domain/session/services/credential_change.go`:

```go
package services // imports domain/session; session never imports services

type CredentialChange struct {
    At   time.Time // from the event, never from the clock
    Keep string    // the session to spare; empty spares none
}

// Ends returns the sessions this change puts an end to. Pure: no ports.
func (c CredentialChange) Ends(sessions []*session.Session, now time.Time) []*session.Session {
    doomed := make([]*session.Session, 0, len(sessions))
    for _, s := range sessions {
        if s == nil || s.ID == c.Keep { continue }
        if !s.Live(now) { continue }            // already dead: no event for a non-event
        if s.IssuedAt.Before(c.At) { doomed = append(doomed, s) }
    }
    return doomed
}
```

Policy, `examples/auth/internal/application/policy/revoke_sessions_on_password_change.go`:

```go
package policy

type RevokeSessionsOnPasswordChange struct {
    end *end_after_credential_change.UseCase
}

func New(end *end_after_credential_change.UseCase) *RevokeSessionsOnPasswordChange

func (p *RevokeSessionsOnPasswordChange) Handle(ctx context.Context, e userevent.Event) error {
    changed, ok := e.(userevent.PasswordChanged)
    if !ok {
        return nil // not this policy's business
    }
    return p.end.Handle(ctx, sessiondto.Input{
        UserID:    changed.UserID(),
        ChangedAt: changed.OccurredAt(),
        Keep:      changed.By(),
    })
}
```

Wiring the policy to the event name happens in assembly, as a
`map[string]Handler` handed to the relay; see
[ddd-assembly](../../ddd-assembly/references/go.md).
