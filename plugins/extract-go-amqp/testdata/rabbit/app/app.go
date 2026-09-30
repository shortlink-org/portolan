package app

import (
	"context"

	amqp "github.com/rabbitmq/amqp091-go"

	"example.com/orders/bus"
)

const (
	Events = "shop.events"
	Logs   = "logs"
)

type App struct {
	bus bus.Bus
}

// Declare sets the topology up: a topic exchange for domain events and a
// fanout one for logs.
func Declare(ch *amqp.Channel) error {
	if err := ch.ExchangeDeclare(Events, amqp.ExchangeTopic, true, false, false, false, nil); err != nil {
		return err
	}
	return ch.ExchangeDeclare(Logs, "fanout", true, false, false, false, nil)
}

func Start(ctx context.Context, ch *amqp.Channel) error {
	_ = bus.NewRabbit(ch, Events)
	app := &App{}
	if err := app.bus.Publish(ctx, "order.cancelled", "orders.OrderCancelled", nil); err != nil {
		return err
	}
	if err := ch.PublishWithContext(ctx, Events, "order.placed", false, false, amqp.Publishing{}); err != nil {
		return err
	}
	return ch.Publish(Logs, "ignored", false, false, amqp.Publishing{})
}

// Mail sends straight to a queue through the default exchange.
func Mail(ch *amqp.Channel) error {
	q, err := ch.QueueDeclare("emails", true, false, false, false, nil)
	if err != nil {
		return err
	}
	return ch.Publish("", q.Name, false, false, amqp.Publishing{})
}
