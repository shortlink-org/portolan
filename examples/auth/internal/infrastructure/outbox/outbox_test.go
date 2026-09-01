package outbox_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/ThreeDotsLabs/watermill"

	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/outbox"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/postgrestest"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/uow"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

func setup(t *testing.T) (*uow.UnitOfWork, *outbox.UserPublisher, *outbox.SessionPublisher, *outbox.Relay) {
	t.Helper()

	router, unit := postgrestest.Store(t, postgrestest.Source{FS: userrepo.Migrations, Name: userrepo.Name})
	pool := router.Primary()

	logger := watermill.NopLogger{}
	messages := outbox.NewMessages(logger)

	relay, err := outbox.NewRelay(pool, logger)
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	t.Cleanup(func() { _ = relay.Close() })

	return unit, outbox.NewUserPublisher(messages), outbox.NewSessionPublisher(messages), relay
}

// Publishing outside a unit of work would put the message on its own
// connection: the aggregate could roll back while the fact stayed, which is the
// failure the outbox exists to prevent.
func TestPublishOutsideAUnitOfWorkIsRefused(t *testing.T) {
	_, users, _, _ := setup(t)

	err := users.Publish(context.Background(),
		[]userevent.Event{userevent.NewUserRegistered("u1", "ada@example.com", now)})

	if !errors.Is(err, outbox.ErrNoTransaction) {
		t.Fatalf("= %v, want ErrNoTransaction", err)
	}
}

// The whole point: the event and whatever else the unit did commit together, so
// a rollback takes the fact with it.
func TestRollbackTakesTheEvent(t *testing.T) {
	ctx := context.Background()
	unit, users, _, relay := setup(t)
	boom := errors.New("boom")

	err := unit.Do(ctx, func(ctx context.Context) error {
		if err := users.Publish(ctx, []userevent.Event{
			userevent.NewUserRegistered("u1", "ada@example.com", now),
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want boom", err)
	}

	if got := deliver(t, relay, outbox.TopicUser, 0); len(got) != 0 {
		t.Errorf("%d events delivered after a rollback, want none", len(got))
	}
}

// A committed event comes back out, through the same constructors the domain
// uses, with everything it went in with.
func TestRoundTrip(t *testing.T) {
	ctx := context.Background()
	unit, users, _, relay := setup(t)

	err := unit.Do(ctx, func(ctx context.Context) error {
		return users.Publish(ctx, []userevent.Event{
			userevent.NewUserRegistered("u1", "ada@example.com", now),
			userevent.NewPasswordChanged("u1", "s1", now.Add(time.Minute)),
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got := deliver(t, relay, outbox.TopicUser, 2)
	if len(got) != 2 {
		t.Fatalf("%d events, want 2", len(got))
	}

	registered, ok := got[0].(userevent.UserRegistered)
	if !ok {
		t.Fatalf("first = %T, want UserRegistered", got[0])
	}
	if registered.UserID() != "u1" || registered.Email() != "ada@example.com" {
		t.Errorf("first = %+v", registered)
	}
	if !registered.OccurredAt().Equal(now) {
		t.Errorf("occurredAt = %v, want the domain time %v", registered.OccurredAt(), now)
	}

	changed, ok := got[1].(userevent.PasswordChanged)
	if !ok {
		t.Fatalf("second = %T, want PasswordChanged", got[1])
	}
	// The actor survives the round trip. Without it the policy could not tell
	// which session to spare.
	if changed.By() != "s1" {
		t.Errorf("by = %q, want s1", changed.By())
	}
}

// A topic nobody subscribes to still has to be writable, or the first session
// event would fail on a missing table.
func TestSessionTopicIsWritable(t *testing.T) {
	ctx := context.Background()
	unit, _, sessions, _ := setup(t)

	err := unit.Do(ctx, func(ctx context.Context) error {
		return sessions.Publish(ctx, []sessionevent.Event{
			sessionevent.NewSessionEnded("s1", "u1", sessionevent.ReasonLogout, now),
		})
	})
	if err != nil {
		t.Fatalf("= %v, want the session topic to accept a write", err)
	}
}

// deliver runs the relay until it has seen  events, or briefly if none
// are expected.
func deliver(t *testing.T, relay *outbox.Relay, topic string, want int) []userevent.Event {
	t.Helper()

	var got []userevent.Event
	done := make(chan struct{})
	var closeOnce bool

	relay.OnUser("test", "", func(_ context.Context, e userevent.Event) error {
		got = append(got, e)
		if len(got) >= want && !closeOnce {
			closeOnce = true
			close(done)
		}
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	go func() { _ = relay.Run(ctx) }()

	if want == 0 {
		time.Sleep(time.Second)
		return got
	}

	select {
	case <-done:
	case <-ctx.Done():
		t.Fatalf("only %d of %d events arrived", len(got), want)
	}
	return got
}
