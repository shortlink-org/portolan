# Observability in Go (OpenTelemetry)

Exporter, `cmd/auth/main.go`: if `TRACER_URI` is set, an OTLP gRPC exporter
and a tracer provider are installed with `otel.SetTracerProvider`; otherwise
the global provider stays the SDK's no-op.

HTTP, `infrastructure/transport/http/telemetry.go`:

```go
func traced(router http.Handler) http.Handler {
    return otelhttp.NewHandler(router, "http", otelhttp.WithSpanNameFormatter(
        func(_ string, r *http.Request) string { return r.Method },
    ))
}

// strict middleware, runs once the route is known
func named(next gen.StrictHandlerFunc, operationID string) gen.StrictHandlerFunc {
    return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
        if route := chi.RouteContext(r.Context()); route != nil {
            span := trace.SpanFromContext(ctx)
            pattern := route.RoutePattern()
            span.SetName(r.Method + " " + pattern)
            span.SetAttributes(
                attribute.String("http.route", pattern),
                attribute.String("http.request.method", r.Method),
                attribute.String("auth.operation", operationID),
            )
        }
        return next(ctx, w, r, request)
    }
}
```

Events, `pkg/messaging/tracing.go`:

```go
const AttrEventName = "event.name"
func tracer() trace.Tracer { return otel.Tracer("auth/messaging") }

func StartPublish(ctx context.Context, topic string, msg *message.Message, eventName string) (context.Context, trace.Span) {
    ctx, span := tracer().Start(ctx, "publish "+eventName,
        trace.WithSpanKind(trace.SpanKindProducer),
        trace.WithAttributes(
            attribute.String("messaging.system", "outbox"),
            attribute.String("messaging.destination.name", topic),
            attribute.String("messaging.operation.type", "publish"),
            attribute.String(AttrEventName, eventName),
        ),
    )
    sdkwatermill.InjectTrace(ctx, msg) // context onto the message; the outbox row keeps it
    return ctx, span
}

func StartConsume(ctx context.Context, topic, eventName string) (context.Context, trace.Span) // SpanKindConsumer, "process"
```

Called from `repository/<aggregate>/publisher.go` per event on publish, and
from the dispatcher in `Handle(relay, byName)` per event on consume. The
relay's middleware extracts the context from the message before the
dispatcher runs, so `StartConsume` parents on the publish span.

Database: the SDK's pgx tracer, wired in `provider/storage.go`.

Recording, `telemetry/`: `otel-collector.yaml` writes OTLP JSON to a file;
`record.sh` starts Postgres, the collector and the service, drives every
endpoint, and runs `scrub.mjs` over the output into `traces.jsonl`.
