package app

import (
	"context"

	"github.com/segmentio/kafka-go"

	"example.com/shipping/bus"
)

const Dispatched = "shipping.dispatched"

type Config struct {
	Orders string `envconfig:"ORDERS_TOPIC" default:"shop.orders.placed"`
}

type App struct {
	bus bus.Bus
}

func (a *App) Start(ctx context.Context, cfg Config) error {
	reader := kafka.NewReader(kafka.ReaderConfig{Brokers: []string{"kafka:9092"}, Topic: cfg.Orders, GroupID: "shipping"})
	defer reader.Close()

	returns := kafka.ReaderConfig{GroupID: "returns", GroupTopics: []string{"shop.returns.opened", "shop.returns.closed"}}
	_ = kafka.NewReader(returns)

	_ = bus.NewShipments(Dispatched, "kafka:9092")
	return a.bus.Publish(ctx, "shipping.labels", "shipping.LabelPrinted", nil)
}

func Legacy() *kafka.Writer {
	return kafka.NewWriter(kafka.WriterConfig{Brokers: []string{"kafka:9092"}, Topic: "shipping.legacy"})
}
