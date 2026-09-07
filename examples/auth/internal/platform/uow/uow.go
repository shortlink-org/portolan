// Package uow opens the transactions the rest of the service writes through.
//
// Where the transaction is KEPT is not decided here: it lives in the context,
// under a key owned by go-sdk/uow, so that everything looking for it looks in
// the same place. The driver's router finds it through postgres.WithTxLookup,
// and the outbox finds it through outbox.NewPublisher - both handed the SDK's
// FromContext, so the two cannot drift apart.
//
// Wiring that lookup is not optional. Without it the router cannot tell a
// transaction is in flight and takes another connection: the statement runs
// outside the transaction, without its locks, and can deadlock against it.
package uow

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"
	sdkuow "github.com/shortlink-org/go-sdk/uow"
)

// UnitOfWork opens transactions on the router that assembly gave it.
type UnitOfWork struct {
	router *replica.Router
}

func New(router *replica.Router) *UnitOfWork {
	return &UnitOfWork{router: router}
}

// Do runs fn in a transaction, committing if it returns nil and rolling back
// otherwise.
//
// It is re-entrant: called while a transaction is already in flight, it simply
// runs fn on that one. That is what lets a repository open a transaction for
// its own sake - so that storing an aggregate and recording its events cannot
// be done apart - while a use case that needs two aggregates in one transaction
// wraps them both and the inner calls just join in.
//
// The alternative was to make every use case remember to open one, and the
// first one that forgot would be silently non-atomic.
func (u *UnitOfWork) Do(ctx context.Context, fn func(ctx context.Context) error) error {
	if sdkuow.HasTx(ctx) {
		return fn(ctx)
	}

	return u.router.InTx(ctx, pgx.TxOptions{}, func(txCtx context.Context, tx pgx.Tx) error {
		// The router hands back its own context and the transaction separately;
		// putting them together is what makes the transaction findable by
		// everything fn calls.
		return fn(sdkuow.WithTx(txCtx, tx))
	})
}
