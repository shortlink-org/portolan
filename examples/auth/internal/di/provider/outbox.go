package provider

import (
	"fmt"

	"github.com/ThreeDotsLabs/watermill"
	"github.com/google/wire"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shortlink-org/go-sdk/db"
	sdklogger "github.com/shortlink-org/go-sdk/logger"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/policy"
	sessiondomain "github.com/shortlink-org/portolan/examples/auth/internal/domain/session"
	userdomain "github.com/shortlink-org/portolan/examples/auth/internal/domain/user"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/outbox"
)

// Outbox binds the Publisher ports to the outbox and builds the relay that
// reads it back.
//
// This is where the last gap closes. An event now reaches durable storage
// inside the transaction that produced it, so a change cannot commit while the
// fact of it is lost - and nothing above this line had to be told.
var Outbox = wire.NewSet(
	ProvideWatermillLogger,
	outbox.NewMessages,
	outbox.NewUserPublisher,
	wire.Bind(new(userdomain.Publisher), new(*outbox.UserPublisher)),
	outbox.NewSessionPublisher,
	wire.Bind(new(sessiondomain.Publisher), new(*outbox.SessionPublisher)),
	ProvidePool,
	ProvideRelay,
)

// ProvideWatermillLogger bridges watermill's logging onto the SDK's.
func ProvideWatermillLogger(log sdklogger.Logger) watermill.LoggerAdapter {
	return watermill.NewSlogLogger(nil)
}

// ProvidePool hands the relay the pool. It reads on its own, long after
// whatever wrote the row, so it does not want a transaction.
func ProvidePool(store *db.Store) (*pgxpool.Pool, error) {
	pool, err := db.Conn[*pgxpool.Pool](store)
	if err != nil {
		return nil, fmt.Errorf("provider: pool: %w", err)
	}
	return pool, nil
}

// ProvideRelay builds the reader and subscribes the policies to it.
//
// Subscription is assembly, not behaviour: a policy says what to do, this says
// that it is listening. Putting the subscribe call inside the policy would mean
// a rule that switches itself on, and no one place to look to find out what
// this service reacts to.
func ProvideRelay(
	pool *pgxpool.Pool,
	logger watermill.LoggerAdapter,
	revokeSessions *policy.RevokeSessionsOnPasswordChange,
) (*outbox.Relay, error) {
	relay, err := outbox.NewRelay(pool, logger)
	if err != nil {
		return nil, err
	}

	relay.OnUser("revoke-sessions-on-password-change", userevent.TopicPasswordChanged, revokeSessions.Handle)

	return relay, nil
}
