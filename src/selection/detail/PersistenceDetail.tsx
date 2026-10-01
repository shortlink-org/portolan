import { RelationEvidencePanel } from "../../components/RelationEvidence";
import { Link } from "react-router";
import { catalog, index } from "../../data";
import {
  allRepos,
  blockFields,
  columnId,
  columnNameOfId,
  mapsBlockId,
  mapsFieldPath,
  storeViews,
  viewReads,
} from "../../catalog";
import { sourceLocation } from "../../lib/source-link";
import { typesDisagree } from "../../lib/data-model";
import { STORE_KIND_LABEL, StoreKindMark } from "../../er/StoreHeader";
import { upstreamOf } from "../../er/lineage";
import type { LineageMaps } from "../../er/lineage";
import { Ident } from "../../components/Ident";
import { SourcePreviewLink } from "../../components/SourcePreview";
import { blockPath } from "../../routes";
import type { Resolved } from "../model";
import {
  Label,
  LineageRows,
  Row,
  SchemaEvidenceSource,
  SelectLink,
} from "./shared";

/** The catalog's lineage graph, read whenever a column is open. */
const LINEAGE: LineageMaps = {
  from: index.lineageFrom,
  into: index.lineageInto,
};

// ---------------------------------------------------------------------------
// Persistence bodies. A store, a table and a column are three zoom levels on
// one question — where does this live — so each one names the level above it
// and lists the level below.
// ---------------------------------------------------------------------------

export function StoreBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "store" }>;
}) {
  const { store, service } = resolved;
  return (
    <>
      <Label>Kind</Label>
      <div className="mono flex items-center gap-1.5 text-muted">
        <StoreKindMark kind={store.kind} />
        {STORE_KIND_LABEL[store.kind]}
      </div>

      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Tables</Label>
      {store.tables.length === 0 && (store.keyspaces ?? []).length === 0 ? (
        <div className="mono text-muted">no schema extracted</div>
      ) : null}
      {store.tables.map((table) => (
        <Row key={table.id}>
          <SelectLink id={table.id}>{table.name}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">
            {table.columns.length}
          </span>
        </Row>
      ))}

      {(store.keyspaces ?? []).length > 0 ? (
        <>
          <Label>Key patterns</Label>
          {(store.keyspaces ?? []).map((keyspace) => (
            <Row key={keyspace.pattern}>
              <span className="mono min-w-0 break-all">{keyspace.pattern}</span>
              <span className="mono ml-auto shrink-0 text-muted">
                {keyspace.operations.join("/")}
              </span>
            </Row>
          ))}
        </>
      ) : null}

      {storeViews(store).length > 0 ? (
        <>
          <Label>Views</Label>
          {storeViews(store).map((view) => (
            <Row key={view.id}>
              <SelectLink id={view.id}>{view.name}</SelectLink>
              <span className="mono ml-auto shrink-0 text-muted">
                {view.materialized ? "matview" : "view"}
              </span>
            </Row>
          ))}
        </>
      ) : null}

      {store.source ? (
        <>
          <Label>Source</Label>
          <Ident block value={store.source} className="text-muted" />
        </>
      ) : null}
    </>
  );
}

export function ViewBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "view" }>;
}) {
  const { view, store } = resolved;
  const aggregateId = view.persists?.aggregate;
  const reads = viewReads(view);
  // Everything computed from this view's columns, wherever it lives: a view
  // read by another view is the case the canvas cannot draw in one hop.
  const feeds = [
    ...new Set(
      view.columns.flatMap(
        (c) => index.lineageInto.get(columnId(view.id, c.name)) ?? [],
      ),
    ),
  ];

  return (
    <>
      {view.doc ? <p className="mt-2 text-muted">{view.doc}</p> : null}
      <RelationEvidencePanel items={[
        ...(view.source ? [{ kind: "contract" as const, rule: "sql-view-definition", source: view.source, symbol: view.name }] : []),
        ...(view.persists?.evidence ?? []),
      ]} renderSource={(source) => <SchemaEvidenceSource source={source} owner={store.owner} />} />

      <Label>Store</Label>
      <SelectLink id={store.id}>{store.id}</SelectLink>

      <Label>Kind</Label>
      <div className="mono text-muted">
        {view.materialized
          ? "materialized view — the rows are kept, and can be stale"
          : "view — the rows are computed on every read"}
      </div>

      {aggregateId ? (
        <>
          <Label>Presents</Label>
          <SelectLink id={aggregateId}>{aggregateId}</SelectLink>
        </>
      ) : null}

      <Label>Reads</Label>
      {reads.length === 0 ? (
        <div className="mono text-muted">
          nothing says what this view is computed from
        </div>
      ) : null}
      {reads.map((id) => (
        <Row key={id}>
          <SelectLink id={id}>{id.split(".").at(-1)}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">{id}</span>
        </Row>
      ))}

      <Label>Columns</Label>
      <table className="w-full">
        <tbody>
          {view.columns.map((column) => (
            <tr key={column.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">
                <SelectLink id={columnId(view.id, column.name)}>
                  {column.name}
                </SelectLink>
              </td>
              <td className="mono py-0.5 pr-2 text-muted">
                {column.type}
                {column.nullable ? "?" : ""}
              </td>
              <td className="mono py-0.5 text-muted">
                {(column.from ?? []).length > 0 ? (
                  <span className="trunc" title={column.from?.join("\n")}>
                    ← {columnNameOfId(column.from?.[0] ?? "")}
                    {(column.from?.length ?? 0) > 1
                      ? ` +${(column.from?.length ?? 1) - 1}`
                      : ""}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {feeds.length > 0 ? (
        <>
          <Label>Feeds</Label>
          <LineageRows ids={feeds} />
        </>
      ) : null}

      {view.definition ? (
        <>
          <Label>Definition</Label>
          <pre className="mono overflow-x-auto rounded-card border p-2 border-line bg-surface text-muted">
            {view.definition}
          </pre>
        </>
      ) : null}

      {view.source ? (
        <>
          <Label>Source</Label>
          <Ident block value={view.source} className="text-muted" />
        </>
      ) : null}
    </>
  );
}

export function TableBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "table" }>;
}) {
  const { table, store } = resolved;
  const aggregateId = table.persists?.aggregate;
  const into = index.fkIntoTable.get(table.id) ?? [];
  const readers = index.viewsReading.get(table.id) ?? [];
  const feeds = [
    ...new Set(
      table.columns.flatMap(
        (c) => index.lineageInto.get(columnId(table.id, c.name)) ?? [],
      ),
    ),
  ];

  return (
    <>
      {table.doc ? <p className="mt-2 text-muted">{table.doc}</p> : null}
      <RelationEvidencePanel items={[...(table.evidence ?? []), ...(table.persists?.evidence ?? [])]} renderSource={(source) => <SchemaEvidenceSource source={source} owner={store.owner} />} />

      <Label>Store</Label>
      <SelectLink id={store.id}>{store.id}</SelectLink>

      {table.role ? (
        <>
          <Label>Role</Label>
          <div className="mono text-muted">{table.role}</div>
        </>
      ) : null}

      {aggregateId ? (
        <>
          <Label>Persists</Label>
          <SelectLink id={aggregateId}>{aggregateId}</SelectLink>
        </>
      ) : null}

      <Label>Columns</Label>
      <table className="w-full">
        <tbody>
          {table.columns.map((column) => {
            // A column carrying a domain field links to the block that
            // declares it: that is the whole point of the `maps` metadata.
            const blockId = mapsBlockId(
              aggregateId ? index.aggregateById.get(aggregateId) : undefined,
              column.maps,
            );
            const to = blockId ? blockPath(blockId) : null;
            return (
              <tr key={column.name} className="align-top">
                <td className="mono py-0.5 pr-2 whitespace-nowrap">
                  <SelectLink id={columnId(table.id, column.name)}>
                    {column.pk ? "· " : ""}
                    {column.name}
                  </SelectLink>
                </td>
                <td className="mono py-0.5 pr-2 text-muted">
                  {column.type}
                  {column.nullable ? "?" : ""}
                </td>
                <td className="mono py-0.5 text-muted">
                  {column.maps ? (
                    to ? (
                      <Link
                        to={to}
                        className="trunc text-accent hover:underline"
                      >
                        {column.maps}
                      </Link>
                    ) : (
                      column.maps
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {(table.indexes ?? []).length > 0 ? (
        <>
          <Label>Indexes</Label>
          {(table.indexes ?? []).map((ix) => (
            <Row key={ix.name}>
              <span className="mono trunc" title={ix.name}>
                {ix.columns.join(", ")}
              </span>
              {ix.unique ? (
                <span className="chip ml-auto shrink-0">unique</span>
              ) : null}
            </Row>
          ))}
        </>
      ) : null}

      {(table.accesses ?? []).length > 0 ? (
        <>
          <Label>Reads / writes</Label>
          {(table.accesses ?? []).map((access, accessIndex) => {
            const location = access.source
              ? sourceLocation(
                  access.source,
                  index.serviceById.get(store.owner),
                  allRepos(catalog),
                )
              : null;
            const tone =
              access.operation === "read"
                ? "text-accent"
                : access.operation === "write"
                  ? "text-verified"
                  : "text-unresolved";
            return (
              <div
                key={`${access.operation}:${access.method}:${access.source}:${accessIndex}`}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 py-1"
              >
                <span className={`chip self-start uppercase ${tone}`}>
                  {access.operation}
                </span>
                <div className="min-w-0">
                  <div className="mono break-all text-ink">
                    {access.method ?? "SQL client call"}
                  </div>
                  {access.source ? (
                    <SourcePreviewLink
                      location={location}
                      className="mono block break-all text-muted hover:text-accent"
                    >
                      {access.source}
                    </SourcePreviewLink>
                  ) : null}
                </div>
              </div>
            );
          })}
        </>
      ) : null}

      <Label>Referenced by</Label>
      {into.length === 0 ? (
        <div className="mono text-muted">nothing points at this table</div>
      ) : null}
      {into.map((owner) => (
        <Row key={`${owner.table.id}.${owner.column.name}`}>
          <SelectLink id={columnId(owner.table.id, owner.column.name)}>
            {owner.table.name}.{owner.column.name}
          </SelectLink>
        </Row>
      ))}

      {/* A view over this table is not a reference — nothing constrains
          anything — but it is the same worry in a different shape: rename a
          column here and the view breaks with no error until it is read. */}
      {readers.length > 0 ? (
        <>
          <Label>Read by</Label>
          {readers.map((view) => (
            <Row key={view.id}>
              <SelectLink id={view.id}>{view.name}</SelectLink>
              <span className="mono ml-auto shrink-0 text-muted">
                {view.materialized ? "matview" : "view"}
              </span>
            </Row>
          ))}
        </>
      ) : null}

      {feeds.length > 0 ? (
        <>
          <Label>Feeds</Label>
          <LineageRows ids={feeds} />
        </>
      ) : null}
    </>
  );
}

export function ColumnBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "column" }>;
}) {
  const { column, table, view } = resolved;
  const aggregateId = (table ?? view)?.persists?.aggregate;
  const aggregate = aggregateId
    ? index.aggregateById.get(aggregateId)
    : undefined;
  const from = index.lineageFrom.get(resolved.id) ?? [];
  const into = index.lineageInto.get(resolved.id) ?? [];
  // The far ends of the chain, not the next hop: a column three copies
  // downstream of the truth is what a reader is trying to find out about.
  const origins = [...upstreamOf(LINEAGE, resolved.id)].filter(
    (id) => (index.lineageFrom.get(id)?.length ?? 0) === 0,
  );
  const blockId = mapsBlockId(aggregate, column.maps);
  const block = blockId ? index.blockById.get(blockId) : undefined;
  const to = blockId ? blockPath(blockId) : null;
  const field = block
    ? blockFields(catalog, block.block).find(
        (f) =>
          f.name === (mapsFieldPath(column.maps ?? "").split(".")[0] ?? ""),
      )
    : undefined;

  return (
    <>
      {column.doc ? <p className="mt-2 text-muted">{column.doc}</p> : null}
      {(column.fk || column.from?.length || column.maps) ? <RelationEvidencePanel items={[
        ...(table?.evidence ?? []),
        ...(table?.persists?.evidence ?? []),
        ...(view?.source ? [{ kind: "contract" as const, rule: "sql-view-definition", source: view.source, symbol: view.name }] : []),
      ]} renderSource={(source) => <SchemaEvidenceSource source={source} owner={resolved.store.owner} />} /> : null}

      <Label>{view ? "View" : "Table"}</Label>
      {view ? (
        <SelectLink id={view.id}>{view.name}</SelectLink>
      ) : table ? (
        <SelectLink id={table.id}>{table.name}</SelectLink>
      ) : null}

      <Label>Type</Label>
      <div className="mono text-muted">
        {column.type}
        {column.nullable ? " · nullable" : " · not null"}
        {column.pk ? " · primary key" : ""}
      </div>

      {column.fk ? (
        <>
          <Label>References</Label>
          <SelectLink id={column.fk.table}>
            {column.fk.table}.{column.fk.column}
          </SelectLink>
          {column.fk.onDelete ? (
            <div className="mono mt-1 text-muted">
              on delete {column.fk.onDelete}
            </div>
          ) : null}
        </>
      ) : null}

      {from.length > 0 ? (
        <>
          <Label>Computed from</Label>
          <LineageRows ids={from} />
          {/* Only worth saying when the chain is longer than one hop: with a
              single source, the origin IS the source and printing it twice
              says nothing. */}
          {origins.length > 0 && !origins.every((id) => from.includes(id)) ? (
            <>
              <div className="mono mt-2 text-muted">originally</div>
              <LineageRows ids={origins} />
            </>
          ) : null}
        </>
      ) : null}

      {into.length > 0 ? (
        <>
          <Label>Feeds</Label>
          <LineageRows ids={into} />
        </>
      ) : null}

      {column.maps ? (
        <>
          <Label>Carries</Label>
          {to ? (
            <Link
              to={to}
              className="mono rounded-control text-accent hover:underline"
            >
              {column.maps}
            </Link>
          ) : (
            <div className="mono text-muted">{column.maps}</div>
          )}
          {field ? (
            <div className="mono mt-1 text-muted">
              {field.type}
              {typesDisagree(column.type, field.type) ? (
                <span className="ml-2 text-declared">
                  · disagrees with {column.type}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="mono mt-1 text-unresolved">
              no field of that name is declared
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
