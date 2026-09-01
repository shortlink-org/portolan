// Package session holds the adapters for the session aggregate's storage port.
package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/vo/token"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/uow"
)

const columns = `id, user_id, token, issued_at, expires_at, revoked_at, version`

// Postgres stores sessions.
//
// Nothing here removes expired rows. Expiry is answered by the aggregate at
// read time, so a session past its time is refused whether or not anything got
// round to deleting it; a sweeper would be a saving on storage, not a rule.
type Postgres struct {
	router *replica.Router
	uow    *uow.UnitOfWork
	bus    session.Publisher
}

var _ session.Repository = (*Postgres)(nil)

func NewPostgres(router *replica.Router, unit *uow.UnitOfWork, bus session.Publisher) *Postgres {
	return &Postgres{router: router, uow: unit, bus: bus}
}

// Save writes the session and records what the change produced, in one
// transaction. See the note on the user adapter.
func (p *Postgres) Save(ctx context.Context, s *session.Session, events ...event.Event) error {
	return p.uow.Do(ctx, func(ctx context.Context) error {
		if s.Version == 0 {
			if err := p.insert(ctx, s); err != nil {
				return err
			}
		} else if err := p.update(ctx, s); err != nil {
			return err
		}

		if len(events) == 0 || p.bus == nil {
			return nil
		}
		return p.bus.Publish(ctx, events)
	})
}

func (p *Postgres) insert(ctx context.Context, s *session.Session) error {
	_, err := p.router.Exec(ctx,
		`INSERT INTO sessions (`+columns+`) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
		s.ID, s.UserID, s.Token.String(), s.IssuedAt, s.ExpiresAt, nullable(s.RevokedAt))
	if err != nil {
		return fmt.Errorf("session: inserting %s: %w", s.ID, err)
	}
	return nil
}

// update writes only what can change after a session is issued. The token, the
// user and the times it was issued and expires are settled at Start and are not
// in the statement at all - a session whose token changed would be a different
// session.
func (p *Postgres) update(ctx context.Context, s *session.Session) error {
	tag, err := p.router.Exec(ctx,
		`UPDATE sessions SET revoked_at = $1, version = version + 1
		  WHERE id = $2 AND version = $3`,
		nullable(s.RevokedAt), s.ID, s.Version)
	if err != nil {
		return fmt.Errorf("session: updating %s: %w", s.ID, err)
	}

	if tag.RowsAffected() == 0 {
		return session.ErrConflict
	}
	return nil
}

func (p *Postgres) ByID(ctx context.Context, id string) (*session.Session, error) {
	return p.one(ctx, `WHERE id = $1`, id)
}

func (p *Postgres) ByToken(ctx context.Context, presented token.Token) (*session.Session, error) {
	return p.one(ctx, `WHERE token = $1`, presented.String())
}

// ByUserID returns every session of a user, in the order they were issued.
//
// The dead ones are included. Whether a revoked or expired session still
// matters is a decision for the domain, and this is not the place to make it.
//
// An unknown user is an empty list rather than ErrNotFound: this answers "what
// has this user got open", and for somebody with nothing open the answer is
// nothing, not an error. This table knows nothing about users anyway.
func (p *Postgres) ByUserID(ctx context.Context, userID string) ([]*session.Session, error) {
	rows, err := p.router.Query(ctx,
		`SELECT `+columns+` FROM sessions WHERE user_id = $1 ORDER BY issued_at, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("session: reading sessions of %s: %w", userID, err)
	}
	defer rows.Close()

	out := []*session.Session{}
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("session: reading sessions of %s: %w", userID, err)
	}
	return out, nil
}

func (p *Postgres) one(ctx context.Context, where string, arg any) (*session.Session, error) {
	s, err := scan(p.router.QueryRow(ctx, `SELECT `+columns+` FROM sessions `+where, arg))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, session.ErrNotFound
	}
	return s, err
}

type scanner interface{ Scan(dest ...any) error }

func scan(row scanner) (*session.Session, error) {
	var (
		id, userID, raw string
		issuedAt        time.Time
		expiresAt       time.Time
		revokedAt       *time.Time
		version         int64
	)

	if err := row.Scan(&id, &userID, &raw, &issuedAt, &expiresAt, &revokedAt, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		return nil, fmt.Errorf("session: reading: %w", err)
	}

	// Rebuilt through the parser rather than assigned: a stored token that is
	// not shaped like one of ours is a broken row, and handing back a Session
	// the domain would never have made is worse than saying so.
	parsed, err := token.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("session: stored token of %s is not one: %w", id, err)
	}

	s := &session.Session{
		ID:        id,
		UserID:    userID,
		Token:     parsed,
		IssuedAt:  issuedAt,
		ExpiresAt: expiresAt,
		Version:   version,
	}
	if revokedAt != nil {
		s.RevokedAt = *revokedAt
	}
	return s, nil
}

// nullable turns the zero time into NULL. A session that was never revoked has
// no revocation time, and storing one epoch or another to mean "never" is how a
// column ends up with two meanings.
func nullable(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
