//! The spans a domain event leaves behind: one where it is written to the
//! outbox, one where the relay puts it on the bus, one where a subscriber
//! takes it off. The trace is carried on the message's metadata twice over:
//! under the keys the Go and TypeScript services use, and as W3C
//! `traceparent`, which is what this service's own propagator reads.

use std::collections::{BTreeMap, HashMap};

use opentelemetry::trace::{SpanContext, SpanId, TraceContextExt, TraceFlags, TraceId, TraceState};
use opentelemetry::{Context, global};
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub const META_TRACE_ID: &str = "otel_trace_id";
pub const META_SPAN_ID: &str = "otel_span_id";

/// The producer span for one event about to be written or put on the bus.
pub fn publish_span(system: &str, topic: &str, event_name: &str) -> Span {
    tracing::info_span!(
        "publish",
        otel.name = %format!("publish {event_name}"),
        otel.kind = "producer",
        messaging.system = system,
        messaging.destination.name = topic,
        messaging.operation.type = "publish",
        event.name = event_name,
    )
}

/// The producer span for one event the relay is putting on the bus, under the
/// span that wrote it.
pub fn relay_span(system: &str, topic: &str, event_name: &str, metadata: &BTreeMap<String, String>) -> Span {
    let span = publish_span(system, topic, event_name);
    let _ = span.set_parent(parent_of(metadata));
    span
}

/// The consumer span for one event handed to a subscriber, under the span whose context the metadata names.
pub fn consume_span(system: &str, topic: &str, event_name: &str, metadata: &BTreeMap<String, String>) -> Span {
    let span = tracing::info_span!(
        "consume",
        otel.name = %format!("consume {event_name}"),
        otel.kind = "consumer",
        messaging.system = system,
        messaging.destination.name = topic,
        messaging.operation.type = "process",
        event.name = event_name,
    );
    let _ = span.set_parent(parent_of(metadata));
    span
}

/// Writes the span's context on to the metadata, under both spellings.
pub fn carry(span: &Span, metadata: &mut BTreeMap<String, String>) {
    let cx = span.context();
    let sc = cx.span().span_context().clone();
    if sc.is_valid() {
        metadata.insert(META_TRACE_ID.into(), sc.trace_id().to_string());
        metadata.insert(META_SPAN_ID.into(), sc.span_id().to_string());
    }
    let mut carrier: HashMap<String, String> = HashMap::new();
    global::get_text_map_propagator(|p| p.inject_context(&cx, &mut carrier));
    for (k, v) in carrier {
        metadata.insert(k, v);
    }
}

/// The context the metadata names: by the explicit keys first, by `traceparent` when only that is there.
pub fn parent_of(metadata: &BTreeMap<String, String>) -> Context {
    if let (Some(trace), Some(span)) = (metadata.get(META_TRACE_ID), metadata.get(META_SPAN_ID))
        && let (Ok(trace_id), Ok(span_id)) = (TraceId::from_hex(trace), SpanId::from_hex(span))
    {
        let sc = SpanContext::new(trace_id, span_id, TraceFlags::SAMPLED, true, TraceState::default());
        return Context::new().with_remote_span_context(sc);
    }
    let carrier: HashMap<String, String> = metadata.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    global::get_text_map_propagator(|p| p.extract(&carrier))
}
