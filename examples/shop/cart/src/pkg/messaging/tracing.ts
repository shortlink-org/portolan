// The spans a domain event leaves behind: one where it is written to the
// outbox, one where the relay puts it on the bus, one where a subscriber takes
// it off. The trace is carried on the message's metadata twice over: under the
// keys the Go services use, so a consumer in either language continues the
// other's trace, and as W3C `traceparent`, which is what a client with a
// standard propagator - the Rust one - reads without being told the keys.
import { SpanKind, context, propagation, trace, type Span } from "@opentelemetry/api";

export const ATTR_EVENT_NAME = "event.name";
export const META_TRACE_ID = "otel_trace_id";
export const META_SPAN_ID = "otel_span_id";
const OUTBOX = "outbox";

const tracer = () => trace.getTracer("cart/messaging");

/** Opens the producer span for one event about to be written, and puts its context on the metadata. */
export function startPublish(topic: string, eventName: string, metadata: Record<string, string>): Span {
  const span = tracer().startSpan(`publish ${eventName}`, {
    kind: SpanKind.PRODUCER,
    attributes: attributes(OUTBOX, topic, "publish", eventName),
  });
  carry(span, metadata);
  return span;
}

/**
 * Opens the producer span for one event the relay is putting on the bus,
 * under the span that wrote it, and moves the metadata's context on to this
 * span: a consumer that reads the metadata off the bus then hangs under the
 * hop that actually reached it.
 */
export function startRelay(system: string, topic: string, eventName: string, metadata: Record<string, string>): Span {
  const span = tracer().startSpan(
    `publish ${eventName}`,
    { kind: SpanKind.PRODUCER, attributes: attributes(system, topic, "publish", eventName) },
    parentOf(metadata),
  );
  carry(span, metadata);
  return span;
}

/** Opens the consumer span for one event handed to a subscriber, under the span whose context the metadata names. */
export function startConsume(system: string, topic: string, eventName: string, metadata: Record<string, string>): Span {
  return tracer().startSpan(
    `consume ${eventName}`,
    { kind: SpanKind.CONSUMER, attributes: attributes(system, topic, "process", eventName) },
    parentOf(metadata),
  );
}

/** Runs `fn` with `span` active, so whatever it starts is a child of it. */
export function within<T>(span: Span, fn: () => Promise<T>): Promise<T> {
  return context.with(trace.setSpan(context.active(), span), fn);
}

function attributes(system: string, topic: string, operation: "publish" | "process", eventName: string) {
  return { "messaging.system": system, "messaging.destination.name": topic, "messaging.operation.type": operation, [ATTR_EVENT_NAME]: eventName };
}

/** Writes the span's context on to the metadata, under both spellings. */
function carry(span: Span, metadata: Record<string, string>): void {
  const ctx = span.spanContext();
  metadata[META_TRACE_ID] = ctx.traceId;
  metadata[META_SPAN_ID] = ctx.spanId;
  propagation.inject(trace.setSpan(context.active(), span), metadata);
}

/** The context the metadata names: by the explicit keys first, by `traceparent` when only that is there, and the active one when neither is. */
function parentOf(metadata: Record<string, string>) {
  const traceId = metadata[META_TRACE_ID];
  const spanId = metadata[META_SPAN_ID];
  if (traceId && spanId) {
    return trace.setSpanContext(context.active(), { traceId, spanId, traceFlags: 1, isRemote: true });
  }
  return propagation.extract(context.active(), metadata);
}
