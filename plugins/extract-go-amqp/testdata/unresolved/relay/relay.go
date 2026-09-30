package relay

import (
	"os"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Row is an outbox row: its route is data, not a declaration.
type Row struct {
	Exchange string
	Key      string
}

func Deliver(ch *amqp.Channel, row Row) error {
	return ch.Publish(row.Exchange, row.Key, false, false, amqp.Publishing{})
}

func Listen(ch *amqp.Channel) error {
	_, err := ch.Consume(os.Getenv("QUEUE"), "", false, false, false, false, nil)
	return err
}

func Orphan(ch *amqp.Channel) error {
	q, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		return err
	}
	_, err = ch.Consume(q.Name, "", true, false, false, false, nil)
	return err
}

// Outbox is the service's own publisher; its Publish is not amqp's.
type Outbox struct{}

func (Outbox) Publish(exchange, key string) {}

func Local() {
	Outbox{}.Publish("not.amqp", "not.amqp")
}
