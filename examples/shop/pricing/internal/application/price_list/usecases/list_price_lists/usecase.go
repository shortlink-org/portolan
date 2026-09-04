// Package list_price_lists reads every price list there is.
package list_price_lists

import (
	"context"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
)

// UseCase lists the lists, archived ones included: what a quote was priced
// against is as interesting as what the next one will be.
type UseCase struct {
	lists price_list.Repository
}

func New(lists price_list.Repository) *UseCase {
	return &UseCase{lists: lists}
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	held, err := uc.lists.All(ctx)
	if err != nil {
		return dto.Output{}, err
	}

	out := dto.Output{Lists: make([]dto.Summary, 0, len(held))}
	for _, list := range held {
		out.Lists = append(out.Lists, dto.Summary{
			PriceListID: list.ID(),
			Name:        list.Name(),
			Currency:    list.Currency(),
			Rows:        len(list.Rows()),
			Archived:    list.Archived(),
		})
	}

	return out, nil
}
