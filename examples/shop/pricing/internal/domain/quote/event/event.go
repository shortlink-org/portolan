// Package event holds what the quote aggregate announces.
//
// What an event is - named, about one aggregate, at one moment - is
// pkg/ddd/event's to say. This package says which facts a quote announces.
package event

import ddd "github.com/shortlink-org/portolan/pkg/ddd/event"

// Event is what every one of them answers: its name on the wire, the quote
// it belongs to, and when it happened.
type Event = ddd.Event
