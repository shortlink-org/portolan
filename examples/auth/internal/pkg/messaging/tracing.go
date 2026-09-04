package messaging

import (
	"context"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkwatermill "github.com/shortlink-org/go-sdk/watermill"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// The two spans a domain event leaves behind: one where it is written to the
// outbox, one where a policy takes it off the bus. The SDK traces the relay
// in between by topic alone; these say WHICH event, on both ends, and carry the
// trace across the table so that the two ends are one trace.
//
// The attribute names are the messaging semantic conventions where one
// exists. `event.name` does not have one - conventions name a destination,
// not a fact - and it is the attribute a reader of the trace most wants, so
// it is set under a name that says what it is.

const (
	// AttrEventName carries the event's wire name, "auth.PasswordChanged".
	AttrEventName = "event.name"
	system        = "outbox"
)

func tracer() trace.Tracer { return otel.Tracer("auth/messaging") }

// StartPublish opens the producer span for one event about to be written,
// and puts the span's context on the message so that whoever consumes it
// continues the trace rather than starting one.
func StartPublish(ctx context.Context, topic string, msg *message.Message, eventName string) (context.Context, trace.Span) {
	ctx, span := tracer().Start(ctx, "publish "+eventName,
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			attribute.String("messaging.system", system),
			attribute.String("messaging.destination.name", topic),
			attribute.String("messaging.operation.type", "publish"),
			attribute.String(AttrEventName, eventName),
		),
	)
	sdkwatermill.InjectTrace(ctx, msg)

	return ctx, span
}

// StartConsume opens the consumer span for one event handed to a policy. The
// parent is whatever the relay put on the message: with the producer's
// context injected above, that is the publish span.
func StartConsume(ctx context.Context, topic, eventName string) (context.Context, trace.Span) {
	return tracer().Start(ctx, "consume "+eventName,
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", system),
			attribute.String("messaging.destination.name", topic),
			attribute.String("messaging.operation.type", "process"),
			attribute.String(AttrEventName, eventName),
		),
	)
}
