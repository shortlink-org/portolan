// Package event holds the domain events of the session domain: facts that have
// already happened.
//
// What an event is - named, about one aggregate, at one moment - is not this
// domain's to say; that is pkg/ddd/event. This package says which facts the
// session domain announces and what each of them carries.
package event

import ddd "github.com/shortlink-org/portolan/pkg/ddd/event"

// Event is what every domain event in this package answers. The aggregate id
// on a session event is the session id, not the user's.
type Event = ddd.Event

// The names events travel under on the bus. They are constants because a
// subscriber and a publisher have to agree on them, and a typo in a string
// literal is a subscription that silently never fires.
const (
	TopicSessionStarted = "auth.SessionStarted"
	TopicSessionEnded   = "auth.SessionEnded"
	TopicLoginAudited   = "auth.LoginAudited"
)
