// A WSDL contract drawn from the structured facts extract-wsdl recorded.
// Unlike OpenAPI, the catalog already carries the operation binding and the
// reachable message shapes, so this remains useful when the source repository
// is not bundled into the generated site.

import { useState } from "react";
import type { RpcMethod, RpcService } from "../catalog";
import { Empty, SectionTitle } from "./PageHeader";
import { Ident } from "./Ident";
import { MessageList, MethodRows } from "./MethodRows";

export function WsdlReference({
  source,
  provided,
}: {
  source: string;
  provided: RpcService[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const interfaces = provided.filter((item) => item.source === source);
  const toggle = (id: string) =>
    setOpen((shown) => {
      const next = new Set(shown);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (interfaces.length === 0) {
    return <Empty>the WSDL source names no interface in this catalog</Empty>;
  }

  return (
    <div className="max-w-table">
      <p className="mono text-muted">{source}</p>
      {interfaces.map((iface) => {
        const soap = iface.methods.find((method) => method.soap)?.soap;
        return (
          <section key={iface.id} className="mt-section">
            <SectionTitle>{iface.id}</SectionTitle>
            <div className="rounded-card border border-line">
              <div className="flex flex-wrap items-center gap-x-2 border-b border-line bg-surface px-3 py-1.5">
                <Ident value={iface.id} className="text-ink" />
                {soap?.version ? <span className="chip">SOAP {soap.version}</span> : null}
                {soap?.style ? <span className="chip">{soap.style}</span> : null}
                {soap?.binding ? <span className="chip mono">{soap.binding}</span> : null}
                {soap?.endpoint ? (
                  <span className="mono min-w-0 truncate text-muted" title={soap.endpoint}>
                    {soap.endpoint}
                  </span>
                ) : null}
              </div>
              <MethodRows provided={iface} open={open} onToggle={toggle} />
              <MessageList provided={iface} open={open} onToggle={toggle} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The one external SOAP operation a consumer card points at. */
export function SoapCallContract({
  provided,
  method,
}: {
  provided: RpcService;
  method: RpcMethod;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((shown) => {
      const next = new Set(shown);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const one = { ...provided, methods: [method] };

  return (
    <div className="mt-1 w-full rounded-control border border-line bg-surface">
      <MethodRows provided={one} open={open} onToggle={toggle} />
    </div>
  );
}
