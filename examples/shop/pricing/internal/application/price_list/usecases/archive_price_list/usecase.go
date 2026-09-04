// Package archive_price_list takes a price list out of use without losing it.
package archive_price_list

import (
	"context"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/archive_price_list/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
)

// UseCase archives one list. Quotes priced against it still point here, which
// is why nothing is deleted.
type UseCase struct {
	lists price_list.Repository
}

func New(lists price_list.Repository) *UseCase {
	return &UseCase{lists: lists}
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	list, err := uc.lists.ByID(ctx, in.PriceListID)
	if err != nil {
		return dto.Output{}, err
	}

	list.Archive()
	if err := uc.lists.Save(ctx, list); err != nil {
		return dto.Output{}, err
	}

	return dto.Output{PriceListID: list.ID()}, nil
}
