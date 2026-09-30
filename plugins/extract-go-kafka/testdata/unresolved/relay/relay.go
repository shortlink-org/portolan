package relay

import (
	"context"
	"os"
	"strings"

	"github.com/IBM/sarama"
	"github.com/segmentio/kafka-go"
)

// Row is an outbox row: the topic is data, not a declaration.
type Row struct {
	Topic   string
	Payload []byte
}

func Deliver(p sarama.SyncProducer, row Row) error {
	_, _, err := p.SendMessage(&sarama.ProducerMessage{Topic: row.Topic, Value: sarama.ByteEncoder(row.Payload)})
	return err
}

func Listen(ctx context.Context, group sarama.ConsumerGroup, handler sarama.ConsumerGroupHandler) error {
	return group.Consume(ctx, strings.Split(os.Getenv("TOPICS"), ","), handler)
}

func Tail() *kafka.Reader {
	return kafka.NewReader(kafka.ReaderConfig{Topic: os.Getenv("TAIL_TOPIC")})
}
