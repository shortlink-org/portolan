import type { HTTPDestination } from "../catalog";

/** Display the facts for this invocation, including the limits of defaults. */
export function HTTPDestinationEvidence({ destination: d }: { destination: HTTPDestination }) {
  const basis = d.resolution?.basis;
  const rows = [
    ["Linked by", basis === "full-path" ? "Recovered full path" : basis === "exact-route" ? "Exact route" : basis === "unique-suffix" ? "Unique route suffix (heuristic)" : "Unresolved"],
    ["Call site", d.callSite],
    ["Endpoint expression", d.endpointExpression],
    ["Local path", d.localPath],
    ["Base URL expression", d.baseURL?.expression],
    ["Config field", d.baseURL?.configField],
    ["Environment variable", d.baseURL?.environmentVariable],
    [d.baseURL?.kind === "config-default" ? "Config default (runtime may override)" : "Base URL", d.baseURL?.value],
    ["Config source", d.baseURL?.source],
    ["Option call site", d.baseURL?.optionSource],
    ["Service discovery alias", d.serviceDiscoveryAlias],
    ["Join expression", d.join?.expression],
    ["Join source", d.join?.source],
    ["Full path", d.fullPath],
    ...(d.transforms ?? []).map((transform) => ["Runtime URL modifier (not evaluated)", `${transform.expression} · ${transform.source}`]),
    ["Provider", d.resolution?.provider],
    ["Provider route", d.resolution?.route],
  ].filter(([, value]) => value);
  return <section aria-label="HTTP destination evidence" className="border-t border-line px-3 py-3">
    <h3 className="label mb-2">HTTP destination evidence</h3>
    <dl className="grid min-w-0 grid-cols-1 gap-y-3">
      {rows.map(([label, value], index) => <div key={`${label}-${index}`} className="min-w-0"><dt className="text-muted">{label}</dt><dd className="mono break-all text-ink">{value}</dd></div>)}
    </dl>
  </section>;
}
