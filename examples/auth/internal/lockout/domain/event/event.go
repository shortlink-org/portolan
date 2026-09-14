// Package event holds the domain events of the lockout domain: facts that have
// already happened.
//
// What an event is - named, about one aggregate, at one moment - is not this
// domain's to say; that is pkg/ddd/event. This package says which facts the
// lockout domain announces and what each of them carries.
package event

import ddd "github.com/shortlink-org/portolan/pkg/ddd/event"

// Event is what every domain event in this package answers. The aggregate id
// on a lockout event is the user id, which is also the lockout's identity.
type Event = ddd.Event

// The names events travel under on the bus. Constants, because a subscriber
// and a publisher have to agree on them.
const (
	TopicAccountLocked = "auth.AccountLocked"
)
