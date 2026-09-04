package http

import (
	"context"
	nethttp "net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/transport/http/gen"
)

// traced wraps the router in a server span per request.
//
// otelhttp opens the span before the router has matched anything, so at that
// point the span is named after the method alone. The middleware below runs
// per operation, once the route is known, and renames it: `POST /v1/sessions`
// is what a trace reader expects to see, and the route template is what lets
// a request be read back to the operation in the OpenAPI document.
func traced(router nethttp.Handler) nethttp.Handler {
	return otelhttp.NewHandler(router, "http", otelhttp.WithSpanNameFormatter(
		func(_ string, r *nethttp.Request) string { return r.Method },
	))
}

// named is the strict middleware that gives the server span its route.
func named(next gen.StrictHandlerFunc, operationID string) gen.StrictHandlerFunc {
	return func(ctx context.Context, w nethttp.ResponseWriter, r *nethttp.Request, request any) (any, error) {
		if route := chi.RouteContext(r.Context()); route != nil {
			span := trace.SpanFromContext(ctx)
			pattern := route.RoutePattern()
			span.SetName(r.Method + " " + pattern)
			span.SetAttributes(
				attribute.String("http.route", pattern),
				attribute.String("http.request.method", r.Method),
				// Not a convention anyone else follows; it is here so that a
				// reader of the trace sees the operation the document names.
				attribute.String("auth.operation", operationID),
			)
		}

		return next(ctx, w, r, request)
	}
}
