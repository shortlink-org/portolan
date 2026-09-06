package bus

import (
	"context"
	"log"
)

// Log is the bus when NATS_URL names no server: what would have gone out is
// written to the log, and nothing ever comes in. It is for running the service
// on its own, not for proving what it delivers.
type Log struct {
	out *log.Logger
}

func NewLog(out *log.Logger) *Log {
	return &Log{out: out}
}

func (b *Log) Publish(_ context.Context, m Message) error {
	b.out.Printf("bus: %s on %s (%s)", m.Name(), m.Topic, m.UUID)

	return nil
}

func (b *Log) Subscribe(_ context.Context, topic, name string, _ Handler) error {
	b.out.Printf("bus: no server, so nothing will arrive as %s on %s", name, topic)

	return nil
}

func (b *Log) Close() error { return nil }
