import type { RedisKeyspace, Store } from "../catalog";
import { Ident } from "../components/Ident";
import { plural } from "../lib/format";

const OPERATION_TONE: Record<string, string> = {
  read: "text-accent",
  write: "text-verified",
  delete: "text-unresolved",
  exists: "text-muted",
  expire: "text-declared",
  count: "text-ink",
};

function KeyspaceCard({ keyspace }: { keyspace: RedisKeyspace }) {
  return (
    <article className="overflow-hidden rounded-card border border-line bg-canvas shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <code className="mono min-w-0 break-all text-ink">
          {keyspace.pattern}
        </code>
        <div className="ml-auto flex flex-wrap gap-1">
          {keyspace.operations.map((operation) => (
            <span
              key={operation}
              className={`chip uppercase ${OPERATION_TONE[operation] ?? "text-muted"}`}
            >
              {operation}
            </span>
          ))}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-3 py-3 sm:grid-cols-[auto_1fr]">
        {keyspace.value ? (
          <>
            <dt className="label">value</dt>
            <dd className="mono break-all text-ink">{keyspace.value}</dd>
          </>
        ) : null}
        {keyspace.ttl ? (
          <>
            <dt className="label">TTL</dt>
            <dd className="mono text-ink">{keyspace.ttl}</dd>
          </>
        ) : null}
        {keyspace.source ? (
          <>
            <dt className="label">source</dt>
            <dd className="min-w-0">
              <Ident value={keyspace.source} className="max-w-full text-muted" />
            </dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}

export function RedisSchema({ store }: { store: Store }) {
  const keyspaces = store.keyspaces ?? [];
  return (
    <section aria-label="Redis key schema">
      <div className="mono mb-2 flex items-baseline gap-2 text-muted">
        <span className="tnum">{keyspaces.length}</span>
        <span>{plural(keyspaces.length, "key pattern")}</span>
        <span>· dynamic parts are shown in braces</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {keyspaces.map((keyspace) => (
          <KeyspaceCard key={keyspace.pattern} keyspace={keyspace} />
        ))}
      </div>
    </section>
  );
}
