package repository

import (
	"context"

	"example.com/sqlcshop/internal/order/infrastructure/repository/db"
	"example.com/sqlcshop/internal/order/infrastructure/repository/reports"
)

type Postgres struct {
	q       *db.Queries
	reports *reports.Queries
}

func (p *Postgres) ByID(ctx context.Context, id string) (db.Order, error) {
	return p.q.GetOrder(ctx, id)
}

func (p *Postgres) Totals(ctx context.Context) error {
	_, err := p.reports.LineTotals(ctx)
	return err
}
