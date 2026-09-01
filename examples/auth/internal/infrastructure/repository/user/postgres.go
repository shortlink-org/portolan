// Package user holds the adapters for the user aggregate's storage port.
//
// Everything here implements domain/user.Repository and nothing else. The
// dependency runs one way - infrastructure knows the domain, the domain does
// not know this package exists.
package user

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shortlink-org/go-sdk/db/drivers/postgres/replica"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/email"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/vo/password"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/uow"
)

// uniqueViolation is what Postgres answers when a unique index is broken.
const uniqueViolation = "23505"

// Postgres stores users.
//
// Not one statement below mentions a transaction. The unit of work puts one in
// the context and the router runs on it, so the same code is correct whether it
// was called on its own or inside a wider transaction somebody else opened.
type Postgres struct {
	router *replica.Router
	uow    *uow.UnitOfWork
	bus    user.Publisher
}

var _ user.Repository = (*Postgres)(nil)

func NewPostgres(router *replica.Router, unit *uow.UnitOfWork, bus user.Publisher) *Postgres {
	return &Postgres{router: router, uow: unit, bus: bus}
}

// Save writes the user and records what the change produced, in one
// transaction.
//
// Both writes are inside the same unit of work, so a fact about a change that
// did not commit cannot exist - and neither can a change nobody was told about.
// Handing the events to Save rather than publishing them from the use case is
// what makes that unmissable: there is no way to store the aggregate without
// offering its events, and no way to offer them without storing.
func (p *Postgres) Save(ctx context.Context, u *user.User, events ...event.Event) error {
	return p.uow.Do(ctx, func(ctx context.Context) error {
		if u.Version == 0 {
			if err := p.insert(ctx, u); err != nil {
				return err
			}
		} else if err := p.update(ctx, u); err != nil {
			return err
		}

		if len(events) == 0 || p.bus == nil {
			return nil
		}
		return p.bus.Publish(ctx, events)
	})
}

func (p *Postgres) insert(ctx context.Context, u *user.User) error {
	_, err := p.router.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, created_at, version)
		 VALUES ($1, $2, $3, $4, 1)`,
		u.ID, u.Email.String(), u.Password.String(), u.CreatedAt)

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		// Two different rules land on the same SQL error, and answering with
		// the wrong one would send a caller off to fix something that is not
		// broken. The constraint name is what tells them apart.
		if pgErr.ConstraintName == "users_email_key" {
			return user.ErrEmailTaken
		}
		return user.ErrConflict
	}
	if err != nil {
		return fmt.Errorf("user: inserting %s: %w", u.ID, err)
	}
	return nil
}

func (p *Postgres) update(ctx context.Context, u *user.User) error {
	tag, err := p.router.Exec(ctx,
		`UPDATE users
		    SET email = $1, password_hash = $2, version = version + 1
		  WHERE id = $3 AND version = $4`,
		u.Email.String(), u.Password.String(), u.ID, u.Version)

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return user.ErrEmailTaken
	}
	if err != nil {
		return fmt.Errorf("user: updating %s: %w", u.ID, err)
	}

	if tag.RowsAffected() == 0 {
		// Either the row is gone or its version moved on. Both mean the copy in
		// hand is not what is stored, and the answer to both is the same: read
		// it again.
		return user.ErrConflict
	}
	return nil
}

func (p *Postgres) ByID(ctx context.Context, id string) (*user.User, error) {
	return p.one(ctx, `WHERE id = $1`, id)
}

// ByEmail looks the address up as typed. Normalisation is the value object's
// job and has already happened by the time anything is stored, so the argument
// is normalised here rather than trusted.
func (p *Postgres) ByEmail(ctx context.Context, raw string) (*user.User, error) {
	return p.one(ctx, `WHERE email = $1`, strings.ToLower(strings.TrimSpace(raw)))
}

func (p *Postgres) one(ctx context.Context, where string, arg any) (*user.User, error) {
	var (
		id, address, hash string
		createdAt         time.Time
		version           int64
	)

	err := p.router.QueryRow(ctx,
		`SELECT id, email, password_hash, created_at, version FROM users `+where, arg,
	).Scan(&id, &address, &hash, &createdAt, &version)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, user.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("user: reading: %w", err)
	}

	return hydrate(id, address, hash, createdAt, version)
}

// hydrate rebuilds the aggregate from its stored form.
//
// The value objects are rebuilt through their own parsers rather than assigned:
// a row that cannot become a valid aggregate is a broken row, and it is better
// to say so here than to hand out a User the domain would never have allowed to
// exist.
func hydrate(id, address, hash string, createdAt time.Time, version int64) (*user.User, error) {
	parsedEmail, err := email.New(address)
	if err != nil {
		return nil, fmt.Errorf("user: stored address of %s is not one: %w", id, err)
	}
	parsedHash, err := password.ParseHash(hash)
	if err != nil {
		return nil, fmt.Errorf("user: stored hash of %s is not one: %w", id, err)
	}

	return &user.User{
		ID:        id,
		Email:     parsedEmail,
		Password:  parsedHash,
		CreatedAt: createdAt,
		Version:   version,
	}, nil
}
