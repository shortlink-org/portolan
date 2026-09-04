// Package quote keeps quotes in postgres.
package quote

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/event"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/line"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/repository/quote/dto"
)

// Repository is the storage port over pgx.
type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Save writes the quote, its lines and the events it raised in one transaction:
// a quote whose event did not land is a promise nobody heard.
func (r *Repository) Save(ctx context.Context, q *quote.Quote, events ...event.Event) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO quotes (id, basket_id, total_minor, currency, state, issued_at, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
		q.ID(), q.BasketID(), q.Total().AmountMinor(), q.Total().Currency(), q.State(), q.IssuedAt(), q.ExpiresAt(),
	); err != nil {
		return err
	}

	for _, l := range q.Lines() {
		if _, err := tx.Exec(ctx,
			`INSERT INTO quote_lines (quote_id, sku, quantity, unit_price_minor, currency)
			 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
			q.ID(), l.SKU(), l.Quantity(), l.UnitPrice().AmountMinor(), l.UnitPrice().Currency(),
		); err != nil {
			return err
		}
	}

	for _, raised := range events {
		if _, err := tx.Exec(ctx,
			`INSERT INTO outbox (topic, name, aggregate_id, occurred_at) VALUES ($1, $2, $3, $4)`,
			dto.Topic, raised.Name(), raised.AggregateID(), raised.OccurredAt(),
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) ByID(ctx context.Context, id string) (*quote.Quote, error) {
	return r.one(ctx, `SELECT id, basket_id, total_minor, currency, state, issued_at, expires_at FROM quotes WHERE id = $1`, id)
}

func (r *Repository) ByBasket(ctx context.Context, basketID string) (*quote.Quote, error) {
	return r.one(ctx,
		`SELECT id, basket_id, total_minor, currency, state, issued_at, expires_at
		   FROM quotes WHERE basket_id = $1 ORDER BY issued_at DESC LIMIT 1`, basketID)
}

// OpenBefore is the sweep's question, and the reason quotes carries an index on
// (state, expires_at).
func (r *Repository) OpenBefore(ctx context.Context, at time.Time) ([]*quote.Quote, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, basket_id, total_minor, currency, state, issued_at, expires_at
		   FROM quotes WHERE state = $1 AND expires_at < $2`, quote.StateIssued, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*quote.Quote
	for rows.Next() {
		held, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, held)
	}

	return out, rows.Err()
}

func (r *Repository) one(ctx context.Context, sql string, args ...any) (*quote.Quote, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, pgx.ErrNoRows
	}

	return scan(rows)
}

func scan(rows pgx.Rows) (*quote.Quote, error) {
	var row dto.Quote
	if err := rows.Scan(&row.ID, &row.BasketID, &row.TotalMinor, &row.Currency, &row.State, &row.IssuedAt, &row.ExpiresAt); err != nil {
		return nil, err
	}

	total, err := money.New(row.TotalMinor, row.Currency)
	if err != nil {
		return nil, err
	}

	return quote.Restore(row.ID, row.BasketID, []line.Line{}, total, row.State, row.IssuedAt, row.ExpiresAt), nil
}
