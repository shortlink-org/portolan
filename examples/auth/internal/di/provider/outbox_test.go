package provider_test

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	sdkconfig "github.com/shortlink-org/go-sdk/config"
	"github.com/shortlink-org/go-sdk/db"
	sdklogger "github.com/shortlink-org/go-sdk/logger"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
	sdkuow "github.com/shortlink-org/go-sdk/uow"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/policy"
	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/end_after_credential_change"
	"github.com/shortlink-org/portolan/examples/auth/internal/di/provider"
	lockoutevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	lockoutrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/lockout"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/postgrestest"
)

var change = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	code := m.Run()
	postgrestest.Stop()
	os.Exit(code)
}

// seen counts what came off each bus, by event name.
type seen struct {
	mu    sync.Mutex
	names map[string]int
}

func (s *seen) add(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.names[name]++
}

func (s *seen) count(name string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.names[name]
}

// Three domains write the outbox and one relay reads it. This test wires the
// relay the way assembly does and checks that everything written comes back
// out: a topic nobody registered is a topic whose rows stay pending for good,
// and that is exactly the failure that is not visible from any one package.
func TestEverythingWrittenToTheOutboxIsRead(t *testing.T) {
	ctx := context.Background()

	store, router, unit := postgrestest.StoreWithDB(t,
		postgrestest.Source{FS: sessionrepo.Migrations, Name: sessionrepo.Name},
		postgrestest.Source{FS: sdkoutbox.Migrations, Name: "outbox"},
	)

	appended, err := sdkoutbox.NewPublisher(sdkuow.FromContext)
	if err != nil {
		t.Fatalf("publisher: %v", err)
	}
	users := userrepo.NewPublisher(appended)
	sessions := sessionrepo.NewPublisher(appended)
	lockouts := lockoutrepo.NewPublisher(appended)

	// The session store publishes through the outbox, as in the service, so
	// the policy's own effect - SessionEnded - has to make the round trip too.
	sessionStore := sessionrepo.NewPostgres(router, unit, sessions)
	revoke := policy.New(end_after_credential_change.New(sessionStore, func() time.Time { return change }))

	buses := provider.ProvideBuses(revoke)
	got := &seen{names: map[string]int{}}
	buses.Users.Subscribe("", func(_ context.Context, e userevent.Event) error { got.add(e.Name()); return nil })
	buses.Sessions.Subscribe("", func(_ context.Context, e sessionevent.Event) error { got.add(e.Name()); return nil })
	buses.Lockouts.Subscribe("", func(_ context.Context, e lockoutevent.Event) error { got.add(e.Name()); return nil })

	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	log, _, err := sdklogger.NewDefault(ctx, cfg)
	if err != nil {
		t.Fatalf("logger: %v", err)
	}
	backend := messaging.NewBackend(appended, unit)
	client, err := provider.ProvideWatermill(cfg, log, backend)
	if err != nil {
		t.Fatalf("watermill: %v", err)
	}
	relay, err := provider.ProvideRelay(store, log, client, buses)
	if err != nil {
		t.Fatalf("relay: %v", err)
	}

	// One fact from every domain, and the one a policy reacts to.
	issued := change.Add(-time.Hour)
	s1, started, err := session.Start("s1", "u1", issued)
	if err != nil {
		t.Fatal(err)
	}
	if err := sessionStore.Save(ctx, s1, started); err != nil {
		t.Fatal(err)
	}
	err = unit.Do(ctx, func(ctx context.Context) error {
		if err := users.Publish(ctx, []userevent.Event{
			userevent.NewUserRegistered("u1", "ada@example.com", issued),
			userevent.NewPasswordChanged("u1", "", change),
		}); err != nil {
			return err
		}
		return lockouts.Publish(ctx, []lockoutevent.Event{
			lockoutevent.NewAccountLocked("u2", change.Add(15*time.Minute), change),
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	runCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	go func() { _ = relay.Run(runCtx) }()

	pool, err := db.Conn[*pgxpool.Pool](store)
	if err != nil {
		t.Fatal(err)
	}
	for pending(t, pool) != 0 {
		if runCtx.Err() != nil {
			t.Fatalf("%d rows still pending after the relay ran; seen %v", pending(t, pool), got.names)
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Nothing pending is only the necessary half: a delivery that acknowledged
	// without handing anything over would pass it too.
	want := map[string]int{
		userevent.TopicUserRegistered:    1,
		userevent.TopicPasswordChanged:   1,
		sessionevent.TopicSessionStarted: 1,
		sessionevent.TopicSessionEnded:   1, // the policy's doing
		lockoutevent.TopicAccountLocked:  1,
	}
	for name, n := range want {
		if got.count(name) != n {
			t.Errorf("%s came off the bus %d times, want %d", name, got.count(name), n)
		}
	}

	// And the policy really did run off the bus, not off the table.
	after, err := sessionStore.ByID(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if after.Live(change.Add(time.Minute)) {
		t.Error("the session issued against the old password is still live")
	}
}

func pending(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE delivered_at IS NULL`).Scan(&n); err != nil {
		t.Fatalf("counting pending rows: %v", err)
	}
	return n
}
