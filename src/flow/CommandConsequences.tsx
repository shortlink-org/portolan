import { useMemo, useState } from "react";
import type { Aggregate, Catalog, Operation, Service } from "../catalog";
import { commandChain } from "./chain";
import { ChainList } from "./ChainList";

export function CommandConsequences({ catalog, service, aggregate, operation }: {
  catalog: Catalog;
  service: Service;
  aggregate: Aggregate;
  operation: Operation;
}) {
  const [open, setOpen] = useState(false);
  const chain = useMemo(
    () => open ? commandChain(catalog, service, aggregate, operation) : null,
    [open, catalog, service, aggregate, operation],
  );
  return (
    <details className="mt-2 border-t border-line pt-1" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="mono cursor-pointer rounded-control text-accent" aria-label={`What follows ${operation.id}`}>
        Then what
      </summary>
      {chain ? (
        <div className="mt-2 mb-1" role="region" aria-label={`${operation.id} consequences`}>
          <p className="mono mb-2 text-muted">
            Possible publications and consumers shown in flows. Conditions may apply; this is not a recorded execution.
          </p>
          {chain.nodes.length || chain.truncated ? <ChainList chain={chain} /> : (
            <p className="mono text-muted">No flow is linked to this command. Its consequences are not known here.</p>
          )}
        </div>
      ) : null}
    </details>
  );
}
