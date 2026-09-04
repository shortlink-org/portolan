// Package price_list keeps price lists in postgres.
package price_list

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domain "github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/repository/price_list/dto"
)

// Repository is the storage port over pgx.
type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Save writes a list and its rows. A list is imported whole, so the rows go in
// with it and are never updated one by one.
func (r *Repository) Save(ctx context.Context, list *domain.PriceList) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO price_lists (id, name, currency, valid_from, archived)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO UPDATE SET archived = EXCLUDED.archived`,
		list.ID(), list.Name(), list.Currency(), list.ValidFrom(), list.Archived(),
	); err != nil {
		return err
	}

	for _, row := range list.Rows() {
		if _, err := tx.Exec(ctx,
			`INSERT INTO price_rows (price_list_id, sku, amount_minor) VALUES ($1, $2, $3)
			 ON CONFLICT DO NOTHING`,
			list.ID(), row.SKU(), row.Price().AmountMinor(),
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) ByID(ctx context.Context, id string) (*domain.PriceList, error) {
	return r.one(ctx, `SELECT id, name, currency, valid_from, archived FROM price_lists WHERE id = $1`, id)
}

// Current is the list a quote is priced against: the newest one in force that
// nobody has archived.
func (r *Repository) Current(ctx context.Context, currency string) (*domain.PriceList, error) {
	return r.one(ctx,
		`SELECT id, name, currency, valid_from, archived
		   FROM price_lists
		  WHERE currency = $1 AND archived = false AND valid_from <= now()
		  ORDER BY valid_from DESC LIMIT 1`, currency)
}

func (r *Repository) All(ctx context.Context) ([]*domain.PriceList, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, currency, valid_from, archived FROM price_lists ORDER BY valid_from DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*domain.PriceList
	for rows.Next() {
		var row dto.PriceList
		if err := rows.Scan(&row.ID, &row.Name, &row.Currency, &row.ValidFrom, &row.Archived); err != nil {
			return nil, err
		}
		out = append(out, domain.Restore(row.ID, row.Name, row.Currency, nil, row.ValidFrom, row.Archived))
	}

	return out, rows.Err()
}

func (r *Repository) one(ctx context.Context, sql string, args ...any) (*domain.PriceList, error) {
	var row dto.PriceList
	if err := r.pool.QueryRow(ctx, sql, args...).Scan(&row.ID, &row.Name, &row.Currency, &row.ValidFrom, &row.Archived); err != nil {
		return nil, err
	}

	priced, err := r.rowsOf(ctx, row.ID, row.Currency)
	if err != nil {
		return nil, err
	}

	return domain.Restore(row.ID, row.Name, row.Currency, priced, row.ValidFrom, row.Archived), nil
}

func (r *Repository) rowsOf(ctx context.Context, listID, currency string) ([]domain.Row, error) {
	rows, err := r.pool.Query(ctx, `SELECT price_list_id, sku, amount_minor FROM price_rows WHERE price_list_id = $1`, listID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Row
	for rows.Next() {
		var row dto.Row
		if err := rows.Scan(&row.PriceListID, &row.SKU, &row.AmountMinor); err != nil {
			return nil, err
		}
		price, err := money.New(row.AmountMinor, currency)
		if err != nil {
			return nil, err
		}
		out = append(out, domain.NewRow(row.SKU, price))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, pgx.ErrNoRows
	}

	return out, nil
}
