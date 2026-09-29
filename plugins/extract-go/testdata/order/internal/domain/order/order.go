// Package order holds the order aggregate.
package order

import "example.com/order/internal/domain/order/event"

// Status is the stage an order has reached.
type Status string

const (
	StatusDraft  Status = "draft"
	StatusPlaced Status = "placed"
)

// Order is a customer's purchase.
type Order struct {
	ID     string
	Status Status
}

// Place moves a draft order on and says so.
func (o *Order) Place() event.Placed {
	o.Status = StatusPlaced

	return event.Placed{OrderID: o.ID}
}
