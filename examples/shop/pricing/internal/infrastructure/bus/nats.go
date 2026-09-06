package bus

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// duplicateWindow is how long a stream remembers a message id: the same two
// hours the cart creates its stream with, so that whichever service names the
// stream first, it is the same stream.
const duplicateWindow = 2 * time.Hour

// NATS is the bus over JetStream: the way an event leaves this process for
// another, and the way the cart's checkout reaches the policy waiting for it.
//
// One stream per context and aggregate family, `shop-cart` over `shop.cart.>`,
// created by whoever publishes or subscribes first and shared after that. A
// subscriber is a durable consumer named after the service and the event, so a
// service that was down reads what it missed.
type NATS struct {
	name string
	conn *nats.Conn
	js   jetstream.JetStream
	subs []jetstream.ConsumeContext
}

// ConnectNATS opens the connection and JetStream over it. name is what the
// server sees the connection as and what the durable consumers are named
// after; two services must not share it.
func ConnectNATS(url, name string) (*NATS, error) {
	conn, err := nats.Connect(url, nats.Name(name))
	if err != nil {
		return nil, fmt.Errorf("nats: connect %s: %w", url, err)
	}

	js, err := jetstream.New(conn)
	if err != nil {
		conn.Close()

		return nil, fmt.Errorf("nats: jetstream: %w", err)
	}

	return &NATS{name: name, conn: conn, js: js}, nil
}

// Publish is at least once, like the relay: a repeat within the window is
// acknowledged as a duplicate and stored once.
func (b *NATS) Publish(ctx context.Context, m Message) error {
	if _, err := b.stream(ctx, m.Topic); err != nil {
		return err
	}

	msg := nats.NewMsg(m.Topic)
	msg.Data = m.Payload
	// Set as written: a header key is case-sensitive on the wire, and
	// `event_name` is what the cart and the OMS look for.
	msg.Header[jetstream.MsgIDHeader] = []string{m.UUID}
	for key, value := range m.Metadata {
		msg.Header[key] = []string{value}
	}

	if _, err := b.js.PublishMsg(ctx, msg); err != nil {
		return fmt.Errorf("nats: publish %s on %s: %w", m.Name(), m.Topic, err)
	}

	return nil
}

// Subscribe reads topic through a durable consumer and hands the handler the
// messages named name. A message with another name is acknowledged unread; one
// the handler could not take is left for redelivery.
func (b *NATS) Subscribe(ctx context.Context, topic, name string, handler Handler) error {
	stream, err := b.stream(ctx, topic)
	if err != nil {
		return err
	}

	durable := b.name + "-" + strings.ReplaceAll(name, ".", "-")
	consumer, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:       durable,
		FilterSubject: topic,
		AckPolicy:     jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return fmt.Errorf("nats: consumer %s: %w", durable, err)
	}

	consuming, err := consumer.Consume(func(msg jetstream.Msg) {
		m := decode(msg)
		if m.Name() != name {
			_ = msg.Ack()

			return
		}

		if err := handler(ctx, m); err != nil {
			log.Printf("nats: %s on %s: %v", name, topic, err)
			_ = msg.Nak()

			return
		}

		_ = msg.Ack()
	})
	if err != nil {
		return fmt.Errorf("nats: consume %s: %w", durable, err)
	}

	b.subs = append(b.subs, consuming)

	return nil
}

// Close stops the consumers and drains the connection, so a message taken is
// acknowledged or given back before the process goes.
func (b *NATS) Close() error {
	for _, sub := range b.subs {
		sub.Stop()
	}

	return b.conn.Drain()
}

// stream is the one the subject belongs to, created if this is the first
// service to name it. An existing stream is taken as it is: the cart made it
// with the same config, and a config that drifted is not this service's to
// overwrite.
func (b *NATS) stream(ctx context.Context, subject string) (jetstream.Stream, error) {
	name, subjects := streamOf(subject)

	stream, err := b.js.Stream(ctx, name)
	if err == nil {
		return stream, nil
	}
	if !errors.Is(err, jetstream.ErrStreamNotFound) {
		return nil, fmt.Errorf("nats: stream %s: %w", name, err)
	}

	stream, err = b.js.CreateStream(ctx, jetstream.StreamConfig{
		Name:       name,
		Subjects:   []string{subjects},
		Duplicates: duplicateWindow,
	})
	if errors.Is(err, jetstream.ErrStreamNameAlreadyInUse) {
		// Somebody else got there between the two calls; theirs is the one.
		stream, err = b.js.Stream(ctx, name)
	}
	if err != nil {
		return nil, fmt.Errorf("nats: create stream %s: %w", name, err)
	}

	return stream, nil
}

// streamOf names the stream a subject lives in, the way the cart and the OMS
// do: the first two segments, dashed, over everything under them.
// `shop.cart.basket` → `shop-cart` over `shop.cart.>`.
func streamOf(subject string) (name, subjects string) {
	parts := strings.Split(subject, ".")
	if len(parts) > 2 {
		parts = parts[:2]
	}

	return strings.Join(parts, "-"), strings.Join(parts, ".") + ".>"
}

// decode is the message as the port sees it: the id out of its header, the
// rest of the headers as metadata.
func decode(msg jetstream.Msg) Message {
	m := Message{Topic: msg.Subject(), Payload: msg.Data(), Metadata: map[string]string{}}
	for key, values := range msg.Headers() {
		if len(values) == 0 {
			continue
		}
		if key == jetstream.MsgIDHeader {
			m.UUID = values[0]

			continue
		}
		m.Metadata[key] = values[0]
	}

	return m
}
