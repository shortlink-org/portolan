package user_test

import (
	"context"
	"errors"
	"testing"
	"time"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	sdklogger "github.com/shortlink-org/go-sdk/logger"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
	sdkuow "github.com/shortlink-org/go-sdk/uow"
	sdkwatermill "github.com/shortlink-org/go-sdk/watermill"
	"go.opentelemetry.io/otel"

	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	repo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/uow"
)

type outboxHarness struct {
	uow       *uow.UnitOfWork
	publisher *repo.Publisher
	relay     *sdkoutbox.Relay
}

func outboxSetup(t *testing.T) *outboxHarness {
	t.Helper()
	ctx := t.Context()

	store, _, unit := postgrestest.StoreWithDB(t,
		postgrestest.Source{FS: repo.Migrations, Name: repo.Name},
		postgrestest.Source{FS: sdkoutbox.Migrations, Name: "outbox"},
	)

	appended, err := sdkoutbox.NewPublisher(sdkuow.FromContext)
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

	backend := messaging.NewBackend(appended, unit)
	client, err := sdkwatermill.New(ctx, log, cfg, backend,
		otel.GetMeterProvider(), otel.GetTracerProvider(),
		sdkwatermill.WithPoisonQueue(backend.Publisher(), messaging.TopicDLQ),
	)
	if err != nil {
		t.Fatalf("watermill: %v", err)
	}

	relay, err := sdkoutbox.NewRelay(store, log, client.Router,
		sdkoutbox.WithPollInterval(50*time.Millisecond))
	if err != nil {
		t.Fatalf("relay: %v", err)
	}

	return &outboxHarness{uow: unit, publisher: repo.NewPublisher(appended), relay: relay}
}

// Publishing outside a unit of work would put the message on its own
// connection: the aggregate could roll back while the fact stayed, which is the
// failure the outbox exists to prevent.
func TestPublishOutsideAUnitOfWorkIsRefused(t *testing.T) {
	h := outboxSetup(t)

	err := h.publisher.Publish(context.Background(),
		[]userevent.Event{userevent.NewUserRegistered("u1", "ada@example.com", now)})

	if !errors.Is(err, sdkoutbox.ErrNoTransaction) {
		t.Fatalf("= %v, want ErrNoTransaction", err)
	}
}

// The event and whatever else the unit did commit together, so a rollback takes
// the fact with it.
func TestRollbackTakesTheEvent(t *testing.T) {
	ctx := context.Background()
	h := outboxSetup(t)
	boom := errors.New("boom")

	err := h.uow.Do(ctx, func(ctx context.Context) error {
		if err := h.publisher.Publish(ctx, []userevent.Event{
			userevent.NewUserRegistered("u1", "ada@example.com", now),
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("= %v, want boom", err)
	}

	if got := delivered(t, h, 0); len(got) != 0 {
		t.Errorf("%d events delivered after a rollback, want none", len(got))
	}
}

// A committed event comes back out through the same constructors the domain
// uses, with everything it went in with.
func TestRoundTrip(t *testing.T) {
	ctx := context.Background()
	h := outboxSetup(t)

	err := h.uow.Do(ctx, func(ctx context.Context) error {
		return h.publisher.Publish(ctx, []userevent.Event{
			userevent.NewPasswordChanged("u1", "s1", now),
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got := delivered(t, h, 1)
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

// delivered runs the relay until it has seen want events, or briefly if none
// are expected.
func delivered(t *testing.T, h *outboxHarness, want int) []userevent.Event {
	t.Helper()

	var got []userevent.Event
	done := make(chan struct{})
	closed := false

	collect := func(_ context.Context, e userevent.Event) error {
		got = append(got, e)
		if len(got) >= want && !closed {
			closed = true
			close(done)
		}
		return nil
	}

	err := repo.Handle(h.relay, map[string]repo.Handler{
		userevent.TopicUserRegistered:  collect,
		userevent.TopicPasswordChanged: collect,
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
