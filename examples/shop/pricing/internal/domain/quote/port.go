package quote

import (
	"context"
	"time"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/domain/quote/event"
)

// Repository is the storage port. Events a change produced are handed to Save
// so that the rows and the messages commit together.
type Repository interface {
	Save(ctx context.Context, q *Quote, events ...event.Event) error
	ByID(ctx context.Context, id string) (*Quote, error)
	ByBasket(ctx context.Context, basketID string) (*Quote, error)

	// OpenBefore is the sweep's question: which promises have run out.
	OpenBefore(ctx context.Context, at time.Time) ([]*Quote, error)
}
