//! Tracing, switched on by naming a collector. Every span here is a tracing
//! span with the OpenTelemetry names on its fields - `otel.kind`, `rpc.*`,
//! `db.*`, `messaging.*` - and the layer turns them into what the collector
//! writes, which is what portolan reads to mark hops as observed. With no
//! TRACER_URI the layer is not installed and every span costs nothing.

use std::collections::HashMap;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::{Context, global};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Installs the subscriber; the provider comes back when there is one to shut down.
pub fn init(tracer_uri: Option<&str>, service_name: &str) -> Option<SdkTracerProvider> {
    global::set_text_map_propagator(opentelemetry_sdk::propagation::TraceContextPropagator::new());
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let fmt = tracing_subscriber::fmt::layer().with_target(false);
    let Some(uri) = tracer_uri else {
        tracing_subscriber::registry().with(filter).with(fmt).init();
        return None;
    };
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(uri)
        .build()
        .expect("an OTLP exporter for TRACER_URI");
    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(opentelemetry_sdk::Resource::builder().with_service_name(service_name.to_string()).build())
        .build();
    global::set_tracer_provider(provider.clone());
    let tracer = provider.tracer("oms");
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt)
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .init();
    Some(provider)
}

/// The server span for one rpc answered, under the caller's context when the request carries one.
pub fn server_span(service: &str, method: &str, metadata: &tonic::metadata::MetadataMap) -> Span {
    let span = tracing::info_span!(
        "rpc",
        otel.name = %format!("{service}/{method}"),
        otel.kind = "server",
        rpc.system = "grpc",
        rpc.service = service,
        rpc.method = method,
    );
    let carrier: HashMap<String, String> = metadata
        .iter()
        .filter_map(|kv| match kv {
            tonic::metadata::KeyAndValueRef::Ascii(k, v) => v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())),
            _ => None,
        })
        .collect();
    let parent: Context = global::get_text_map_propagator(|p| p.extract(&carrier));
    let _ = span.set_parent(parent);
    span
}

/// The client span for one rpc made.
pub fn client_span(service: &str, method: &str) -> Span {
    tracing::info_span!(
        "rpc",
        otel.name = %format!("{service}/{method}"),
        otel.kind = "client",
        rpc.system = "grpc",
        rpc.service = service,
        rpc.method = method,
    )
}

/// Puts the span's context on an outgoing request, as `traceparent`.
pub fn inject(span: &Span, metadata: &mut tonic::metadata::MetadataMap) {
    let mut carrier: HashMap<String, String> = HashMap::new();
    global::get_text_map_propagator(|p| p.inject_context(&span.context(), &mut carrier));
    for (k, v) in carrier {
        if let (Ok(key), Ok(value)) = (k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(), v.parse()) {
            metadata.insert(key, value);
        }
    }
}

/// The client span for one statement against the store.
pub fn db_span(operation: &str, table: &str) -> Span {
    tracing::info_span!(
        "db",
        otel.name = %format!("{operation} {table}"),
        otel.kind = "client",
        db.system.name = "postgresql",
        db.operation.name = operation,
        db.collection.name = table,
    )
}
