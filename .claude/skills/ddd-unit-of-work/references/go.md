# Unit of work in Go

`examples/auth/internal/pkg/uow/uow.go`, over `go-sdk/uow` and the SDK's
Postgres router:

```go
type UnitOfWork struct{ router *replica.Router }

func (u *UnitOfWork) Do(ctx context.Context, fn func(ctx context.Context) error) error {
    if sdkuow.HasTx(ctx) {
        return fn(ctx) // re-entrant
    }
    return u.router.InTx(ctx, pgx.TxOptions{}, func(txCtx context.Context, tx pgx.Tx) error {
        return fn(sdkuow.WithTx(txCtx, tx))
    })
}
```

Assembly hands the same lookup to everyone (`provider/storage.go`,
`provider/outbox.go`):

```go
store, err := postgres.New(ctx, cfg, log, postgres.WithTxLookup(sdkuow.FromContext))
publisher, err := sdkoutbox.NewPublisher(sdkuow.FromContext)
```

Repository `Save`, one unit for aggregate and events:

```go
func (p *Postgres) Save(ctx context.Context, u *user.User, events ...event.Event) error {
    return p.uow.Do(ctx, func(ctx context.Context) error {
        if u.Version == 0 { insert } else { update }
        if len(events) == 0 || p.bus == nil { return nil }
        return p.bus.Publish(ctx, events)
    })
}
```

One unit per independent aggregate, with retry on conflict
(`usecases/end_after_credential_change/usecase.go`):

```go
for _, doomed := range change.Ends(sessions, uc.now()) {
    if err := uc.end(ctx, doomed.ID); err != nil { return err }
}

func (uc *UseCase) end(ctx context.Context, id string) error {
    for attempt := range retries {
        current, err := uc.repo.ByID(ctx, id)
        if errors.Is(err, session.ErrNotFound) { return nil }
        if err != nil { return err }
        ev, ended := current.Revoke(event.ReasonPasswordChanged, uc.now())
        if !ended { return nil }
        switch err := uc.repo.Save(ctx, current, ev); {
        case err == nil:                          return nil
        case errors.Is(err, session.ErrConflict): continue // re-read, redo
        default:                                  return err
        }
    }
    ...
}
```

Two aggregates in one unit, when the rule demands it:

```go
return uc.uow.Do(ctx, func(ctx context.Context) error {
    if err := uc.orders.Save(ctx, order, placed); err != nil { return err }
    return uc.baskets.Save(ctx, basket, checkedOut)
})
```

Cache bypass (`repository/session/cached.go`): `if sdkuow.HasTx(ctx) { return c.next.ByToken(ctx, presented) }`.

Test harness (`pkg/postgrestest`): `postgrestest.Store(t, source)` returns
the router and a `*uow.UnitOfWork` built with `WithTxLookup(sdkuow.FromContext)`.
