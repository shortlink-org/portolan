# Commands and queries in Go

The first form is read off `examples/auth/internal/application/user/usecases/get`.
The reader and the projector below are the shape the rules take in Go;
`examples/auth` has no projection yet, so those two are sketches against
its real types (`event.Event`, the bus `Handler`, `sdkuow`), not quotations.

## A query over the repository (`usecases/get`)

```
application/<aggregate>/usecases/get/
  usecase.go      UseCase, New, Handle
  dto/input.go
  dto/output.go   the read DTO; a separate type even when it looks like another's
  usecase_test.go against a real store, same harness as the commands
  README.md       four sections, and a freshness row under Answers
```

```go
type UseCase struct {
    repo user.Repository // the read a command already needs: ByID
}

// Handle returns the user, or user.ErrNotFound. The caller already knows the
// id, so nothing is disclosed by admitting it does not exist.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
    u, err := uc.repo.ByID(ctx, in.UserID)
    if err != nil {
        return dto.Output{}, err
    }
    return dto.Output{UserID: u.ID, Email: u.Email.String(), CreatedAt: u.CreatedAt}, nil
}
```

No `now`, no `newID`, no publisher, no unit of work: the constructor takes
the one port the read needs. The output is built here, field by field;
`*user.User` never crosses the edge.

## A query with its own reader

When the question is a set or a join the domain has no use for, the port
is the query's own:

```go
// application/session/usecases/list_devices/port.go
package list_devices

// Reader answers this query and nothing else. It is declared here, not on
// session.Repository: no command loads "every live session with the device
// it was started from", so the domain does not offer it.
type Reader interface {
    LiveByUser(ctx context.Context, userID string) ([]dto.Device, error)
}
```

```go
// infrastructure/reader/list_devices/postgres.go
package list_devices

var _ usecase.Reader = (*Postgres)(nil)

func (p *Postgres) LiveByUser(ctx context.Context, userID string) ([]dto.Device, error) {
    rows, err := p.router.Query(ctx, `
        SELECT id, started_at, expires_at, user_agent
          FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY started_at DESC`, userID)
    ...
}
```

The reader scans straight into the query's `dto` types. It is not a
repository: it has no `Save`, hands out no aggregate, and joins no unit of
work. It reads the same tables the repository writes, and that is the whole
of its coupling to the domain.

## A projector

A projector is a bus subscriber that writes rows. It uses the same handler
type the policies use (`bus/<aggregate>/inproc.go`: `Handler func(ctx,
event.Event) error`) and is subscribed beside them at assembly.

```go
// infrastructure/projector/user_directory/projector.go
package user_directory

//go:embed migrations/*.sql
var migrations embed.FS

var (
    Migrations = migrations
    Name       = "user_directory" // records in schema_migrations_user_directory
)

type Projector struct{ router *postgres.Router }

// Handle is idempotent: the relay delivers at least once, and the same
// event twice leaves the same row. An event older than the row is skipped,
// not failed. Events this projector does not know are passed over.
func (p *Projector) Handle(ctx context.Context, e event.Event) error {
    switch ev := e.(type) {
    case *event.UserRegistered:
        _, err := p.router.Exec(ctx, `
            INSERT INTO user_directory (user_id, email, registered_at, projected_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO UPDATE
               SET email = EXCLUDED.email, projected_at = EXCLUDED.projected_at
             WHERE user_directory.projected_at < EXCLUDED.projected_at`,
            ev.AggregateID(), ev.Email(), ev.OccurredAt(), ev.OccurredAt())
        return err
    default:
        return nil // not this projector's business
    }
}
```

`migrations/0001_user_directory.sql` creates the table; nothing else in the
service writes to it, and the reader for the query that needs it reads it.
The guard is on occurred-at because `event.Event` carries no aggregate
version today; when an event gains one, the guard compares versions and the
column is called `version`.

The projector runs on its own connection, outside any unit of work: it is
behind the outbox, and the transaction it would want to join committed
before the relay ever saw the event.

## Assembly

```go
// di/provider/bus.go — beside the policy subscriptions
userBus.Subscribe(event.TopicUserRegistered, directory.Handle)
```

And the projection's migrations are applied at assembly like an
aggregate's, under their own name:

```go
migrate.Migration(ctx, store, directory.Migrations, directory.Name)
```

## Tests

- A query: the same harness as a command (`postgrestest.Store` with the
  aggregate's migrations), rows written through the repository, the DTO
  asserted. No bus needed: a query publishes nothing, and the test says so
  by not subscribing one.
- A projector: the projection's migrations on a per-test schema; the
  handler called with events built by their constructors, once and then
  again with the same event, and the rows asserted equal; then with an
  older event, and the row asserted unchanged. A test named for the rule:
  "the same event twice leaves one row", "an older event does not move the
  row back".
