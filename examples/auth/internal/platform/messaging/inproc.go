package messaging

import (
	"context"
	"fmt"
	"sync"
)

// NamedEvent is the only contract the in-process dispatcher needs from an
// integration or domain event.
type NamedEvent interface {
	Name() string
}

type Handler[E NamedEvent] func(context.Context, E) error

// InProc synchronously dispatches typed events. Modules create distinct
// instances, preserving their contracts without duplicating concurrency and
// tracing code.
type InProc[E NamedEvent] struct {
	topic string

	mu   sync.RWMutex
	subs map[string][]Handler[E]
}

func NewInProc[E NamedEvent](topic string) *InProc[E] {
	return &InProc[E]{topic: topic, subs: map[string][]Handler[E]{}}
}

func (*InProc[E]) System() string { return SystemInProc }

func (b *InProc[E]) Subscribe(name string, handler Handler[E]) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.subs[name] = append(b.subs[name], handler)
}

func (b *InProc[E]) Publish(ctx context.Context, events []E) error {
	for _, event := range events {
		for _, handler := range b.handlersFor(event.Name()) {
			if err := b.deliver(ctx, event, handler); err != nil {
				return fmt.Errorf("bus: delivering %s: %w", event.Name(), err)
			}
		}
	}
	return nil
}

func (b *InProc[E]) deliver(ctx context.Context, event E, handler Handler[E]) (err error) {
	ctx, span := StartConsume(ctx, b.System(), b.topic, event.Name())
	defer func() { EndWith(span, err) }()

	return handler(ctx, event)
}

func (b *InProc[E]) handlersFor(name string) []Handler[E] {
	b.mu.RLock()
	defer b.mu.RUnlock()

	named, all := b.subs[name], b.subs[""]
	handlers := make([]Handler[E], 0, len(named)+len(all))
	handlers = append(handlers, named...)
	handlers = append(handlers, all...)
	return handlers
}
