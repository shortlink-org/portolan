package bus

import (
	"context"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Bus is the port the application publishes through.
type Bus interface {
	Publish(ctx context.Context, key, name string, body []byte) error
}

// Rabbit publishes every event to one exchange, handed in by the assembly.
type Rabbit struct {
	ch       *amqp.Channel
	exchange string
}

func NewRabbit(ch *amqp.Channel, exchange string) *Rabbit {
	return &Rabbit{ch: ch, exchange: exchange}
}

func (r *Rabbit) Publish(ctx context.Context, key, name string, body []byte) error {
	return r.ch.PublishWithContext(ctx, r.exchange, key, false, false, amqp.Publishing{Body: body})
}
