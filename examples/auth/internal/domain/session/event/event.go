// Package event holds the domain events of the session domain: facts that have
// already happened.
//
// An event is immutable. Its fields are private and set once by its
// constructor, because a fact that can be edited after the fact is not a fact.
package event

import "time"

// Event is what every domain event in this package answers.
type Event interface {
	// Name is the key the event travels under on the bus. Stable: renaming one
	// is a breaking change for every consumer.
	Name() string

	// AggregateID says whose fact this is - the session id, not the user's.
	AggregateID() string

	// OccurredAt is when it happened in the domain, not when it was published.
	OccurredAt() time.Time
}

// The names events travel under on the bus. They are constants because a
// subscriber and a publisher have to agree on them, and a typo in a string
// literal is a subscription that silently never fires.
const (
	TopicSessionStarted = "auth.SessionStarted"
	TopicSessionEnded   = "auth.SessionEnded"
)
