package outbox_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	sdklogger "github.com/shortlink-org/go-sdk/logger"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
	sdkuow "github.com/shortlink-org/go-sdk/uow"
	sdkwatermill "github.com/shortlink-org/go-sdk/watermill"
	"go.opentelemetry.io/otel"

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

type harness struct {
	uow      *uow.UnitOfWork
	users    *outbox.UserPublisher
	sessions *outbox.SessionPublisher
	relay    *sdkoutbox.Relay
}

func setup(t *testing.T) *harness {
	t.Helper()
	ctx := t.Context()

	store, _, unit := postgrestest.StoreWithDB(t,
		postgrestest.Source{FS: userrepo.Migrations, Name: userrepo.Name},
		postgrestest.Source{FS: sdkoutbox.Migrations, Name: "outbox"},
	)

	publisher, err := sdkoutbox.NewPublisher(sdkuow.FromContext)
	if err != nil {
		t.Fatalf("publisher: %v", err)
	}

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	log, _, err := sdklogger.NewDefault(ctx, cfg)
	if err != nil {
		t.Fatalf("logger: %v", err)
	}

	backend := outbox.NewBackend(publisher, unit)
	client, err := sdkwatermill.New(ctx, log, cfg, backend,
		otel.GetMeterProvider(), otel.GetTracerProvider(),
		sdkwatermill.WithPoisonQueue(backend.Publisher(), outbox.TopicDLQ),
	)
	if err != nil {
		t.Fatalf("watermill: %v", err)
	}

	relay, err := sdkoutbox.NewRelay(store, log, client.Router,
		sdkoutbox.WithPollInterval(50*time.Millisecond))
	if err != nil {
		t.Fatalf("relay: %v", err)
	}

	return &harness{uow: unit, users: outbox.NewUserPublisher(publisher),
		sessions: outbox.NewSessionPublisher(publisher), relay: relay}
}

// Publishing outside a unit of work would put the message on its own
// connection: the aggregate could roll back while the fact stayed, which is the
// failure the outbox exists to prevent.
func TestPublishOutsideAUnitOfWorkIsRefused(t *testing.T) {
	h := setup(t)

	err := h.users.Publish(context.Background(),
		[]userevent.Event{userevent.NewUserRegistered("u1", "ada@example.com", now)})

	if !errors.Is(err, sdkoutbox.ErrNoTransaction) {
		t.Fatalf("= %v, want ErrNoTransaction", err)
	}
}

// The whole point: the event and whatever else the unit did commit together, so
// a rollback takes the fact with it.
func TestRollbackTakesTheEvent(t *testing.T) {
	ctx := context.Background()
	h := setup(t)
	boom := errors.New("boom")

	err := h.uow.Do(ctx, func(ctx context.Context) error {
		if err := h.users.Publish(ctx, []userevent.Event{
			userevent.NewUserRegistered("u1", "ada@example.com", now),
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want boom", err)
	}

	if got := deliver(t, h, 0); len(got) != 0 {
		t.Errorf("%d events delivered after a rollback, want none", len(got))
	}
}

// A committed event comes back out, through the same constructors the domain
// uses, with everything it went in with.
func TestRoundTrip(t *testing.T) {
	ctx := context.Background()
	h := setup(t)

	err := h.uow.Do(ctx, func(ctx context.Context) error {
		return h.users.Publish(ctx, []userevent.Event{
			userevent.NewPasswordChanged("u1", "s1", now),
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got := deliver(t, h, 1)
	if len(got) != 1 {
		t.Fatalf("%d events, want 1", len(got))
	}

	changed, ok := got[0].(userevent.PasswordChanged)
	if !ok {
		t.Fatalf("= %T, want PasswordChanged", got[0])
	}
	// The actor survives the round trip. Without it the policy could not tell
	// which session to spare.
	if changed.UserID() != "u1" || changed.By() != "s1" {
		t.Errorf("= %+v", changed)
	}
	if !changed.OccurredAt().Equal(now) {
		t.Errorf("occurredAt = %v, want the domain time %v", changed.OccurredAt(), now)
	}
}

// A topic nobody handles is still writable, and waits rather than blocking the
// topics that do have handlers.
func TestSessionTopicIsWritable(t *testing.T) {
	ctx := context.Background()
	h := setup(t)

	err := h.uow.Do(ctx, func(ctx context.Context) error {
		return h.sessions.Publish(ctx, []sessionevent.Event{
			sessionevent.NewSessionEnded("s1", "u1", sessionevent.ReasonLogout, now),
		})
	})
	if err != nil {
		t.Fatalf("= %v, want the session topic to accept a write", err)
	}
}

// deliver runs the relay until it has seen want events, or briefly if none are
// expected.
func deliver(t *testing.T, h *harness, want int) []userevent.Event {
	t.Helper()

	var got []userevent.Event
	done := make(chan struct{})
	closed := false

	err := outbox.HandleUser(h.relay, map[string]outbox.UserHandler{
		userevent.TopicUserRegistered:  collect(&got, &closed, done, want),
		userevent.TopicPasswordChanged: collect(&got, &closed, done, want),
	})
	if err != nil {
		t.Fatalf("handle: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	go func() { _ = h.relay.Run(ctx) }()

	if want == 0 {
		time.Sleep(2 * time.Second)
		return got
	}

	select {
	case <-done:
	case <-ctx.Done():
		t.Fatalf("only %d of %d events arrived", len(got), want)
	}
	return got
}

func collect(into *[]userevent.Event, closed *bool, done chan struct{}, want int) outbox.UserHandler {
	return func(_ context.Context, e userevent.Event) error {
		*into = append(*into, e)
		if len(*into) >= want && !*closed {
			*closed = true
			close(done)
		}
		return nil
	}
}
