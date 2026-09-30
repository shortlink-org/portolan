package app

import (
	"context"

	"github.com/twmb/franz-go/pkg/kgo"
)

func Connect() (*kgo.Client, error) {
	return kgo.NewClient(
		kgo.SeedBrokers("kafka:9092"),
		kgo.ConsumerGroup("analytics"),
		kgo.ConsumeTopics("web.clicks", "web.views"),
		kgo.DefaultProduceTopic("analytics.fallback"),
	)
}

func Record(ctx context.Context, client *kgo.Client, payload []byte) error {
	return client.ProduceSync(ctx, &kgo.Record{Topic: "analytics.sessions", Value: payload}).FirstErr()
}

func Watch(client *kgo.Client, topics ...string) {
	client.AddConsumeTopics(topics...)
}

func Start() error {
	client, err := kgo.NewClient()
	if err != nil {
		return err
	}
	Watch(client, "web.searches")
	return nil
}
