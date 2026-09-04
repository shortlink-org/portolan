// Package bus is how an event leaves the service.
package bus

import "context"

// Bus is the port. What is behind it - NATS when NATS_URL names a server, the
// log when it does not - is the assembly's business.
type Bus interface {
	Publish(ctx context.Context, topic, name, payload string) error
	Subscribe(ctx context.Context, topic, name string, handler func(context.Context, []byte) error) error
}
