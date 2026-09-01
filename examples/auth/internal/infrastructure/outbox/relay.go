package outbox

import (
	"context"
	"fmt"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkoutbox "github.com/shortlink-org/go-sdk/outbox"

	sessionevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/session/event"
	userevent "github.com/shortlink-org/portolan/examples/auth/internal/domain/user/event"
)

// UserHandler and SessionHandler are what reacts to an event once it has come
// back out of the outbox.
//
// They take a domain event, not a message: whatever reacts to a fact should not
// have to know it spent time in a table.
type (
	UserHandler    func(ctx context.Context, e userevent.Event) error
	SessionHandler func(ctx context.Context, e sessionevent.Event) error
)

// HandleUser registers the user topic with the relay, dispatching by event
// name.
//
// One registration per topic, because the relay allows one - so the dispatch
// lives here rather than in several handlers competing for the same messages.
// The map is the caller's, and assembly is the only place that knows which rule
// listens to which fact.
func HandleUser(relay *sdkoutbox.Relay, byName map[string]UserHandler) error {
	return relay.Handle(TopicUser, func(ctx context.Context, msg *message.Message) error {
		name := msg.Metadata.Get(metadataEventName)

		handle, listening := byName[name]
		if !listening {
			// Nothing reacts to this one. Acknowledged rather than failed:
			// leaving it would block every message behind it, and it is not
			// broken, just uninteresting.
			return nil
		}

		e, err := unmarshalUser(msg)
		if err != nil {
			return fmt.Errorf("outbox: %s: %w", name, err)
		}
		if e == nil {
			// A name this build does not know. Same treatment: let it pass.
			return nil
		}

		return handle(ctx, e)
	})
}

// HandleSession registers the session topic with the relay.
func HandleSession(relay *sdkoutbox.Relay, byName map[string]SessionHandler) error {
	return relay.Handle(TopicSession, func(ctx context.Context, msg *message.Message) error {
		name := msg.Metadata.Get(metadataEventName)

		handle, listening := byName[name]
		if !listening {
			return nil
		}

		e, err := unmarshalSession(msg)
		if err != nil {
			return fmt.Errorf("outbox: %s: %w", name, err)
		}
		if e == nil {
			return nil
		}

		return handle(ctx, e)
	})
}
