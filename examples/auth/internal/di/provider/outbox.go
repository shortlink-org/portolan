package provider

import (
	"context"
	"fmt"

	"github.com/google/wire"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
	sdkdb "github.com/shortlink-org/go-sdk/db"
	sdklogger "github.com/shortlink-org/go-sdk/logger"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"
	sdkuow "github.com/shortlink-org/go-sdk/uow"
	sdkwatermill "github.com/shortlink-org/go-sdk/watermill"
	"go.opentelemetry.io/otel"

	lockoutdomain "github.com/shortlink-org/portolan/examples/auth/internal/domain/lockout"
	sessiondomain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	userdomain "github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	lockoutrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/lockout"
	sessionrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/session"
	userrepo "github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/repository/user"
	"github.com/shortlink-org/portolan/examples/auth/internal/pkg/messaging"
)

// Outbox binds the Publisher ports to the outbox and builds the relay that
// reads it back.
//
// This is where the last gap closes. An event reaches durable storage inside
// the transaction that produced it, so a change cannot commit while the fact of
// it is lost - and nothing above this line had to be told. What the relay
// reads it hands to the buses in bus.go; the policies are subscribed there.
var Outbox = wire.NewSet(
	ProvideOutboxPublisher,
	messaging.NewBackend,
	userrepo.NewPublisher,
	wire.Bind(new(userdomain.Publisher), new(*userrepo.Publisher)),
	sessionrepo.NewPublisher,
	wire.Bind(new(sessiondomain.Publisher), new(*sessionrepo.Publisher)),
	lockoutrepo.NewPublisher,
	wire.Bind(new(lockoutdomain.Publisher), new(*lockoutrepo.Publisher)),
	ProvideWatermill,
	ProvideRelay,
)

// ProvideOutboxPublisher hands the outbox the same transaction lookup the
// database driver was given. Both find the transaction in the same place, which
// is why a write and the event describing it end up in the same one.
func ProvideOutboxPublisher() (*sdkoutbox.Publisher, error) {
	publisher, err := sdkoutbox.NewPublisher(sdkuow.FromContext)
	if err != nil {
		return nil, fmt.Errorf("provider: outbox publisher: %w", err)
	}
	return publisher, nil
}

// ProvideWatermill builds the router and its middleware.
//
// The poison queue is configured here rather than added afterwards: the SDK
// places it outside retry, and a middleware added after New would land inside
// retry instead. Poison publishes the dead letter and then reports success, so
// underneath retry it would report success on the first failure and nothing
// would ever be retried.
func ProvideWatermill(
	cfg *sdkconfig.Config,
	log sdklogger.Logger,
	backend *messaging.Backend,
) (*sdkwatermill.Client, error) {
	client, err := sdkwatermill.New(
		context.Background(), log, cfg, backend,
		otel.GetMeterProvider(), otel.GetTracerProvider(),
		sdkwatermill.WithPoisonQueue(backend.Publisher(), messaging.TopicDLQ),
	)
	if err != nil {
		return nil, fmt.Errorf("provider: watermill: %w", err)
	}
	return client, nil
}

// ProvideRelay builds the reader and connects every topic to its bus.
//
// Every topic, not only the ones a policy listens to. The outbox is written by
// three domains and read by one relay, and a topic nobody registered is a
// topic nobody reads: its rows would stay pending for good, growing with every
// login and every lock, while the reaper only ever clears delivered rows. So
// each domain that can write here is read here, and what happens to an event
// afterwards - a policy, nothing yet - is the bus's business, decided in
// ProvideBuses.
func ProvideRelay(
	store *sdkdb.Store,
	log sdklogger.Logger,
	client *sdkwatermill.Client,
	buses *Buses,
) (*sdkoutbox.Relay, error) {
	relay, err := sdkoutbox.NewRelay(store, log, client.Router)
	if err != nil {
		return nil, fmt.Errorf("provider: relay: %w", err)
	}

	if err := userrepo.Handle(relay, buses.Users); err != nil {
		return nil, fmt.Errorf("provider: relay: %w", err)
	}
	if err := sessionrepo.Handle(relay, buses.Sessions); err != nil {
		return nil, fmt.Errorf("provider: relay: %w", err)
	}
	if err := lockoutrepo.Handle(relay, buses.Lockouts); err != nil {
		return nil, fmt.Errorf("provider: relay: %w", err)
	}

	return relay, nil
}
