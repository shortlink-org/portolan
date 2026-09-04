package bus

import (
	"context"

	"github.com/nats-io/nats.go"
)

// NATS publishes on the subject the event names, with its wire name in the
// headers, so a subscriber dispatches without parsing the payload.
type NATS struct {
	conn *nats.Conn
}

func NewNATS(conn *nats.Conn) *NATS {
	return &NATS{conn: conn}
}

func (b *NATS) Publish(ctx context.Context, topic, name, payload string) error {
	message := nats.NewMsg(topic)
	message.Header.Set("Event-Name", name)
	message.Data = []byte(payload)

	return b.conn.PublishMsg(message)
}

// Subscribe hands over only the messages named, which is what keeps a policy
// from being woken by every event on the subject.
func (b *NATS) Subscribe(ctx context.Context, topic, name string, handler func(context.Context, []byte) error) error {
	_, err := b.conn.Subscribe(topic, func(message *nats.Msg) {
		if message.Header.Get("Event-Name") != name {
			return
		}
		_ = handler(ctx, message.Data)
	})

	return err
}
