// Package store is outside the repository package the migrations live in:
// the sqlx import, not the directory, is what makes its queries accesses.
package store

import (
	"context"

	"github.com/jmoiron/sqlx"
)

const selectUser = `SELECT id, email FROM users WHERE id = $1`

type User struct {
	ID    string `db:"id"`
	Email string `db:"email"`
}

// cache has a Get of its own; calls on it are not queries.
type cache interface {
	Get(ctx context.Context, key string) (string, bool)
}

type Users struct {
	db    *sqlx.DB
	cache cache
}

func (u *Users) ByID(ctx context.Context, id string) (User, error) {
	if _, ok := u.cache.Get(ctx, "SELECT id FROM sessions"); ok {
		return User{}, nil
	}
	var out User
	err := u.db.GetContext(ctx, &out, selectUser, id)
	return out, err
}

func (u *Users) List(ctx context.Context) ([]User, error) {
	var out []User
	err := u.db.SelectContext(ctx, &out, "SELECT id, email FROM users ORDER BY email")
	return out, err
}

func (u *Users) ByIDs(ctx context.Context, ids []string) ([]User, error) {
	query, args, err := sqlx.In("SELECT id, email FROM users WHERE id IN (?)", ids)
	if err != nil {
		return nil, err
	}
	query = u.db.Rebind(query)
	var out []User
	err = u.db.SelectContext(ctx, &out, query, args...)
	return out, err
}

func (u *Users) Create(ctx context.Context, user User) error {
	_, err := u.db.NamedExecContext(ctx, `INSERT INTO users (id, email) VALUES (:id, :email)`, user)
	return err
}

func (u *Users) Logout(ctx context.Context, tx *sqlx.Tx, userID string) {
	tx.MustExecContext(ctx, "DELETE FROM sessions WHERE user_id = $1", userID)
}

func CountSessions(ctx context.Context, db *sqlx.DB) (int, error) {
	var n int
	err := sqlx.GetContext(ctx, db, &n, "SELECT count(*) FROM sessions")
	return n, err
}
