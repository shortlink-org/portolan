import type { ReactNode } from "react";
import type { RelationEvidence } from "../catalog";

const labels: Record<RelationEvidence["kind"], string> = {
  "call-site": "Call site",
  function: "Function",
  binding: "Dependency binding",
  contract: "Contract",
  resolution: "Catalog resolution",
  unresolved: "Unresolved",
};
const rules: Record<string, string> = {
  "source-expression": "Expression in source",
  "source-function": "Enclosing source function",
  "provider-signature": "Provider signature (inferred)",
  "store-port-convention": "Storage field, type or package name (inferred)",
  "domain-port-convention":
    "Domain port mapped to the configured store (inferred)",
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
  "inferred-http-verb":
    "Provider's HTTP verb read from what the handler reads (inferred, medium confidence)",
  "continuation-entrypoint": "Matched continuation entrypoint",
  "response-to-request": "Response associated with request",
  "unresolved-target": "No unique target established",
  "sql-alter-table": "ALTER TABLE in migration",
  "sql-view-definition": "SQL view definition",
  "sql-create-table": "CREATE TABLE in migration",
  "domain-root-and-repository-layout":
    "Domain root and repository convention (inferred)",
  "migration-aggregate-annotation":
    "Explicit aggregate annotation in migration",
};

/** One explanation surface for all flow kinds and schema relationships. */
export function RelationEvidencePanel({
  items,
  renderSource,
  className = "my-3",
}: {
  items: readonly RelationEvidence[];
  renderSource?: (source: string) => ReactNode;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <section
        aria-label="Why this relation exists"
        className={`${className} border-y border-line bg-surface px-3 py-2.5`}
      >
        <h3 className="label">Why this relation exists</h3>
        <p className="mt-1 text-muted">
          No source evidence recorded in this fragment.
        </p>
      </section>
    );
  }

  const kinds = [...new Set(items.map((item) => labels[item.kind]))];

  return (
    <details
      aria-label="Why this relation exists"
      className={`group ${className} border-y border-line bg-surface`}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-raised">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="label min-w-0 flex-1">Why linked</span>
          <span className="shrink-0 text-muted">
            <span className="tnum">{items.length}</span>
            <span className="ml-1 group-open:hidden">show</span>
            <span className="ml-1 hidden group-open:inline">hide</span>
          </span>
        </span>
        <span className="mt-0.5 block min-w-0">
          <span
            className="block truncate text-ink"
            title={kinds.join(" + ")}
          >
            {kinds.join(" + ")}
          </span>
        </span>
      </summary>

      <ol className="space-y-2 border-t border-line px-3 py-2.5">
        {items.map((item, i) => (
          <li key={`${item.kind}-${i}`} className="min-w-0">
            <div className="flex flex-wrap gap-x-2">
              <span
                className={
                  item.kind === "unresolved"
                    ? "text-[var(--status-unresolved)]"
                    : "text-ink"
                }
              >
                {labels[item.kind]}
              </span>
              <span className="text-muted">
                {rules[item.rule] ?? item.rule}
              </span>
            </div>
            {item.symbol ? (
              <div className="mono mt-0.5 break-all">{item.symbol}</div>
            ) : null}
            {item.source ? (
              <div className="mono mt-0.5 break-all text-muted">
                {renderSource ? renderSource(item.source) : item.source}
              </div>
            ) : null}
            {item.candidates?.length ? (
              <div className="mt-1">
                <span className="text-muted">Candidates</span>
                <ul className="mt-0.5 border-l border-line pl-2">
                  {item.candidates.map((candidate) => (
                    <li className="mono break-all" key={candidate}>
                      {candidate}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
