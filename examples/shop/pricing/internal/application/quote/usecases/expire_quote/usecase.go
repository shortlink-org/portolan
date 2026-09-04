// Package expire_quote lets promises lapse.
package expire_quote

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/expire_quote/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote"
)

// UseCase expires every quote whose moment has passed.
type UseCase struct {
	quotes quote.Repository
	now    func() time.Time
}

func New(quotes quote.Repository, now func() time.Time) *UseCase {
	return &UseCase{quotes: quotes, now: now}
}

// Handle sweeps. Each quote is expired and saved on its own: one that fails to
// save is one quote nobody was told about, not a sweep that did nothing.
func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
	at := uc.now()

	open, err := uc.quotes.OpenBefore(ctx, at)
	if err != nil {
		return dto.Output{}, err
	}

	expired := 0
	for _, held := range open {
		raised, err := held.Expire(at)
		if err != nil {
			continue
		}
		if err := uc.quotes.Save(ctx, held, raised); err != nil {
			return dto.Output{Expired: expired}, err
		}
		expired++
	}

	return dto.Output{Expired: expired}, nil
}
