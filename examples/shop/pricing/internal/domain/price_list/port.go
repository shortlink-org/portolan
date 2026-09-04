package price_list

import "context"

// Repository is the storage port for lists. No events: a price list changing is
// this service's own business until somebody asks for a quote.
type Repository interface {
	Save(ctx context.Context, list *PriceList) error
	ByID(ctx context.Context, id string) (*PriceList, error)
	Current(ctx context.Context, currency string) (*PriceList, error)
	All(ctx context.Context) ([]*PriceList, error)
}
