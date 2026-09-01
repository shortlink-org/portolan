package services_test

import (
	"testing"
	"time"

	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session/services"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func at(t *testing.T, id string, issued time.Time) *session.Session {
	t.Helper()
	s, _, err := session.Start(id, "u1", issued)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func ids(sessions []*session.Session) []string {
	out := make([]string, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, s.ID)
	}
	return out
}

func TestEndsSessionsOlderThanTheChange(t *testing.T) {
	older := at(t, "older", change.Add(-time.Hour))
	c := services.CredentialChange{At: change}

	got := ids(c.Ends([]*session.Session{older}, change))
	if len(got) != 1 || got[0] != "older" {
		t.Fatalf("= %v, want [older]", got)
	}
}

// The reason ChangedAt comes from the event and not from the clock. Somebody
// who signs in with the NEW password while this is being delivered holds a
// session the change has no business ending.
func TestSessionsStartedAfterTheChangeSurvive(t *testing.T) {
	before := at(t, "before", change.Add(-time.Hour))
	after := at(t, "after", change.Add(time.Second))

	got := ids(services.CredentialChange{At: change}.Ends(
		[]*session.Session{before, after}, change.Add(time.Minute)))

	if len(got) != 1 || got[0] != "before" {
		t.Fatalf("= %v, want only [before]", got)
	}
}

// The choice made for this service: the device the password was changed from
// stays signed in.
func TestTheKeptSessionSurvives(t *testing.T) {
	laptop := at(t, "laptop", change.Add(-time.Hour))
	phone := at(t, "phone", change.Add(-time.Hour))

	got := ids(services.CredentialChange{At: change, Keep: "laptop"}.Ends(
		[]*session.Session{laptop, phone}, change))

	if len(got) != 1 || got[0] != "phone" {
		t.Fatalf("= %v, want only [phone]", got)
	}
}

// An empty Keep spares nothing - what an administrative reset wants.
func TestNoKeepSparesNothing(t *testing.T) {
	laptop := at(t, "laptop", change.Add(-time.Hour))
	phone := at(t, "phone", change.Add(-time.Hour))

	got := services.CredentialChange{At: change}.Ends([]*session.Session{laptop, phone}, change)
	if len(got) != 2 {
		t.Fatalf("= %v, want both", ids(got))
	}
}

// Ending something already dead would publish a SessionEnded that reports
// nothing. An event for a non-event is worse than no event.
func TestAlreadyDeadSessionsAreLeftAlone(t *testing.T) {
	revoked := at(t, "revoked", change.Add(-time.Hour))
	revoked.Revoke(event.ReasonLogout, change.Add(-time.Minute))

	expired := at(t, "expired", change.Add(-2*session.TTL))

	live := at(t, "live", change.Add(-time.Hour))

	got := ids(services.CredentialChange{At: change}.Ends(
		[]*session.Session{revoked, expired, live}, change))

	if len(got) != 1 || got[0] != "live" {
		t.Fatalf("= %v, want only [live]", got)
	}
}

func TestNothingToEnd(t *testing.T) {
	c := services.CredentialChange{At: change}
	if got := c.Ends(nil, change); len(got) != 0 {
		t.Errorf("= %v, want nothing", ids(got))
	}
	if got := c.Ends([]*session.Session{nil}, change); len(got) != 0 {
		t.Errorf("a nil session is not a session, got %v", ids(got))
	}
}
