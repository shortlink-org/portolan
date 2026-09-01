package uow_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"

	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/postgrestest"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/uow"
)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

// The users table is borrowed as somewhere to write. What is under test is the
// transaction, not the schema.
func setup(t *testing.T) (*replica.Router, *uow.UnitOfWork) {
	t.Helper()
	return postgrestest.Store(t, postgrestest.Source{FS: user.Migrations, Name: user.Name})
}

func insert(ctx context.Context, router *replica.Router, id string) error {
	_, err := router.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, created_at, version)
		 VALUES ($1, $1 || '@example.com', 'x', now(), 1)`, id)
	return err
}

func count(t *testing.T, ctx context.Context, router *replica.Router) int {
	t.Helper()
	var n int
	if err := router.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestCommit(t *testing.T) {
	ctx := context.Background()
	router, unit := setup(t)

	if err := unit.Do(ctx, func(ctx context.Context) error { return insert(ctx, router, "u1") }); err != nil {
		t.Fatal(err)
	}
	if got := count(t, ctx, router); got != 1 {
		t.Errorf("%d rows after a successful unit of work, want 1", got)
	}
}

// The whole arrangement exists for this: a failure takes back everything the
// unit did, and it only works because the router found the transaction through
// the TxLookup hook. Without that hook the insert would have gone out on
// another connection and survived the rollback.
func TestRollback(t *testing.T) {
	ctx := context.Background()
	router, unit := setup(t)
	boom := errors.New("boom")

	err := unit.Do(ctx, func(ctx context.Context) error {
		if err := insert(ctx, router, "u1"); err != nil {
			return err
		}
		if got := count(t, ctx, router); got != 1 {
			t.Errorf("%d rows inside the transaction, want 1", got)
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("Do = %v, want the failure it was given", err)
	}

	if got := count(t, ctx, router); got != 0 {
		t.Errorf("%d rows after a rollback, want none", got)
	}
}

// Everything written inside one unit lands together, so a failure after the
// second write takes the first one with it.
func TestAllOrNothing(t *testing.T) {
	ctx := context.Background()
	router, unit := setup(t)

	err := unit.Do(ctx, func(ctx context.Context) error {
		if err := insert(ctx, router, "u1"); err != nil {
			return err
		}
		// The same id twice: the unique key refuses the second one.
		return insert(ctx, router, "u1")
	})
	if err == nil {
		t.Fatal("Do should have failed")
	}
	if got := count(t, ctx, router); got != 0 {
		t.Errorf("%d rows, want the first write taken back with the second", got)
	}
}

// Re-entrance is what lets a repository open a transaction for its own sake
// while a use case that needs two of them in one wraps them both.
func TestNested(t *testing.T) {
	ctx := context.Background()
	router, unit := setup(t)
	boom := errors.New("boom")

	err := unit.Do(ctx, func(ctx context.Context) error {
		if err := insert(ctx, router, "outer"); err != nil {
			return err
		}
		// An inner Do joins the transaction in flight rather than starting a
		// second one.
		if err := unit.Do(ctx, func(ctx context.Context) error {
			return insert(ctx, router, "inner")
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("Do = %v", err)
	}

	// If the inner call had opened its own transaction it would have committed
	// on its own, and "inner" would still be here.
	if got := count(t, ctx, router); got != 0 {
		t.Errorf("%d rows, want the inner write rolled back with the outer", got)
	}
}

// A transaction is only in the context while a unit is running.
func TestFromContext(t *testing.T) {
	ctx := context.Background()
	_, unit := setup(t)

	if uow.FromContext(ctx) != nil {
		t.Error("there is no transaction before one is opened")
	}

	var inside bool
	if err := unit.Do(ctx, func(ctx context.Context) error {
		inside = uow.FromContext(ctx) != nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !inside {
		t.Error("the transaction should be findable inside the unit - the router looks for it exactly this way")
	}

	if uow.FromContext(ctx) != nil {
		t.Error("and gone again afterwards")
	}
}
