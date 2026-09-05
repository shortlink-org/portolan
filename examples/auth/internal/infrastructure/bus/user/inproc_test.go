package user_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/user"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func registered(id string) event.Event {
	return event.NewUserRegistered(id, id+"@example.com", now)
}

func TestDeliversToNamedSubscribers(t *testing.T) {
	b := bus.NewInProc("auth_user")
	var got []string

	b.Subscribe("auth.UserRegistered", func(_ context.Context, e event.Event) error {
		got = append(got, e.AggregateID())
		return nil
	})
	b.Subscribe("auth.SomethingElse", func(context.Context, event.Event) error {
		t.Error("a handler was called for an event it did not subscribe to")
		return nil
	})

	if err := b.Publish(context.Background(), []event.Event{registered("u1"), registered("u2")}); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "u1" || got[1] != "u2" {
		t.Errorf("got %v, want both events in order", got)
	}
}

// The empty name is every event: a logger or an outbox does not want to list
// them.
func TestEmptyNameSubscribesToEverything(t *testing.T) {
	b := bus.NewInProc("auth_user")
	count := 0

	b.Subscribe("", func(context.Context, event.Event) error {
		count++
		return nil
	})
	if err := b.Publish(context.Background(), []event.Event{registered("u1")}); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("the catch-all was called %d times, want 1", count)
	}
}

// A subscriber's failure fails the publish, and through it the use case. This
// adapter is for tests and local runs, where delivery quietly going missing is
// the worst outcome.
func TestSubscriberErrorReachesThePublisher(t *testing.T) {
	b := bus.NewInProc("auth_user")
	boom := errors.New("boom")

	b.Subscribe("", func(context.Context, event.Event) error { return boom })

	err := b.Publish(context.Background(), []event.Event{registered("u1")})
	if !errors.Is(err, boom) {
		t.Fatalf("Publish = %v, want the subscriber's error", err)
	}
	// The event name is in the message, or a failure says nothing about what
	// failed to arrive.
	if got := err.Error(); got == boom.Error() {
		t.Error("the error should say which event could not be delivered")
	}
}

// Stopping at the first failure is deliberate: carrying on would leave one
// error standing for an unknown number of them.
func TestPublishStopsAtTheFirstFailure(t *testing.T) {
	b := bus.NewInProc("auth_user")
	delivered := 0

	b.Subscribe("", func(_ context.Context, e event.Event) error {
		delivered++
		if e.AggregateID() == "u1" {
			return errors.New("boom")
		}
		return nil
	})

	if err := b.Publish(context.Background(), []event.Event{registered("u1"), registered("u2")}); err == nil {
		t.Fatal("Publish should have failed")
	}
	if delivered != 1 {
		t.Errorf("%d events were delivered, want it to stop after the first failure", delivered)
	}
}

// Handlers are copied out from under the lock before being called, so one that
// subscribes while being called does not deadlock on a non-reentrant RWMutex.
func TestSubscribingFromInsideAHandler(t *testing.T) {
	b := bus.NewInProc("auth_user")
	done := make(chan struct{})

	b.Subscribe("", func(context.Context, event.Event) error {
		b.Subscribe("auth.UserRegistered", func(context.Context, event.Event) error { return nil })
		return nil
	})

	go func() {
		_ = b.Publish(context.Background(), []event.Event{registered("u1")})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish deadlocked when a handler subscribed")
	}
}

func TestNoSubscribers(t *testing.T) {
	b := bus.NewInProc("auth_user")
	if err := b.Publish(context.Background(), []event.Event{registered("u1")}); err != nil {
		t.Errorf("publishing to nobody is not a failure: %v", err)
	}
}
