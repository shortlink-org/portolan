// Tracing, switched on by naming a collector. Installed before assembly, so
// the instrumentations wrap the modules as they are first used; without
// TRACER_URI nothing is installed and every span costs nothing.
//
// Three instrumentations, because three different things make a request: the
// server is Fastify over node:http, the pool is pg, and the calls out to other
// services go through the global fetch - which is undici, and which the http
// instrumentation does not see. Without the third, the hop to auth that the
// catalog is verified against would never be recorded.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";

export function startTracing(collector: string, serviceName: string): () => Promise<void> {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    traceExporter: new OTLPTraceExporter({ url: collector }),
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
  return () => sdk.shutdown();
}
