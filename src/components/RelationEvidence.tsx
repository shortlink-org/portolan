import type { ReactNode } from "react";
import type { RelationEvidence } from "../catalog";

const labels: Record<RelationEvidence["kind"], string> = {
  "call-site": "Call site", function: "Function", binding: "Dependency binding",
  contract: "Contract", resolution: "Catalog resolution", unresolved: "Unresolved",
};
const rules: Record<string, string> = {
  "source-expression": "Expression in source",
  "source-function": "Enclosing source function",
  "provider-signature": "Provider signature (inferred)",
  "store-port-convention": "Storage field, type or package name (inferred)",
  "domain-port-convention": "Domain port mapped to the configured store (inferred)",
  "ambiguous-binding": "Several implementations remain possible",
  "generated-client-method": "Method declared by generated client",
  "http-expression": "Outbound HTTP expression",
  "analyzed-call-path": "Static analysis path; not a runtime trace",
  "client-contract": "Client contract",
  "catalog-contract": "Matching interface and method",
  "event-declaration": "Declared event",
  "repository-sql-call": "SQL operation inside repository",
  "full-path": "Recovered full HTTP path",
  "exact-route": "Exact HTTP route",
  "unique-suffix": "Unique route suffix (heuristic)",
  "continuation-entrypoint": "Matched continuation entrypoint",
  "response-to-request": "Response associated with request",
  "unresolved-target": "No unique target established",
  "sql-alter-table": "ALTER TABLE in migration",
  "sql-view-definition": "SQL view definition",
  "sql-create-table": "CREATE TABLE in migration",
  "domain-root-and-repository-layout": "Domain root and repository convention (inferred)",
  "migration-aggregate-annotation": "Explicit aggregate annotation in migration",
};

/** One explanation surface for all flow kinds and schema relationships. */
export function RelationEvidencePanel({ items, renderSource }: {
  items: readonly RelationEvidence[];
  renderSource?: (source: string) => ReactNode;
}) {
  return <section aria-label="Why this relation exists" className="my-3 rounded-card border border-line bg-surface p-3">
    <h3 className="label mb-2">Why this relation exists</h3>
    {items.length === 0 ? <p className="text-muted">No source evidence recorded in this fragment.</p> :
      <ol className="space-y-3">
        {items.map((item, i) => <li key={`${item.kind}-${i}`} className="min-w-0 border-l-2 border-line pl-3">
          <div className={item.kind === "unresolved" ? "text-[var(--status-unresolved)]" : "text-ink"}>{labels[item.kind]}</div>
          <div className="text-muted">{rules[item.rule] ?? item.rule}</div>
          {item.symbol ? <div className="mono break-all">{item.symbol}</div> : null}
          {item.source ? <div className="mono break-all text-muted">{renderSource ? renderSource(item.source) : item.source}</div> : null}
          {item.candidates?.length ? <div className="mt-1"><span className="text-muted">Candidates</span><ul>{item.candidates.map((candidate) => <li className="mono break-all" key={candidate}>{candidate}</li>)}</ul></div> : null}
        </li>)}
      </ol>}
  </section>;
}
