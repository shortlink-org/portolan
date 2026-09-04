# Adapters in Go

From `examples/auth/internal/infrastructure` and `internal/pkg/uow`.

## Unit of work (`pkg/uow/uow.go`)

```go
func (u *UnitOfWork) Do(ctx context.Context, fn func(ctx context.Context) error) error {
    if sdkuow.HasTx(ctx) {
        return fn(ctx) // re-entrant: join the transaction in flight
    }
    return u.router.InTx(ctx, pgx.TxOptions{}, func(txCtx context.Context, tx pgx.Tx) error {
        return fn(sdkuow.WithTx(txCtx, tx))
    })
}
```

The driver's router finds the transaction through `postgres.WithTxLookup`
and the outbox through `outbox.NewPublisher`, both handed the SDK's
`FromContext`. Wiring that lookup is not optional: without it a statement
runs on another connection, outside the locks, and can deadlock.

## Repository (`repository/user/postgres.go`)

```go
var _ user.Repository = (*Postgres)(nil)

func (p *Postgres) Save(ctx context.Context, u *user.User, events ...event.Event) error {
    return p.uow.Do(ctx, func(ctx context.Context) error {
        if u.Version == 0 { insert } else { update }
        if len(events) == 0 || p.bus == nil { return nil }
        return p.bus.Publish(ctx, events)
    })
}

// insert: unique violation -> by constraint name
if errors.As(err, &pgErr) && pgErr.Code == "23505" {
    if pgErr.ConstraintName == "users_email_key" { return user.ErrEmailTaken }
    return user.ErrConflict
}

// update
tag, err := p.router.Exec(ctx,
    `UPDATE users SET ..., version = version + 1 WHERE id = $3 AND version = $4`, ...)
if tag.RowsAffected() == 0 { return user.ErrConflict }
```

Migrations, `repository/session/migrations.go`:

```go
//go:embed migrations/*.sql
var migrations embed.FS

var (
    Migrations = migrations
    Name       = "session" // records in schema_migrations_session
)
```

Files: `migrations/0001_sessions.up.sql`, no `.down.sql`. Applied at
assembly (`provider/storage.go`) with `migrate.Migration(ctx, store,
sessionrepo.Migrations, sessionrepo.Name)`, once per aggregate store, plus
the outbox's own. The test harness applies the same `Migrations` for the
package under test.

## Outbox publisher (`repository/user/publisher.go`)

```go
var _ user.Publisher = (*Publisher)(nil)

func (p *Publisher) Publish(ctx context.Context, events []event.Event) error {
    for _, e := range events {
        msg, err := dto.Marshal(e)
        _, span := messaging.StartPublish(ctx, dto.Topic, msg, e.Name()); span.End()
        messages = append(messages, msg)
    }
    return p.outbox.Publish(ctx, dto.Topic, messages...) // refuses outside a tx
}

type Handler func(ctx context.Context, e event.Event) error

func Handle(relay *sdkoutbox.Relay, byName map[string]Handler) error // dispatch by event name; unknown -> ack
```

## Cache decorator (`repository/session/cached.go`)

```go
var _ session.Repository = (*Cached)(nil)

func (c *Cached) ByToken(ctx context.Context, presented token.Token) (*session.Session, error) {
    if sdkuow.HasTx(ctx) { return c.next.ByToken(ctx, presented) }
    // cache hit -> return; miss or any error -> fall through
    stored, err := c.next.ByToken(ctx, presented)
    if err != nil { return nil, err } // misses are not cached
    c.store(ctx, key, stored)         // best effort
    return stored, nil
}
func (c *Cached) ByID(...)     { return c.next.ByID(...) }     // read-before-write: no cache
func (c *Cached) ByUserID(...) { return c.next.ByUserID(...) } // a set: no cache
```

## External client (`risk/client.go`)

```go
type Client struct{ rpc riskpb.RiskServiceClient }

func (c *Client) Assess(ctx context.Context, attempt login.Attempt) (login.Verdict, error) {
    out, err := c.rpc.Assess(ctx, &riskpb.AssessRequest{UserId: attempt.UserID})
    if err != nil { return "", fmt.Errorf("risk: assess: %w", err) }
    switch out.GetVerdict() {
    case riskpb.Verdict_VERDICT_ALLOW: return login.VerdictAllow, nil
    case riskpb.Verdict_VERDICT_BLOCK: return login.VerdictBlock, nil
    default: return "", fmt.Errorf("risk: assess: verdict %d is not one this service knows", out.GetVerdict())
    }
}

// Permissive implements riskpb.RiskServiceClient, not login.Risk.
type Permissive struct{}
```

Layout: `infrastructure/risk/proto/risk/v1/risk.proto` (narrowed copy),
`infrastructure/risk/gen/riskpb/` (generated), `infrastructure/risk/client.go`.

## In-process bus (`bus/user/inproc.go`)

`InProc` implements `user.Publisher`; `Subscribe(name, Handler)`; `Publish`
delivers synchronously and returns the first subscriber error.
