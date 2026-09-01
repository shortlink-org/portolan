// Package uow is the unit of work: a way to say "these writes happen together"
// without every writer having to be told which transaction it is in.
//
// The transaction travels in the context. A repository calling the SDK's router
// does not mention transactions at all - the router looks the context up
// through the TxLookup hook wired at assembly and, finding one, runs the
// statement on it.
//
// Wiring that hook is not optional. Without it the router cannot tell that a
// transaction is in flight and will take a different connection: the statement
// runs outside the transaction, without its locks, and can deadlock against it.
// See internal/di/provider/storage.go, where it is wired, and the SDK's own
// note on the option.
package uow

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"
)

// key is unexported so nothing outside this package can put a transaction into
// a context, or take one out and use it after the work has committed.
type key struct{}

// UnitOfWork opens transactions on the router that assembly gave it.
type UnitOfWork struct {
	router *replica.Router
}

func New(router *replica.Router) *UnitOfWork {
	return &UnitOfWork{router: router}
}

// FromContext returns the transaction in flight, or nil.
//
// This is the function handed to postgres.WithTxLookup. It is the only reason
// the SDK's router knows anything about our transactions.
func FromContext(ctx context.Context) pgx.Tx {
	tx, _ := ctx.Value(key{}).(pgx.Tx)
	return tx
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
	if FromContext(ctx) != nil {
		return fn(ctx)
	}

	return u.router.InTx(ctx, pgx.TxOptions{}, func(txCtx context.Context, tx pgx.Tx) error {
		// The router hands back its own context and the transaction separately;
		// putting them together here is what makes the transaction findable by
		// everything fn calls.
		return fn(context.WithValue(txCtx, key{}, tx))
	})
}
