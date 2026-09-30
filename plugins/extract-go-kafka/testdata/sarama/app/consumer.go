package app

import (
	"context"

	"github.com/IBM/sarama"
	legacy "github.com/Shopify/sarama"

	"example.com/billing/topics"
)

func Consume(ctx context.Context, brokers []string, cfg *sarama.Config, handler sarama.ConsumerGroupHandler) error {
	group, err := sarama.NewConsumerGroup(brokers, "billing", cfg)
	if err != nil {
		return err
	}
	return group.Consume(ctx, []string{topics.Payments}, handler)
}

func Tail(brokers []string) error {
	consumer, err := legacy.NewConsumer(brokers, nil)
	if err != nil {
		return err
	}
	_, err = consumer.ConsumePartition("billing.legacy", 0, legacy.OffsetNewest)
	return err
}

// Handler is the service's own port; its Consume is not sarama's.
type Handler struct{}

func (Handler) Consume(ctx context.Context, topics []string) error { return nil }

func Local(ctx context.Context) error {
	return Handler{}.Consume(ctx, []string{"not.kafka"})
}
