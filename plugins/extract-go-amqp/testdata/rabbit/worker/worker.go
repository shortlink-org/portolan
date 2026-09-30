package worker

import (
	"context"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Billing reads a named queue bound to the events exchange by key.
func Billing(ctx context.Context, conn *amqp.Connection) error {
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	if err := ch.QueueBind("billing.orders", "order.placed", "shop.events", false, nil); err != nil {
		return err
	}
	_, err = ch.ConsumeWithContext(ctx, "billing.orders", "billing", false, false, false, false, nil)
	return err
}

// Tail reads every log line through a queue the server names.
func Tail(ch *amqp.Channel) error {
	q, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		return err
	}
	if err := ch.QueueBind(q.Name, "", "logs", false, nil); err != nil {
		return err
	}
	_, err = ch.Consume(q.Name, "", true, false, false, false, nil)
	return err
}

// Mailer reads the emails queue, which nothing binds: the default exchange
// delivers to it by name.
func Mailer(ch *amqp.Channel) error {
	_, err := ch.Consume("emails", "mailer", false, false, false, false, nil)
	return err
}
