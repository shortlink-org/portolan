// Package event holds what the quote aggregate announces.
package event

import "time"

// Event is what every one of them answers: its name on the wire, the aggregate
// it belongs to, and when it happened.
type Event interface {
	Name() string
	AggregateID() string
	OccurredAt() time.Time
}
