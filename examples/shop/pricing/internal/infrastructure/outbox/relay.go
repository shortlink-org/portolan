// Package outbox is the relay: reads the outbox and hands what is in it to the
// bus, marking each row published. It runs for as long as the service does,
// and its failure is as fatal as the listener's - a service that serves but
// never delivers what it recorded is worse than one that is plainly down.
package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/bus"
)

const (
	pollEvery = 200 * time.Millisecond
	batch     = 50
)

type Relay struct {
	pool *pgxpool.Pool
	bus  bus.Bus
}

func NewRelay(pool *pgxpool.Pool, b bus.Bus) *Relay {
	return &Relay{pool: pool, bus: b}
}

// Run relays until ctx ends. It sleeps only when the outbox is empty: a full
// one is drained batch after batch.
func (r *Relay) Run(ctx context.Context) error {
	for {
		delivered, err := r.Once(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}

			return err
		}
		if delivered > 0 {
			continue
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(pollEvery):
		}
	}
}

type row struct {
	id      int64
	message bus.Message
}

// Once relays one batch, oldest first, each row marked on its own so a slow
// subscriber holds up nothing else. Publish and mark are not one transaction:
// a row published and not marked is published again, and the bus deduplicates
// on the uuid, which is why the row has one.
func (r *Relay) Once(ctx context.Context) (int, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, uuid, topic, payload, metadata FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1`, batch)
	if err != nil {
		return 0, fmt.Errorf("outbox: read: %w", err)
	}

	var pending []row
	for rows.Next() {
		var next row
		if err := rows.Scan(&next.id, &next.message.UUID, &next.message.Topic, &next.message.Payload, &next.message.Metadata); err != nil {
			rows.Close()

			return 0, fmt.Errorf("outbox: scan: %w", err)
		}
		pending = append(pending, next)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("outbox: read: %w", err)
	}

	for _, next := range pending {
		if err := r.bus.Publish(ctx, next.message); err != nil {
			return 0, err
		}
		if _, err := r.pool.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = $1`, next.id); err != nil {
			return 0, fmt.Errorf("outbox: mark %d: %w", next.id, err)
		}
	}

	return len(pending), nil
}
