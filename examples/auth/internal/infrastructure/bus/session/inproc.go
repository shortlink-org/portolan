// Package session holds the adapters for the session domain's Publisher port.
package session

import (
	"context"
	"fmt"
	"sync"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Handler is what a subscriber is: something that does one thing with one
// event, and says whether it managed.
type Handler func(ctx context.Context, e event.Event) error

// InProc delivers events to subscribers in the publishing goroutine.
//
// Delivery is synchronous and a subscriber's error comes back out of Publish.
// Bound straight to the domain's port, as the tests do, that means a broken
// subscriber fails the use case that published - which is the point there:
// delivery silently going missing is the worst outcome. Behind the outbox, as
// assembly wires it, the same error nacks the message and the relay's retry
// and poison queue take it from there. Either way it is not a log line.
type InProc struct {
	topic string

	mu   sync.RWMutex
	subs map[string][]Handler // event name -> handlers; "" -> every event
}

var _ session.Publisher = (*InProc)(nil)

// NewInProc returns a bus for the events of one topic. The topic is only for
// the trace: this bus carries whatever it is given.
func NewInProc(topic string) *InProc {
	return &InProc{topic: topic, subs: map[string][]Handler{}}
}

// System names this bus on a span, as messaging.system.
func (b *InProc) System() string { return messaging.SystemInProc }

// Subscribe registers a handler. `name` is an event name as returned by
// event.Event.Name; the empty string subscribes to everything.
func (b *InProc) Subscribe(name string, h Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.subs[name] = append(b.subs[name], h)
}

// Publish delivers each event to its subscribers, in order.
//
// It stops at the first error rather than pressing on. Continuing would leave
// the caller with one error standing for an unknown number of failures and no
// way to say which events were delivered.
//
// Each subscriber runs under a consumer span of its own, so the trace shows
// an event consumed exactly where something reacted to it - and nowhere else.
func (b *InProc) Publish(ctx context.Context, events []event.Event) error {
	for _, e := range events {
		for _, h := range b.handlersFor(e.Name()) {
			if err := b.deliver(ctx, e, h); err != nil {
				return fmt.Errorf("bus: delivering %s: %w", e.Name(), err)
			}
		}
	}
	return nil
}

func (b *InProc) deliver(ctx context.Context, e event.Event, h Handler) (err error) {
	ctx, span := messaging.StartConsume(ctx, b.System(), b.topic, e.Name())
	defer func() { messaging.EndWith(span, err) }()

	return h(ctx, e)
}

// handlersFor copies the matching handlers out from under the lock, so a
// handler that subscribes while being called cannot deadlock.
func (b *InProc) handlersFor(name string) []Handler {
	b.mu.RLock()
	defer b.mu.RUnlock()

	named, all := b.subs[name], b.subs[""]
	out := make([]Handler, 0, len(named)+len(all))
	out = append(out, named...)
	out = append(out, all...)
	return out
}
