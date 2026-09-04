// Package get_quote reads one quote.
package get_quote

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/get_quote/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
)

// UseCase reads a quote by id, or the one a basket holds.
type UseCase struct {
	quotes quote.Repository
}

func New(quotes quote.Repository) *UseCase {
	return &UseCase{quotes: quotes}
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	var (
		held *quote.Quote
		err  error
	)
	if in.QuoteID != "" {
		held, err = uc.quotes.ByID(ctx, in.QuoteID)
	} else {
		held, err = uc.quotes.ByBasket(ctx, in.BasketID)
	}
	if err != nil {
		return dto.Output{}, err
	}

	return dto.Output{
		QuoteID:    held.ID(),
		BasketID:   held.BasketID(),
		TotalMinor: held.Total().AmountMinor(),
		Currency:   held.Total().Currency(),
		State:      held.State(),
		ExpiresAt:  held.ExpiresAt().Format(time.RFC3339),
	}, nil
}
