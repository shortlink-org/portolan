// Package session holds the adapters for the session domain's Publisher port.
package session

import (
	"context"
	"fmt"
	"sync"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
)

// Handler is what a subscriber is: something that does one thing with one
// event, and says whether it managed.
type Handler func(ctx context.Context, e event.Event) error

// InProc delivers events to subscribers in the publishing goroutine. See the
// note in the user bus for why a subscriber's error is not swallowed.
type InProc struct {
	mu   sync.RWMutex
	subs map[string][]Handler // event name -> handlers; "" -> every event
}

var _ session.Publisher = (*InProc)(nil)

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

// Publish delivers each event to its subscribers, in order, stopping at the
// first error.
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
