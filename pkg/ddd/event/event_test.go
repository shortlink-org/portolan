package event_test

import (
	"testing"
	"time"

	"github.com/shortlink-org/portolan/pkg/ddd/event"
)

type somethingHappened struct {
	event.Base
	detail string
}

func (somethingHappened) Name() string { return "test.SomethingHappened" }

func TestBaseAnswersForTheEvent(t *testing.T) {
	at := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

	var e event.Event = somethingHappened{Base: event.New("agg-1", at), detail: "x"}

	if e.Name() != "test.SomethingHappened" {
		t.Fatalf("Name = %q", e.Name())
	}
	if e.AggregateID() != "agg-1" {
		t.Fatalf("AggregateID = %q", e.AggregateID())
	}
	if !e.OccurredAt().Equal(at) {
		t.Fatalf("OccurredAt = %v", e.OccurredAt())
	}
}
