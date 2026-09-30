package app

import (
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

const Verdicts = "fraud.verdicts"

func Flag(p *kafka.Producer, payload []byte) error {
	topic := Verdicts
	return p.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: kafka.PartitionAny},
		Value:          payload,
	}, nil)
}

func Listen() error {
	c, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers": "kafka:9092",
		"group.id":          "fraud",
	})
	if err != nil {
		return err
	}
	if err := c.SubscribeTopics([]string{"shop.payments.captured", "shop.cards.added"}, nil); err != nil {
		return err
	}
	return Follow(c, "shop.refunds")
}

func Follow(c *kafka.Consumer, topic string) error {
	return c.Subscribe(topic, nil)
}
