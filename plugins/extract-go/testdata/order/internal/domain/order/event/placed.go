// Package event holds facts published by orders.
package event

// Placed says an order is ready to fulfil.
type Placed struct {
	OrderID string
}

func (Placed) Name() string { return "order.Placed" }
