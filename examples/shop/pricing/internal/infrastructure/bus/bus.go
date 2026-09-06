// Package bus is how an event leaves the service, and how another service's
// event reaches it.
//
// A message is what the outbox row held and nothing the bus adds: the cart and
// the OMS write the same row and read the same headers, so a subscriber in any
// language dispatches on the event's name without parsing the payload.
package bus

import "context"

// MetadataEventName is the metadata key the event's name travels under, the
// same key on every service in the estate.
const MetadataEventName = "event_name"

// Message is one event on the wire: the id the bus deduplicates on, the subject
// it travels on, the payload as the outbox row held it, and the metadata the
// name and the trace context ride in.
type Message struct {
	UUID     string
	Topic    string
	Payload  []byte
	Metadata map[string]string
}

// Name is the event's name as the metadata carries it; the topic when it does
// not, so a log line always has something to call the message.
func (m Message) Name() string {
	if name := m.Metadata[MetadataEventName]; name != "" {
		return name
	}

	return m.Topic
}

// Handler is handed one message. An error is a message not handled: the bus
// leaves it to be delivered again rather than acknowledging it.
type Handler func(ctx context.Context, m Message) error

// Bus is the port. What is behind it - NATS when NATS_URL names a server, the
// log when it does not - is the assembly's business.
type Bus interface {
	// Publish hands one message to the bus. At least once: a repeat is the
	// bus's to deduplicate, by the message's UUID.
	Publish(ctx context.Context, m Message) error
	// Subscribe hands over only the messages on topic that are named name,
	// which is what keeps a policy from being woken by every event on the
	// subject. The subscription lives until ctx ends or the bus is closed.
	Subscribe(ctx context.Context, topic, name string, handler Handler) error
	// Close lets the subscriptions go and drains what is in flight.
	Close() error
}
