// Package user holds the adapters for the user domain's Publisher port.
package user

import (
	"context"
	"fmt"
	"sync"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

// Handler is what a subscriber is: something that does one thing with one
// event, and says whether it managed.
type Handler func(ctx context.Context, e event.Event) error

// InProc delivers events to subscribers in the publishing goroutine.
//
// Delivery is synchronous and a subscriber's error comes back out of Publish,
// which means a broken subscriber fails the use case that published. That is
// the point: this adapter exists for tests and for local runs, where delivery
// silently going missing is the worst outcome. A real bus swaps the failure for
// a retry and an outbox - it does not swap it for a log line.
type InProc struct {
	mu   sync.RWMutex
	subs map[string][]Handler // event name -> handlers; "" -> every event
}

var _ user.Publisher = (*InProc)(nil)

func NewInProc() *InProc {
	return &InProc{subs: map[string][]Handler{}}
}

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
func (b *InProc) Publish(ctx context.Context, events []event.Event) error {
	for _, e := range events {
		for _, h := range b.handlersFor(e.Name()) {
			if err := h(ctx, e); err != nil {
				return fmt.Errorf("bus: delivering %s: %w", e.Name(), err)
			}
		}
	}
	return nil
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
