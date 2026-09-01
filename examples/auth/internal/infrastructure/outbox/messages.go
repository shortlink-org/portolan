package outbox

import (
	"context"
	"errors"
	"fmt"

	"github.com/ThreeDotsLabs/watermill"
	wsql "github.com/ThreeDotsLabs/watermill-sql/v4/pkg/sql"
	"github.com/ThreeDotsLabs/watermill/message"

	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/storage/uow"
)

// ErrNoTransaction is what a publish outside a unit of work gets.
//
// Writing the message on its own connection would put it outside the
// transaction that produced it: the aggregate could roll back while the fact
// stayed, which is the same failure as publishing after the commit, only
// harder to see. Better to refuse.
var ErrNoTransaction = errors.New("outbox: no transaction in flight")

// Messages writes watermill messages into whatever transaction is in flight.
//
// The publisher is built per call rather than once, because it is bound to a
// transaction and a transaction lasts one unit of work. That is cheap - it
// holds a schema adapter and a handle, nothing more.
type Messages struct {
	logger watermill.LoggerAdapter
}

func NewMessages(logger watermill.LoggerAdapter) *Messages {
	return &Messages{logger: logger}
}

func (m *Messages) Publish(ctx context.Context, topic string, messages ...*message.Message) error {
	if len(messages) == 0 {
		return nil
	}

	tx := uow.FromContext(ctx)
	if tx == nil {
		return ErrNoTransaction
	}

	publisher, err := wsql.NewPublisher(
		wsql.TxFromPgx(tx),
		wsql.PublisherConfig{
			SchemaAdapter: schema(),
			// Creating a table inside somebody else's transaction would commit
			// it implicitly and take their work with it. The tables are made by
			// the subscriber at startup instead.
			AutoInitializeSchema: false,
		},
		m.logger,
	)
	if err != nil {
		return fmt.Errorf("outbox: publisher: %w", err)
	}

	if err := publisher.Publish(topic, messages...); err != nil {
		return fmt.Errorf("outbox: publishing to %s: %w", topic, err)
	}
	return nil
}

// schema is shared by the publisher and the subscriber; they have to agree on
// the table layout or one writes where the other does not look.
func schema() wsql.SchemaAdapter {
	return wsql.DefaultPostgreSQLSchema{}
}

func offsets() wsql.OffsetsAdapter {
	return wsql.DefaultPostgreSQLOffsetsAdapter{}
}
