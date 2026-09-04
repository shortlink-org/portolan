# Domain events in Go

From `examples/auth/internal/domain/user/event` and `domain/session/event`.

```
domain/<aggregate>/event/
  event.go             Event interface + Topic* constants
  <fact>.go            one type per event
```

```go
package event

type Event interface {
    Name() string            // stable key on the bus
    AggregateID() string     // whose fact
    OccurredAt() time.Time   // in the domain, not at publish
}

const (
    TopicUserRegistered  = "auth.UserRegistered"
    TopicPasswordChanged = "auth.PasswordChanged"
)

type PasswordChanged struct {
    userID     string
    by         string
    occurredAt time.Time
}

func NewPasswordChanged(userID, by string, occurredAt time.Time) PasswordChanged {
    return PasswordChanged{userID: userID, by: by, occurredAt: occurredAt}
}

func (PasswordChanged) Name() string          { return TopicPasswordChanged }
func (e PasswordChanged) AggregateID() string { return e.userID }
func (e PasswordChanged) OccurredAt() time.Time { return e.occurredAt }
func (e PasswordChanged) UserID() string      { return e.userID }
func (e PasswordChanged) By() string          { return e.by }
```

A closed set:

```go
type Reason string

const (
    ReasonLogout          Reason = "logout"
    ReasonRevoked         Reason = "revoked"
    ReasonPasswordChanged Reason = "password-changed"
    ReasonRiskBlocked     Reason = "risk-blocked"
)
```

Events are value types (not pointers): they are immutable and small. The
wire form lives in `infrastructure/repository/<aggregate>/dto/event.go`
(`Marshal`/`Unmarshal` by name), not in the domain.
