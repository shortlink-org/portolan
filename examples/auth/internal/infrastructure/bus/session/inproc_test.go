package session_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	bus "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/bus/session"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func started(id string) event.Event {
	return event.NewSessionStarted(id, "u1", now.Add(24*time.Hour), now)
}

func ended(id string) event.Event {
	return event.NewSessionEnded(id, "u1", event.ReasonLogout, now)
}

func TestDeliversByName(t *testing.T) {
	b := bus.NewInProc()
	var starts, ends int

	b.Subscribe("auth.SessionStarted", func(context.Context, event.Event) error {
		starts++
		return nil
	})
	b.Subscribe("auth.SessionEnded", func(context.Context, event.Event) error {
		ends++
		return nil
	})

	if err := b.Publish(context.Background(), []event.Event{started("s1"), ended("s1"), started("s2")}); err != nil {
		t.Fatal(err)
	}
	if starts != 2 || ends != 1 {
		t.Errorf("starts=%d ends=%d, want 2 and 1", starts, ends)
	}
}

func TestEmptyNameSubscribesToEverything(t *testing.T) {
	b := bus.NewInProc()
	count := 0

	b.Subscribe("", func(context.Context, event.Event) error {
		count++
		return nil
	})
	if err := b.Publish(context.Background(), []event.Event{started("s1"), ended("s1")}); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("the catch-all saw %d events, want 2", count)
	}
}

func TestSubscriberErrorReachesThePublisher(t *testing.T) {
	b := bus.NewInProc()
	boom := errors.New("boom")

	b.Subscribe("", func(context.Context, event.Event) error { return boom })

	if err := b.Publish(context.Background(), []event.Event{started("s1")}); !errors.Is(err, boom) {
		t.Fatalf("Publish = %v, want the subscriber's error", err)
	}
}

func TestNoSubscribers(t *testing.T) {
	b := bus.NewInProc()
	if err := b.Publish(context.Background(), []event.Event{started("s1")}); err != nil {
		t.Errorf("publishing to nobody is not a failure: %v", err)
	}
}
