package event_test

import (
	"testing"
	"time"

	domainevent "github.com/shortlink-org/portolan/examples/auth/internal/session/domain/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/integration/event"
)

var at = time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)

// A domain event goes out as a message and comes back as the wire form a
// policy reads, with every field it carries.
func TestSessionEventsRoundTrip(t *testing.T) {
	started := domainevent.NewSessionStarted("s1", "u1", "curl/8.9", at.Add(24*time.Hour), at)
	msg, err := event.Marshal(started)
	if err != nil {
		t.Fatal(err)
	}
	back, err := event.Unmarshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	wire, ok := back.(event.SessionStarted)
	if !ok || wire.SessionID != "s1" || wire.UserID != "u1" || wire.UserAgent != "curl/8.9" || !wire.OccurredAt.Equal(at) {
		t.Fatalf("SessionStarted came back as %#v", back)
	}

	audited := domainevent.NewLoginAudited("s1", "u1", "curl/8.9", at)
	msg, err = event.Marshal(audited)
	if err != nil {
		t.Fatal(err)
	}
	back, err = event.Unmarshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	record, ok := back.(event.LoginAudited)
	if !ok || record.Name() != "auth.LoginAudited" || record.SessionID != "s1" || record.UserAgent != "curl/8.9" {
		t.Fatalf("LoginAudited came back as %#v", back)
	}
}
