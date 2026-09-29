// Package place places a draft order.
package place

import "example.com/order/internal/domain/order"

type Repository interface {
	Save(any, string) error
}

type UseCase struct {
	repository Repository
}

func (uc *UseCase) Handle(ctx any, id string) error {
	o := &order.Order{ID: id}
	o.Place()

	return uc.repository.Save(ctx, id)
}
