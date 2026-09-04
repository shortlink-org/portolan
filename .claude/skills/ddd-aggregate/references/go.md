# Aggregate in Go

From `examples/auth/internal/domain/user/user.go` and `domain/session/session.go`.

```go
// Package user holds the User aggregate.
package user

var (
    ErrInvalidCredentials = errors.New("user: invalid credentials")
    ErrNotFound           = errors.New("user: not found")
    ErrEmailTaken         = errors.New("user: email already registered")
    ErrConflict           = errors.New("user: changed by somebody else")
)

type User struct {
    ID        string
    Email     email.Address
    Password  password.Hash
    CreatedAt time.Time
    Version   int64 // zero: never stored
}

// A constructor returns the aggregate AND the event.
func Register(id, rawEmail, plaintext string, now time.Time) (*User, event.UserRegistered, error)

// A command returns the event.
func (u *User) ChangePassword(current, next, by string, now time.Time) (event.PasswordChanged, error)

// An idempotent command returns whether it did anything.
func (s *Session) Revoke(reason event.Reason, now time.Time) (event.SessionEnded, bool)

// Clone is on the aggregate because only it knows what is mutable.
func (u *User) Clone() *User
```

Ports, in `port.go` of the same package:

```go
type Repository interface {
    Save(ctx context.Context, u *User, events ...event.Event) error
    ByID(ctx context.Context, id string) (*User, error)
    ByEmail(ctx context.Context, email string) (*User, error)
}

type Publisher interface {
    Publish(ctx context.Context, events []event.Event) error
}
```

Conventions:

- `now time.Time` is a parameter, never `time.Now()` inside the domain.
- Errors are prefixed with the package name (`"user: ..."`) so a log line
  says whose fact it is.
- `Version` is compared in the repository's `UPDATE ... WHERE version = $n`;
  zero rows affected is `ErrConflict`. See [ddd-adapters](../../ddd-adapters/references/go.md).
- Value object fields on the root (`email.Address`, `password.Hash`) are
  immutable, which is what makes a shallow `Clone` correct.
