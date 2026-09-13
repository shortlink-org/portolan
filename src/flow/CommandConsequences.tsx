import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { allRepos } from "../catalog";
import type { Catalog, Operation, Service } from "../catalog";
import type { EventChain } from "./chain";
import { commandEntries, isCommandHash } from "./command-info";
import { ChainList } from "./ChainList";
import { paths } from "../routes";
import { SourcePreviewLink } from "../components/SourcePreview";
import { sourceLocation } from "../lib/source-link";
import { flowRepoService } from "../lib/derive";

export function CommandConsequences({ catalog, service, operation, chain }: {
  catalog: Catalog;
  service: Service;
  operation: Operation;
  chain: EventChain;
}) {
  const { hash, key } = useLocation();
  const [open, setOpen] = useState(() => isCommandHash(hash, operation.id));
  useEffect(() => {
    if (isCommandHash(hash, operation.id)) setOpen(true);
  }, [hash, key, operation.id]);
  const entries = useMemo(() => commandEntries(catalog, service, chain), [catalog, service, chain]);
  const pins = allRepos(catalog);
  return (
    <div className="mt-2">
      <div className="mono mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-label={`${operation.id} entry points`}>
        <span className="text-muted">Entry points</span>
        {entries.length ? entries.map((entry) => {
          const flow = catalog.flows.find((flow) => flow.slug === entry.flow);
          const sourceOwner = flow ? flowRepoService(catalog, flow) ?? service : service;
          const source = entry.source ? sourceLocation(entry.source, sourceOwner, pins) : null;
          return (
          <span key={`${entry.flow}/${entry.stepId}`} className="inline-flex flex-wrap items-baseline gap-1.5">
            <Link to={paths.flowStep(entry.flow, entry.stepId)} className="rounded-control text-accent" title={entry.flow}>
              {entry.label}
            </Link>
            {entry.source ? <SourcePreviewLink location={source} className="text-muted hover:text-ink">source</SourcePreviewLink> : null}
          </span>
          );
        }) : <span className="text-muted">No linked invocation</span>}
      </div>
      <details open={open} className="border-t border-line pt-1" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="mono cursor-pointer rounded-control text-accent" aria-label={`What follows ${operation.id}`}>
          Then what
        </summary>
        {open ? (
          <div className="mt-2 mb-1" role="region" aria-label={`${operation.id} consequences`}>
            <p className="mono mb-2 max-w-prose text-muted">
              Possible publications and consumers shown in flows. Conditions may apply; this is not a recorded execution.
            </p>
            {chain.nodes.length || chain.truncated ? <ChainList chain={chain} collapsible /> : (
              <p className="mono text-muted">No flow is linked to this command. Its consequences are not known here.</p>
            )}
          </div>
        ) : null}
      </details>
    </div>
  );
}
