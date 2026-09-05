package messaging

import (
	"context"

	"github.com/ThreeDotsLabs/watermill/message"
	sdkwatermill "github.com/shortlink-org/go-sdk/watermill"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// The three spans a domain event leaves behind: one where it is written to
// the outbox, one where the relay puts it on the bus, one where a subscriber
// takes it off. The SDK traces the relay in between by topic alone; these say
// WHICH event, at every step, and carry the trace across the table so that the
// steps are one trace.
//
// The two producer spans nest: the relay's sits under the outbox's and names
// the same event, which is how a reader of the trace - and the catalog - tells
// "written, then put on the bus" from "published twice". Only the subscriber's
// span is a consumer span, so a service is read as consuming exactly the events
// something in it reacts to, not every event it wrote.
//
// The attribute names are the messaging semantic conventions where one
// exists. `event.name` does not have one - conventions name a destination,
// not a fact - and it is the attribute a reader of the trace most wants, so
// it is set under a name that says what it is.

const (
	// AttrEventName carries the event's wire name, "auth.PasswordChanged".
	AttrEventName = "event.name"

	// SystemOutbox is the messaging.system of the table an event is written to.
	SystemOutbox = "outbox"

	// SystemInProc is the messaging.system of the in-process bus the relay
	// hands events to. When a broker replaces it, its name goes here.
	SystemInProc = "inproc"
)

func tracer() trace.Tracer { return otel.Tracer("auth/messaging") }

// StartPublish opens the producer span for one event about to be written,
// and puts the span's context on the message so that whoever reads it back
// continues the trace rather than starting one.
func StartPublish(ctx context.Context, topic string, msg *message.Message, eventName string) (context.Context, trace.Span) {
	ctx, span := tracer().Start(ctx, "publish "+eventName,
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(attributes(SystemOutbox, topic, "publish", eventName)...),
	)
	sdkwatermill.InjectTrace(ctx, msg)

	return ctx, span
}

// StartRelay opens the producer span for one event the relay is putting on
// the bus. The parent is whatever the relay put on the message: with the
// producer's context injected above, that is the outbox's publish span.
func StartRelay(ctx context.Context, system, topic, eventName string) (context.Context, trace.Span) {
	return tracer().Start(ctx, "publish "+eventName,
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(attributes(system, topic, "publish", eventName)...),
	)
}

// StartConsume opens the consumer span for one event handed to a subscriber.
// The bus opens it, around the subscriber and nothing else, so the span
// exists only where something actually reacts.
func StartConsume(ctx context.Context, system, topic, eventName string) (context.Context, trace.Span) {
	return tracer().Start(ctx, "consume "+eventName,
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(attributes(system, topic, "process", eventName)...),
	)
}

// EndWith closes a span, recording err on it when there is one.
func EndWith(span trace.Span, err error) {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

func attributes(system, topic, operation, eventName string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.String("messaging.system", system),
		attribute.String("messaging.destination.name", topic),
		attribute.String("messaging.operation.type", operation),
		attribute.String(AttrEventName, eventName),
	}
}
