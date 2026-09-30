package bus

import (
	"context"

	"github.com/segmentio/kafka-go"
)

// Bus is the port the application publishes through.
type Bus interface {
	Publish(ctx context.Context, topic, name string, payload []byte) error
}

// Kafka writes each message to the topic the message names.
type Kafka struct {
	writer *kafka.Writer
}

func NewKafka(brokers ...string) *Kafka {
	return &Kafka{writer: &kafka.Writer{Addr: kafka.TCP(brokers...)}}
}

func (k *Kafka) Publish(ctx context.Context, topic, name string, payload []byte) error {
	return k.writer.WriteMessages(ctx, kafka.Message{Topic: topic, Value: payload})
}

// Shipments has one writer for one topic, handed in by the assembly.
type Shipments struct {
	writer *kafka.Writer
}

func NewShipments(topic string, brokers ...string) *Shipments {
	return &Shipments{writer: &kafka.Writer{Addr: kafka.TCP(brokers...), Topic: topic}}
}
