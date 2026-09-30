// Who reads and writes which table: one store, as a matrix.
//
// The schema canvas answers what the tables are; this answers who reaches
// into them. A row per table and a column per service, so the question a
// reader brings - does anybody besides the owner write here - is answered by
// scanning one row rather than by opening every table in the detail rail.
//
// A cell is a summary and never the evidence itself: clicking it opens a row
// under the table with every method and the file and line it was read from.
// A service's column opens into the classes that made the calls, for the
// reader who wants to know which repository and not only which service.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, ChevronsLeftRight, ChevronsRightLeft } from "lucide-react";
import { allRepos } from "../catalog";
import type { Store, TableAccess, TableOperation } from "../catalog";
import { catalog, index } from "../data";
import { Blank, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { SourcePreviewLink } from "../components/SourcePreview";
import { plural } from "../lib/format";
import { sourceLocation } from "../lib/source-link";
import { paths, storePath } from "../routes";
import { repositoryCellKey, storeAccessMatrix } from "../lib/store-access";
import type {
  AccessCell,
  AccessRow,
  AccessService,
  CrossStoreRef,
} from "../lib/store-access";

/** The tones the table detail and the Redis cards already give these words. */
const OPERATION_TONE: Record<TableOperation, string> = {
  read: "text-accent",
  write: "text-verified",
  delete: "text-unresolved",
};

const OPERATION_MARK: Record<TableOperation, string> = {
  read: "R",
  write: "W",
  delete: "D",
};

/** A column as drawn: a whole service, or one repository of an opened one. */
interface Column {
  key: string;
  service: AccessService;
  repository?: { key: string; label: string; dir: string };
  /** First column of its service, which carries the service's name and toggle. */
  first: boolean;
}

function serviceHref(id: string): string | null {
  const service = index.serviceById.get(id);
  const context = index.serviceContext.get(id);
  return service && context ? paths.service(context.id, service.slug) : null;
}

function ServiceName({ id }: { id: string }) {
  const href = serviceHref(id);
  return href ? (
    <Link to={href} className="mono rounded-control text-ink hover:text-accent hover:underline">
      {id}
    </Link>
  ) : (
    <span className="mono text-ink">{id}</span>
  );
}

function Marks({ operations }: { operations: readonly TableOperation[] }) {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {operations.map((operation) => (
        <span
          key={operation}
          className={`chip w-5 justify-center px-0 ${OPERATION_TONE[operation]}`}
        >
          {OPERATION_MARK[operation]}
        </span>
      ))}
    </span>
  );
}

/**
 * The width the matrix's scroll box shows, so an evidence row opened under a
 * table wider than the screen stays where the reader is looking instead of
 * running off to the right with the table.
 */
function useViewWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function AccessLine({ access, store }: { access: TableAccess; store: Store }) {
  const location = access.source
    ? sourceLocation(access.source, index.serviceById.get(store.owner), allRepos(catalog))
    : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 py-1">
      <span className={`chip self-start uppercase ${OPERATION_TONE[access.operation]}`}>
        {access.operation}
      </span>
      <div className="min-w-0">
        <div className="mono break-all text-ink">{access.method ?? "SQL client call"}</div>
        {access.source ? (
          <SourcePreviewLink
            location={location}
            className="mono block break-all text-muted hover:text-accent"
          >
            {access.source}
          </SourcePreviewLink>
        ) : (
          <div className="text-muted">no source location recorded</div>
        )}
      </div>
    </li>
  );
}

function cellFor(row: AccessRow, column: Column): AccessCell | undefined {
  return row.cells.get(
    column.repository
      ? repositoryCellKey(column.service.id, column.repository.key)
      : column.service.id,
  );
}

function columnLabel(column: Column): string {
  return column.repository
    ? `${column.service.id} · ${column.repository.label}`
    : column.service.id;
}

function describe(cell: AccessCell): string {
  return `${cell.operations.join(", ")}: ${cell.accesses.length} ${plural(cell.accesses.length, "call")}`;
}

function SharedChip({ row }: { row: AccessRow }) {
  if (row.sharedWrite) {
    return (
      <span className="chip status-declared shrink-0" title={`Written by ${row.writers.join(", ")}`}>
        <span className="tnum">{row.writers.length}</span> writers
      </span>
    );
  }
  if (row.shared) {
    return (
      <span className="chip shrink-0 border-line-strong text-muted" title={`Touched by ${row.services.join(", ")}`}>
        <span className="tnum">{row.services.length}</span> services
      </span>
    );
  }
  return null;
}

function Summary({
  store,
  services,
  rows,
  accessCount,
}: {
  store: Store;
  services: AccessService[];
  rows: AccessRow[];
  accessCount: number;
}) {
  const sharedWrite = rows.filter((row) => row.sharedWrite);
  const sharedRead = rows.filter((row) => row.shared && !row.sharedWrite);
  const untouched = rows.filter((row) => row.accessCount === 0);
  const others = services.filter((service) => !service.owner);

  let answer: ReactNode;
  if (sharedWrite.length > 0) {
    answer = (
      <>
        <span className="tnum">{sharedWrite.length}</span>{" "}
        {plural(sharedWrite.length, "table is", "tables are")} written by more than one
        service. Two writers of the same rows share an invariant that neither owns,
        and a change to the table has to be released in both at once; the usual
        way out is for one service to own the rows and for the other to ask it.
      </>
    );
  } else if (sharedRead.length > 0) {
    answer = (
      <>
        <span className="tnum">{sharedRead.length}</span>{" "}
        {plural(sharedRead.length, "table is", "tables are")} read by a service
        other than the one that writes it. Each is written by one service, but a
        reader outside it depends on the table's columns rather than on an
        interface, so a migration here can break it without a compiler noticing.
      </>
    );
  } else if (others.length === 0) {
    answer = (
      <>
        Every recorded call comes from <ServiceName id={store.owner} />, the
        store's owner; no other service's code reaches into these tables.
      </>
    );
  } else {
    answer = <>Every table here is touched by one service only.</>;
  }

  return (
    <div className="max-w-prose text-muted">
      <p>{answer}</p>
      <p className="mt-2">
        <span className="tnum">{accessCount}</span> {plural(accessCount, "call")} across{" "}
        <span className="tnum">{rows.length - untouched.length}</span> of{" "}
        <span className="tnum">{rows.length}</span> {plural(rows.length, "table")}, read
        from the code. Each call is credited to the service whose directory holds
        its file, and to the owner when no other service claims the directory.
        {untouched.length > 0 ? (
          <>
            {" "}
            <span className="tnum">{untouched.length}</span>{" "}
            {plural(untouched.length, "table has", "tables have")} no recorded
            call: none was found, which is not proof that nothing queries it.
          </>
        ) : null}
      </p>
    </div>
  );
}

function CrossStore({ refs, store }: { refs: CrossStoreRef[]; store: Store }) {
  const local = (id: string) =>
    id.startsWith(`${store.id}.`) ? id.slice(store.id.length + 1) : id;
  const storeLink = (id: string | null) => {
    if (!id) return <span className="text-muted">no store in this catalog</span>;
    const to = storePath(id);
    return to ? (
      <Link to={to} className="mono rounded-control text-accent hover:underline">
        {id}
      </Link>
    ) : (
      <span className="mono">{id}</span>
    );
  };
  const verb = (ref: CrossStoreRef) =>
    ref.direction === "out"
      ? ref.kind === "copy"
        ? "is copied from"
        : "references"
      : ref.kind === "copy"
        ? "copies"
        : "references";
  return (
    <section className="mt-section max-w-table" aria-labelledby="cross-store">
      <SectionTitle>
        <span id="cross-store">Values that cross the store boundary</span>
      </SectionTitle>
      <p className="max-w-prose text-muted">
        A copied value is known only to the code that copies it: the store it came
        from does not record that the copy exists, so renaming or re-keying the
        source leaves the copy stale without an error. A foreign key into another
        store is declared, but no database enforces it across two stores.
      </p>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {refs.map((ref) => (
          <li
            key={`${ref.direction}:${ref.kind}:${ref.column}:${ref.target}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2"
          >
            <span className={`chip shrink-0 ${ref.kind === "copy" ? "status-declared" : "border-line-strong text-muted"}`}>
              {ref.kind === "copy" ? "copy" : "foreign key"}
            </span>
            {ref.direction === "out" ? (
              <>
                <Ident value={ref.column}>{local(ref.column)}</Ident>
                <span className="text-muted">{verb(ref)}</span>
                <Ident value={ref.target} />
                <span className="text-muted">in</span>
                {storeLink(ref.targetStore)}
              </>
            ) : (
              <>
                <Ident value={ref.column} />
                <span className="text-muted">in</span>
                {storeLink(ref.columnStore)}
                <span className="text-muted">{verb(ref)}</span>
                <Ident value={ref.target}>{local(ref.target)}</Ident>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StoreAccessMatrix({ store }: { store: Store }) {
  const matrix = useMemo(() => storeAccessMatrix(store, catalog), [store]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [scroller, viewWidth] = useViewWidth<HTMLDivElement>();

  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const columns: Column[] = matrix.services.flatMap((service): Column[] =>
    expanded.has(service.id)
      ? service.repositories.map((repository, at) => ({
          key: repositoryCellKey(service.id, repository.key),
          service,
          repository,
          first: at === 0,
        }))
      : [{ key: service.id, service, first: true }],
  );

  const declared = matrix.declaredReaders.length > 0 ? (
    <p className="mt-2 max-w-prose text-muted">
      Also listed as reading this store, with no table call of theirs recorded:{" "}
      {matrix.declaredReaders.map((id, at) => (
        <Fragment key={id}>
          {at > 0 ? ", " : null}
          <ServiceName id={id} />
        </Fragment>
      ))}
      . They have no column, because an empty one would claim they touch nothing.
    </p>
  ) : null;

  return (
    <div className="max-w-table">
      {matrix.accessCount === 0 ? (
        <>
          <Blank>
            No read or write of a table in {store.name} has been recorded. Calls come
            from the repository code an extractor reads - raw SQL, or gorm, sqlx,
            sqlc, ent and squirrel calls - and are credited to the method that makes
            them.
          </Blank>
          {declared}
        </>
      ) : (
        <section aria-labelledby="access-matrix">
          <SectionTitle>
            <span id="access-matrix">Who reads and writes each table</span>
          </SectionTitle>
          <Summary
            store={store}
            services={matrix.services}
            rows={matrix.rows}
            accessCount={matrix.accessCount}
          />
          {declared}
          <div className="mono mt-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {(["read", "write", "delete"] as const).map((operation) => (
              <span key={operation} className="inline-flex items-center gap-1">
                <Marks operations={[operation]} /> {operation}
              </span>
            ))}
            <span>· open a cell for the methods and source lines</span>
          </div>
          {/* Its own scroll box in both directions, like the evidence tables:
              the header and the table names stay pinned while a wide matrix
              moves under them, and the page itself never scrolls sideways. */}
          <div
            ref={scroller}
            className="isolate max-h-[70vh] overflow-auto rounded-card border border-line shadow-xs"
          >
            <table className="tbl tbl-sticky">
              <caption className="sr-only">
                Tables of {store.name} by the services that read or write them
              </caption>
              <thead>
                <tr className="text-left">
                  {/* A floor under the names: without it a narrow screen gives
                      the sticky column one letter per line to the marks. */}
                  <th scope="col" className="min-w-40 px-3 font-normal">
                    <span className="label">table</span>
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={`px-3 align-bottom font-normal whitespace-nowrap ${
                        column.first ? "border-l border-line" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5 py-1">
                        {column.first ? (
                          <>
                            <ServiceName id={column.service.id} />
                            {column.service.owner ? (
                              <span className="label text-faint">owner</span>
                            ) : null}
                            <button
                              type="button"
                              className="tbtn px-1"
                              aria-expanded={expanded.has(column.service.id)}
                              aria-label={`${expanded.has(column.service.id) ? "Merge" : "Split"} ${column.service.id} ${expanded.has(column.service.id) ? "back into one column" : "into its repositories"}`}
                              title={
                                expanded.has(column.service.id)
                                  ? "One column for the service"
                                  : `A column per repository (${column.service.repositories.length})`
                              }
                              onClick={() =>
                                setExpanded((was) => toggle(was, column.service.id))
                              }
                            >
                              {expanded.has(column.service.id) ? (
                                <ChevronsRightLeft size={13} aria-hidden />
                              ) : (
                                <ChevronsLeftRight size={13} aria-hidden />
                              )}
                            </button>
                          </>
                        ) : null}
                      </div>
                      {column.repository ? (
                        <div className="mono pb-1 text-muted" title={column.repository.dir}>
                          {column.repository.label}
                        </div>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => {
                  const isOpen = open.has(row.table.id);
                  const flip = () => setOpen((was) => toggle(was, row.table.id));
                  const evidence = columns
                    .map((column) => ({ column, cell: cellFor(row, column) }))
                    .filter((entry): entry is { column: Column; cell: AccessCell } =>
                      Boolean(entry.cell),
                    );
                  return (
                    <Fragment key={row.table.id}>
                      <tr>
                        <td
                          className="min-w-40 px-3"
                          style={
                            row.sharedWrite
                              ? { boxShadow: "inset 3px 0 0 var(--status-declared)" }
                              : undefined
                          }
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
                            {row.accessCount > 0 ? (
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-controls={`access-${row.table.id}`}
                                onClick={flip}
                                className="mono flex min-w-0 items-center gap-1 rounded-control text-left text-ink hover:text-accent"
                              >
                                {isOpen ? (
                                  <ChevronDown size={13} aria-hidden className="shrink-0" />
                                ) : (
                                  <ChevronRight size={13} aria-hidden className="shrink-0" />
                                )}
                                <span className="[overflow-wrap:anywhere]">{row.table.name}</span>
                              </button>
                            ) : (
                              <span className="mono pl-[17px] text-muted [overflow-wrap:anywhere]">
                                {row.table.name}
                              </span>
                            )}
                            {row.table.role &&
                            row.table.role !== "aggregate-root" &&
                            row.table.role !== row.table.name ? (
                              <span className="mono shrink-0 text-faint">{row.table.role}</span>
                            ) : null}
                            <SharedChip row={row} />
                          </div>
                        </td>
                        {columns.map((column) => {
                          const cell = cellFor(row, column);
                          return (
                            <td
                              key={column.key}
                              className={`px-3 whitespace-nowrap ${column.first ? "border-l border-line" : ""}`}
                            >
                              {cell ? (
                                <button
                                  type="button"
                                  onClick={flip}
                                  aria-expanded={isOpen}
                                  aria-controls={`access-${row.table.id}`}
                                  aria-label={`${row.table.name} by ${columnLabel(column)}: ${describe(cell)}`}
                                  title={describe(cell)}
                                  className="flex items-center gap-1.5 rounded-control py-1"
                                >
                                  <Marks operations={cell.operations} />
                                  <span className="mono tnum text-faint">
                                    {cell.accesses.length}
                                  </span>
                                </button>
                              ) : (
                                <span className="text-faint">
                                  <span aria-hidden>·</span>
                                  <span className="sr-only">no call recorded</span>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen ? (
                        <tr id={`access-${row.table.id}`}>
                          <td colSpan={columns.length + 1} className="p-0">
                            <div
                              className="sticky left-0 px-3 py-2"
                              style={viewWidth ? { width: viewWidth } : undefined}
                            >
                              {evidence.map(({ column, cell }) => (
                                <div key={column.key} className="py-1">
                                  <div className="mono text-muted">
                                    {columnLabel(column)}
                                  </div>
                                  <ul>
                                    {cell.accesses.map((access, at) => (
                                      <AccessLine
                                        key={`${access.operation}:${access.method}:${access.source}:${at}`}
                                        access={access}
                                        store={store}
                                      />
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {matrix.crossStore.length > 0 ? (
        <CrossStore refs={matrix.crossStore} store={store} />
      ) : null}
    </div>
  );
}
