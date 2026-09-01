// The line above an ER canvas: what this store is, who owns it, how big it is.
//
// Written once because it appears twice — stacked on the service's Data tab and
// again at the top of a store's own page — and a reader who has learned to read
// it in one place has learned it in the other.

import { Link } from "react-router";
import type { Store, StoreKind } from "../catalog";
import { index } from "../data";
import { Ident } from "../components/Ident";
import { KindIcon } from "../components/kind";
import { plural } from "../lib/format";
import { outboundKeys } from "./spec";
import { servicePath, storePath } from "../routes";

/**
 * What a kind is called on the page. The icon is the same database glyph for
 * all of them: the distinction between Postgres and ClickHouse is a word, and
 * nine glyphs nobody can tell apart is not a taxonomy.
 */
export const STORE_KIND_LABEL: Record<StoreKind, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  redis: "Redis",
  mongodb: "MongoDB",
  clickhouse: "ClickHouse",
  s3: "S3",
  "kafka-topic": "Kafka topic",
  other: "store",
};

export function StoreHeader({
  store,
  access,
  /** Links the store's name to its own page. Off on the page itself. */
  linked = true,
}: {
  store: Store;
  access: "owns" | "reads";
  linked?: boolean;
}) {
  const to = linked ? storePath(store.id) : null;
  const ownerTo = servicePath(store.owner);
  const outbound = outboundKeys(index, store);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <KindIcon kind="store" />
      {to ? (
        <Link to={to} className="mono rounded-control text-ink hover:underline">
          {store.slug}
        </Link>
      ) : (
        <span className="mono text-ink">{store.slug}</span>
      )}
      <span className="meta">{store.name}</span>
      <span className="chip">{STORE_KIND_LABEL[store.kind]}</span>

      {access === "reads" ? (
        <span
          className="chip"
          title={`${store.owner} owns this store; this service only reads it`}
        >
          read-only
          {ownerTo ? (
            <>
              {" · "}
              <Link to={ownerTo} className="text-accent hover:underline">
                {store.owner}
              </Link>
            </>
          ) : (
            ` · ${store.owner}`
          )}
        </span>
      ) : null}

      <span className="mono ml-auto flex items-center gap-3 text-muted">
        {/* A store with no tables is not an empty store — it is a store whose
            shape the extractor cannot read, which a count of zero would state
            as a fact about the database rather than about the catalog. */}
        <span>
          {store.tables.length === 0 ? (
            <span title="no schema was extracted for this store">
              no tables extracted
            </span>
          ) : (
            <>
              <span className="tnum">{store.tables.length}</span>{" "}
              {plural(store.tables.length, "table")}
            </>
          )}
        </span>
        {outbound.length > 0 ? (
          <span
            className="text-unresolved"
            title={outbound
              .map((o) => `${o.from}.${o.fromColumn} → ${o.to} (${o.peer})`)
              .join("\n")}
          >
            <span className="tnum">{outbound.length}</span> key
            {outbound.length === 1 ? "" : "s"} out of this store
          </span>
        ) : null}
        {store.source ? <Ident value={store.source} /> : null}
      </span>
    </div>
  );
}
