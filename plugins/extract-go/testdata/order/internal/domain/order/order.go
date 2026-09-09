// Package order holds the order aggregate.
package order

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
