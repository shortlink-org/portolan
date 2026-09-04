// Package lockout holds the adapters for the lockout aggregate's storage port.
package lockout

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/uow"
)

// uniqueViolation is what Postgres answers when a unique index is broken.
const uniqueViolation = "23505"

const columns = `user_id, failures, locked_until, version`

// Postgres stores lockouts.
//
// Not one statement below mentions a transaction; see the note on the user
// adapter.
type Postgres struct {
	router *replica.Router
	uow    *uow.UnitOfWork
	bus    lockout.Publisher
}

var _ lockout.Repository = (*Postgres)(nil)

func NewPostgres(router *replica.Router, unit *uow.UnitOfWork, bus lockout.Publisher) *Postgres {
	return &Postgres{router: router, uow: unit, bus: bus}
}

// Save writes the lockout and records what the change produced, in one
// transaction. See the note on the user adapter.
func (p *Postgres) Save(ctx context.Context, l *lockout.Lockout, events ...event.Event) error {
	return p.uow.Do(ctx, func(ctx context.Context) error {
		if l.Version == 0 {
			if err := p.insert(ctx, l); err != nil {
				return err
			}
		} else if err := p.update(ctx, l); err != nil {
			return err
		}

		if len(events) == 0 || p.bus == nil {
			return nil
		}
		return p.bus.Publish(ctx, events)
	})
}

func (p *Postgres) insert(ctx context.Context, l *lockout.Lockout) error {
	_, err := p.router.Exec(ctx,
		`INSERT INTO lockouts (`+columns+`) VALUES ($1, $2, $3, 1)`,
		l.UserID, l.Failures, nullable(l.LockedUntil))

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		// Two first failures for the same user arrived together. The loser
		// reads the winner's row and counts on top of it.
		return lockout.ErrConflict
	}
	if err != nil {
		return fmt.Errorf("lockout: inserting %s: %w", l.UserID, err)
	}
	return nil
}

func (p *Postgres) update(ctx context.Context, l *lockout.Lockout) error {
	tag, err := p.router.Exec(ctx,
		`UPDATE lockouts SET failures = $1, locked_until = $2, version = version + 1
		  WHERE user_id = $3 AND version = $4`,
		l.Failures, nullable(l.LockedUntil), l.UserID, l.Version)
	if err != nil {
		return fmt.Errorf("lockout: updating %s: %w", l.UserID, err)
	}

	if tag.RowsAffected() == 0 {
		return lockout.ErrConflict
	}
	return nil
}

func (p *Postgres) ByUserID(ctx context.Context, userID string) (*lockout.Lockout, error) {
	var (
		failures    int
		lockedUntil *time.Time
		version     int64
		id          string
	)

	err := p.router.QueryRow(ctx, `SELECT `+columns+` FROM lockouts WHERE user_id = $1`, userID).
		Scan(&id, &failures, &lockedUntil, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, lockout.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lockout: reading %s: %w", userID, err)
	}

	l := &lockout.Lockout{UserID: id, Failures: failures, Version: version}
	if lockedUntil != nil {
		l.LockedUntil = *lockedUntil
	}
	return l, nil
}

// nullable turns the zero time into NULL; see the session adapter.
func nullable(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
