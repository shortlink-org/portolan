// Package import_price_list takes in a whole price list.
package import_price_list

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/import_price_list/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/money"
)

// UseCase imports a list and makes it the one quotes are priced against from
// its own moment.
type UseCase struct {
	lists price_list.Repository
	newID func() string
}

func New(lists price_list.Repository, newID func() string) *UseCase {
	return &UseCase{lists: lists, newID: newID}
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	validFrom, err := time.Parse(time.RFC3339, in.ValidFrom)
	if err != nil {
		return dto.Output{}, err
	}

	rows := make([]price_list.Row, 0, len(in.Rows))
	for _, row := range in.Rows {
		price, err := money.New(row.AmountMinor, in.Currency)
		if err != nil {
			return dto.Output{}, err
		}
		rows = append(rows, price_list.NewRow(row.SKU, price))
	}

	list, err := price_list.Import(uc.newID(), in.Name, in.Currency, rows, validFrom)
	if err != nil {
		return dto.Output{}, err
	}
	if err := uc.lists.Save(ctx, list); err != nil {
		return dto.Output{}, err
	}

	return dto.Output{PriceListID: list.ID(), Rows: len(rows)}, nil
}
