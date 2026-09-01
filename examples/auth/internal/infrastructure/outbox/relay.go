package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/ThreeDotsLabs/watermill"
	wsql "github.com/ThreeDotsLabs/watermill-sql/v4/pkg/sql"
	"github.com/ThreeDotsLabs/watermill/message"
	"github.com/ThreeDotsLabs/watermill/message/router/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

// UserHandler and SessionHandler are what a subscriber does with an event once
// it has come back out of the store.
//
// They take a domain event, not a message: what reacts to a fact should not
// have to know it spent time in a table.
type (
	UserHandler    func(ctx context.Context, e userevent.Event) error
	SessionHandler func(ctx context.Context, e sessionevent.Event) error
)

// Relay reads the outbox and hands what it finds to the handlers.
//
// It is a separate step from writing on purpose. The write is part of a
// transaction and must be quick and certain; delivery can be slow, can fail,
// and can be retried, and none of that should be able to fail the change that
// produced the event.
type Relay struct {
	router     *message.Router
	subscriber *wsql.Subscriber
}

// NewRelay builds the reader. `pool` is the connection pool rather than a
// transaction: this side runs on its own, long after whatever wrote the row.
func NewRelay(pool *pgxpool.Pool, logger watermill.LoggerAdapter) (*Relay, error) {
	subscriber, err := wsql.NewSubscriber(
		wsql.BeginnerFromPgx(pool),
		wsql.SubscriberConfig{
			// How long a change waits before whatever reacts to it sees it.
			// This is the window the outbox buys at: the price of a fact that
			// cannot be lost is a fact that arrives late.
			PollInterval: 200 * time.Millisecond,
			// One consumer group, because there is one reader. A second reader
			// wanting every message would need its own name, or the two would
			// share the messages between them rather than both seeing them.
			ConsumerGroup:  "auth",
			SchemaAdapter:  schema(),
			OffsetsAdapter: offsets(),
			// Tables are made explicitly below instead, so that a topic
			// nobody subscribes to still has somewhere to be written.
			InitializeSchema: false,
		},
		logger,
	)
	if err != nil {
		return nil, fmt.Errorf("outbox: subscriber: %w", err)
	}

	router, err := message.NewRouter(message.RouterConfig{}, logger)
	if err != nil {
		return nil, fmt.Errorf("outbox: router: %w", err)
	}

	// A handler that fails gets the message again rather than losing it. The
	// message is still in the table until it is acked, so this is a retry in
	// the honest sense: nothing has been thrown away.
	router.AddMiddleware(
		middleware.Recoverer,
		middleware.CorrelationID,
	)

	// Every topic gets its tables now, whether or not anything subscribes to
	// it. The publisher runs inside somebody else's transaction and cannot
	// create them - a CREATE TABLE there would commit that transaction out from
	// under its owner - so a topic nobody reads would have nowhere to be
	// written and the first publish would fail.
	for _, topic := range []string{TopicUser, TopicSession} {
		if err := subscriber.SubscribeInitialize(topic); err != nil {
			return nil, fmt.Errorf("outbox: preparing %s: %w", topic, err)
		}
	}

	return &Relay{router: router, subscriber: subscriber}, nil
}

// OnUser subscribes a handler to one event of the user domain. `name` is an
// event name; the empty string takes them all.
func (r *Relay) OnUser(handlerName, name string, handle UserHandler) {
	r.router.AddNoPublisherHandler(handlerName, TopicUser, r.subscriber,
		func(msg *message.Message) error {
			if name != "" && msg.Metadata.Get(metadataEventName) != name {
				return nil
			}

			e, err := unmarshalUser(msg)
			if err != nil {
				return err
			}
			if e == nil {
				// A name this build does not know. Letting it pass keeps the
				// topic moving; failing would block every later message behind
				// one this service was never meant to read.
				return nil
			}
			return handle(msg.Context(), e)
		})
}

// OnSession subscribes a handler to one event of the session domain.
func (r *Relay) OnSession(handlerName, name string, handle SessionHandler) {
	r.router.AddNoPublisherHandler(handlerName, TopicSession, r.subscriber,
		func(msg *message.Message) error {
			if name != "" && msg.Metadata.Get(metadataEventName) != name {
				return nil
			}

			e, err := unmarshalSession(msg)
			if err != nil {
				return err
			}
			if e == nil {
				return nil
			}
			return handle(msg.Context(), e)
		})
}

// Run reads until the context is cancelled. It blocks.
func (r *Relay) Run(ctx context.Context) error {
	return r.router.Run(ctx)
}

// Running closes once the relay is reading, so a caller - a test, most of all -
// can wait rather than sleep.
func (r *Relay) Running() chan struct{} {
	return r.router.Running()
}

// Close stops the relay.
func (r *Relay) Close() error {
	return r.router.Close()
}
