import { allRepos, type RedisKeyspace, type Store } from "../catalog";
import { Link } from "react-router";
import { Ident } from "../components/Ident";
import { SourcePreviewLink } from "../components/SourcePreview";
import { catalog, index } from "../data";
import { plural } from "../lib/format";
import { sourceLocation } from "../lib/source-link";
import { aggregatePath } from "../routes";

const OPERATION_TONE: Record<string, string> = {
  read: "text-accent",
  write: "text-verified",
  delete: "text-unresolved",
  exists: "text-muted",
  expire: "text-declared",
  count: "text-ink",
};

function KeyspaceCard({
  keyspace,
  store,
}: {
  keyspace: RedisKeyspace;
  store: Store;
}) {
  const aggregateId = keyspace.persists?.aggregate;
  const aggregateTo = aggregateId ? aggregatePath(aggregateId) : null;
  const accesses = keyspace.accesses ?? [];
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
        {aggregateId ? (
          <>
            <dt className="label">persists</dt>
            <dd className="min-w-0">
              {aggregateTo ? (
                <Link
                  to={aggregateTo}
                  className="mono text-accent hover:underline"
                >
                  {aggregateId} →
                </Link>
              ) : (
                <Ident value={aggregateId} className="max-w-full text-muted" />
              )}
            </dd>
          </>
        ) : null}
        {keyspace.source && accesses.length === 0 ? (
          <>
            <dt className="label">source</dt>
            <dd className="min-w-0">
              <Ident
                value={keyspace.source}
                className="max-w-full text-muted"
              />
            </dd>
          </>
        ) : null}
      </dl>
      {accesses.length > 0 ? (
        <div className="border-t border-line">
          <div className="label bg-surface px-3 py-1.5">
            Accesses · <span className="tnum">{accesses.length}</span>
          </div>
          <div className="divide-y divide-line">
            {accesses.map((access, accessIndex) => {
              const location = access.source
                ? sourceLocation(
                    access.source,
                    index.serviceById.get(store.owner),
                    allRepos(catalog),
                  )
                : null;
              return (
                <div
                  key={`${access.operation}:${access.method}:${access.source}:${accessIndex}`}
                  className="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)]"
                >
                  <span
                    className={`chip self-start uppercase ${OPERATION_TONE[access.operation] ?? "text-muted"}`}
                  >
                    {access.operation}
                  </span>
                  <div className="min-w-0">
                    <div className="mono break-all text-ink">
                      {access.method ?? "Redis client call"}
                    </div>
                    {access.source ? (
                      <SourcePreviewLink
                        location={location}
                        className="mt-1 max-w-full break-all text-muted hover:text-accent"
                      >
                        {access.source}
                      </SourcePreviewLink>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
          <KeyspaceCard
            key={keyspace.pattern}
            keyspace={keyspace}
            store={store}
          />
        ))}
      </div>
    </section>
  );
}
