// Package event is what every domain event is, before any domain says what
// it is about: a named fact, about one aggregate, that happened at one moment.
//
// A domain event package embeds Base in each of its events and keeps only
// what is specific to that event: its Name, which is a property of the type
// and not of an instance, and its own fields.
package event

import "time"

// Event is what every domain event answers.
type Event interface {
	// Name is the key the event travels under on the bus. Stable: renaming one
	// is a breaking change for every consumer.
	Name() string

	// AggregateID says whose fact this is: the identity of the aggregate that
	// produced it, whatever that aggregate calls its identity.
	AggregateID() string

	// OccurredAt is when it happened in the domain, not when it was published,
	// which can be much later and is the bus's business.
	OccurredAt() time.Time
}

// Base is the part of every event that is the same for all of them: whose
// fact it is and when it happened. Embed it; Name stays on the event type.
//
// Its fields are private and set once by New, because a fact that can be
// edited after the fact is not a fact.
type Base struct {
	aggregateID string
	occurredAt  time.Time
}

// New is the only way to make a Base.
func New(aggregateID string, occurredAt time.Time) Base {
	return Base{aggregateID: aggregateID, occurredAt: occurredAt}
}

func (b Base) AggregateID() string { return b.aggregateID }

func (b Base) OccurredAt() time.Time { return b.occurredAt }
