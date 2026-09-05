// Tracing, switched on by naming a collector. Installed before assembly, so
// the instrumentations wrap the modules as they are first used; without
// TRACER_URI nothing is installed and every span costs nothing.
//
// Two instrumentations. The server is node:http, and the calls out to other
// services go through the global fetch - which is undici, and which the http
// instrumentation does not see. There is no third: this service has no
// database to instrument.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";

export function startTracing(collector: string, serviceName: string): () => Promise<void> {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    traceExporter: new OTLPTraceExporter({ url: collector }),
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
  });
  sdk.start();

  return () => sdk.shutdown();
}
