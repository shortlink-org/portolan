// The two spans a domain event leaves behind: one where it is written to the
// outbox, one where a subscriber takes it off the bus. The trace is carried
// across the table on the message's metadata, under the keys the Go services
// use, so a consumer in either language continues the other's trace.
import { SpanKind, context, propagation, trace, type Span } from "@opentelemetry/api";

export const ATTR_EVENT_NAME = "event.name";
export const META_TRACE_ID = "otel_trace_id";
export const META_SPAN_ID = "otel_span_id";
const SYSTEM = "outbox";

const tracer = () => trace.getTracer("cart/messaging");

/** Opens the producer span for one event about to be written, and puts its context on the metadata. */
export function startPublish(topic: string, eventName: string, metadata: Record<string, string>): Span {
  const span = tracer().startSpan(`publish ${eventName}`, {
    kind: SpanKind.PRODUCER,
    attributes: { "messaging.system": SYSTEM, "messaging.destination.name": topic, "messaging.operation.type": "publish", [ATTR_EVENT_NAME]: eventName },
  });
  const ctx = span.spanContext();
  metadata[META_TRACE_ID] = ctx.traceId;
  metadata[META_SPAN_ID] = ctx.spanId;
  return span;
}

/** Opens the consumer span for one event handed to a subscriber, under the producer's span when the metadata names it. */
export function startConsume(topic: string, eventName: string, metadata: Record<string, string>): Span {
  let parent = context.active();
  const traceId = metadata[META_TRACE_ID];
  const spanId = metadata[META_SPAN_ID];
  if (traceId && spanId) {
    parent = trace.setSpanContext(parent, { traceId, spanId, traceFlags: 1, isRemote: true });
  }
  return tracer().startSpan(
    `consume ${eventName}`,
    { kind: SpanKind.CONSUMER, attributes: { "messaging.system": SYSTEM, "messaging.destination.name": topic, "messaging.operation.type": "process", [ATTR_EVENT_NAME]: eventName } },
    parent,
  );
}

export { propagation };
