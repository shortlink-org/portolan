package order

import (
	"context"

	"example.com/entshop/ent"
	"example.com/entshop/ent/orderline"
)

type Repository struct {
	client *ent.Client
}

func (r *Repository) ByID(ctx context.Context, id string) (*ent.Order, error) {
	return r.client.Order.Get(ctx, id)
}

func (r *Repository) Place(ctx context.Context, skus []string) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	order, err := tx.Order.Create().SetState("placed").Save(ctx)
	if err != nil {
		return err
	}
	for _, sku := range skus {
		if _, err := tx.OrderLine.Create().SetSku(sku).SetOrder(order).Save(ctx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Repository) Lines(ctx context.Context) ([]*ent.OrderLine, error) {
	return r.client.OrderLine.Query().Where(orderline.QuantityGT(0)).All(ctx)
}

func (r *Repository) Clear(ctx context.Context) error {
	_, err := r.client.OrderLine.Delete().Exec(ctx)
	return err
}
