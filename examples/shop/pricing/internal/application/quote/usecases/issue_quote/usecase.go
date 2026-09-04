// Package issue_quote prices a basket and promises the price for a while.
package issue_quote

import (
	"context"
	"errors"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/issue_quote/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/price_list"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/vo/line"
)

// Window is how long a price is promised for. Short enough that the list under
// it has not moved, long enough to walk a checkout.
const Window = 15 * time.Minute

// UseCase holds exactly the ports issuing a quote needs.
type UseCase struct {
	quotes quote.Repository
	lists  price_list.Repository
	now    func() time.Time
	newID  func() string
}

func New(quotes quote.Repository, lists price_list.Repository, now func() time.Time, newID func() string) *UseCase {
	return &UseCase{quotes: quotes, lists: lists, now: now, newID: newID}
}

// Handle prices every line against the current list and issues one quote for
// the basket. A sku the list does not price is refused rather than guessed at:
// a quote with a hole in it would be a promise nobody made.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	list, err := uc.lists.Current(ctx, in.Currency)
	if err != nil {
		return dto.Output{}, err
	}

	lines := make([]line.Line, 0, len(in.SKUs))
	for _, wanted := range in.SKUs {
		price, ok := list.PriceOf(wanted.SKU)
		if !ok {
			return dto.Output{}, errors.New("the current list does not price " + wanted.SKU)
		}
		lines = append(lines, line.New(wanted.SKU, wanted.Quantity, price))
	}

	at := uc.now()
	issued, raised, err := quote.Issue(uc.newID(), in.BasketID, lines, at, at.Add(Window))
	if err != nil {
		return dto.Output{}, err
	}

	if err := uc.quotes.Save(ctx, issued, raised); err != nil {
		return dto.Output{}, err
	}

	return dto.Output{
		QuoteID:    issued.ID(),
		TotalMinor: issued.Total().AmountMinor(),
		Currency:   issued.Total().Currency(),
		ExpiresAt:  issued.ExpiresAt().Format(time.RFC3339),
	}, nil
}
