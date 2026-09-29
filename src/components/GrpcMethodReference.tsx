import { Terminal } from "lucide-react";
import type { RpcMethod, RpcService } from "../catalog";
import { catalog } from "../data";
import { CopyButton } from "./CopyButton";
import {
  grpcRequestJson,
  grpcurlCommand,
} from "../lib/grpc-reference";

/** The executable-looking part of a protobuf reference, collapsed per method. */
export function GrpcMethodReference({
  provided,
  method,
}: {
  provided: RpcService;
  method: RpcMethod;
}) {
  const json = grpcRequestJson(provided, method, catalog.defs);
  const command = grpcurlCommand(provided, method, catalog.defs);

  return (
    <details className="group mt-2 overflow-hidden rounded-control border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-muted hover:text-ink">
        <Terminal size={13} aria-hidden />
        <span>Call locally</span>
        <span className="chip mono">grpcurl</span>
        <span className="ml-auto text-faint group-open:hidden">show</span>
        <span className="ml-auto hidden text-faint group-open:inline">hide</span>
      </summary>
      <div className="grid gap-3 border-t border-line p-3 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label">ProtoJSON request</span>
            <CopyButton value={json} label="request JSON" />
          </div>
          <pre className="mono max-h-64 overflow-auto whitespace-pre rounded-control border border-line bg-canvas p-3 text-muted">
            {json}
          </pre>
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label">Command</span>
            <CopyButton value={command} label="grpcurl command" />
          </div>
          <pre className="mono max-h-64 overflow-auto whitespace-pre rounded-control border border-line bg-canvas p-3 text-muted">
            {command}
          </pre>
          <p className="mt-2 text-muted">
            Replace <span className="mono text-ink">localhost:50051</span> and
            remove <span className="mono text-ink">-plaintext</span> when the
            endpoint uses TLS.
          </p>
        </div>
      </div>
    </details>
  );
}
