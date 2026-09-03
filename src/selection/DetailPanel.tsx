// The right rail. One panel, one selection, every page that draws a diagram.
//
// It renders by kind rather than by page, so an event opened from a flow reads
// exactly the same as an event opened from the dependency graph. Nothing here
// navigates on its own: every route change is a link the reader chose.

import { Link } from "react-router";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import {
  Panel,
  ResizeHandle,
  SavedGroup,
  useCanvasResize,
  usePanelRef,
} from "../app/panels";
import { SidePanel } from "../components/Overlay";
import { useNarrow } from "../app/responsive";
import { useUiStore } from "../app/ui-store";
import { catalog, index } from "../data";
import {
  blockFields,
  columnId,
  columnNameOfId,
  mapsBlockId,
  mapsFieldPath,
  relationOfColumnId,
  storeViews,
  viewReads,
} from "../catalog";
import { flowsForService, usesOfDef } from "../lib/derive";
import { stepsInto } from "../lib/backlinks";
import { walkSteps } from "../catalog";
import { methodCount } from "../lib/api";
import {
  consumersOf,
  countsOf,
  dependenciesOf,
  registryUrl,
} from "../lib/registry";
import { typesDisagree } from "../lib/data-model";
import { STORE_KIND_LABEL } from "../er/StoreHeader";
import { upstreamOf } from "../er/lineage";
import type { LineageMaps } from "../er/lineage";
import { ctxStyle } from "../lib/context-color";
import { Ident } from "../components/Ident";
import { StatusChip } from "../components/primitives";
import { StepDetailBody } from "../flow/StepDetail";
import {
  AGGREGATE_ANCHOR,
  EVENT_ANCHOR,
  SERVICE_ANCHOR,
  eventPath as eventPathOf,
  blockPath,
  modulePath,
  paths,
} from "../routes";
import { PinButton } from "../app/pins";
import type { PinKind } from "../lib/pins";
import type { Resolved, Selection } from "./model";
import { resolveSelection } from "./model";
import { selectionPath } from "./pages";
import { useSelectionStore } from "./store";

/** The catalog's lineage graph, read whenever a column is open. */
const LINEAGE: LineageMaps = {
  from: index.lineageFrom,
  into: index.lineageInto,
};

function Label({ children }: { children: ReactNode }) {
  return <div className="label mt-3 mb-1">{children}</div>;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 py-0.5">{children}</div>;
}

/** The panel's own way of moving the selection, without leaving the page. */
function SelectLink({ id, children }: { id: string; children: ReactNode }) {
  const select = useSelectionStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(id, "panel")}
      title={id}
      className="mono trunc rounded-control text-left text-accent hover:underline"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Persistence bodies. A store, a table and a column are three zoom levels on
// one question — where does this live — so each one names the level above it
// and lists the level below.
// ---------------------------------------------------------------------------

function StoreBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "store" }>;
}) {
  const { store, service } = resolved;
  return (
    <>
      <Label>Kind</Label>
      <div className="mono text-muted">{STORE_KIND_LABEL[store.kind]}</div>

      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Tables</Label>
      {store.tables.length === 0 ? (
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

/**
 * Where a value goes and where it came from, as two lists of column links.
 *
 * Written once and used from both the table body and the column body, because
 * "who reads this" is the same question at either zoom level and a reader who
 * has learned to read it on a column should not have to learn it again.
 */
function LineageRows({ ids }: { ids: readonly string[] }) {
  return (
    <>
      {ids.map((id) => (
        <Row key={id}>
          <SelectLink id={id}>
            {relationOfColumnId(id).split(".").at(-1)}.{columnNameOfId(id)}
          </SelectLink>
        </Row>
      ))}
    </>
  );
}

function ViewBody({
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

function TableBody({
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

function ColumnBody({
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

function EventBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "event" }>;
}) {
  const { event, service } = resolved;
  const latest = event.versions[event.versions.length - 1];
  // The steps that carry this event, not just the flows: a panel that says
  // "checkout" sends the reader to the top of a forty-step rail, and one that
  // says "checkout · step 14" opens on the step.
  const steps = stepsInto(catalog, new Set([event.id]));
  const decisions = index.adrsByEvent.get(event.id) ?? [];

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {event.versions.map((v) => (
          <span
            key={v.version}
            className="mono rounded-control border px-1.5 py-px"
            style={{
              borderColor: v === latest ? "var(--accent)" : "var(--border)",
              color: v === latest ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {v.version}
          </span>
        ))}
      </div>

      <Label>Producer</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Schema · {latest?.version ?? "—"}</Label>
      <table className="w-full">
        <tbody>
          {(latest?.fields ?? []).map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 text-muted">
                {f.ref ? <SelectLink id={f.ref}>{f.type}</SelectLink> : f.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Label>Consumers</Label>
      {event.consumers.length === 0 ? (
        <div className="mono text-muted">nothing consumes this event</div>
      ) : null}
      {event.consumers.map((c) => (
        <Row key={c.service}>
          <SelectLink id={c.service}>{c.service}</SelectLink>
          {c.via ? (
            <Link
              to={paths.flowStep(c.via.flow, c.via.step)}
              className="mono shrink-0 text-muted hover:text-ink hover:underline"
              title={`read from flow ${c.via.flow}, step ${c.via.step}; no source declares this consumer`}
            >
              via flow
            </Link>
          ) : null}
          <span className="ml-auto shrink-0">
            <StatusChip status={c.status} title={c.note} />
          </span>
        </Row>
      ))}

      <Label>Appears in flows</Label>
      {steps.length === 0 ? (
        <div className="mono text-muted">no flow references this event</div>
      ) : (
        <div className="flex flex-col gap-1">
          {steps.map((s) => (
            <Link
              key={`${s.flow.slug}:${s.stepId}`}
              to={paths.flowStep(s.flow.slug, s.stepId)}
              className="mono text-accent"
            >
              {s.flow.slug} · step {s.number} →
            </Link>
          ))}
        </div>
      )}

      {decisions.length > 0 ? (
        <>
          <Label>Decisions</Label>
          <div className="flex flex-col gap-1">
            {decisions.map((adr) => (
              <Link
                key={adr.id}
                to={paths.adr(adr.slug)}
                className="mono truncate text-accent"
                title={adr.title}
              >
                {adr.id} · {adr.title}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <Label>Source</Label>
      {latest?.source ? (
        <Ident block value={latest.source} className="text-muted" />
      ) : (
        <div className="mono text-muted">not recorded</div>
      )}
    </>
  );
}

/**
 * What the panel calls the thing it is showing.
 *
 * Most kinds are their id, which the line underneath already prints. These are
 * the ones with a name a reader would say out loud instead - and it is a
 * function rather than a ternary chain because it was nine levels deep before
 * a tenth kind existed.
 */
function titleOf(resolved: Resolved | null, selection: Selection): string {
  if (!resolved) return selection.id;

  switch (resolved.kind) {
    case "event":
      return resolved.event.name;
    case "table":
      return resolved.table.name;
    case "view":
      return resolved.view.name;
    case "column":
      return `${resolved.view?.name ?? resolved.table?.name ?? resolved.store.slug}.${resolved.column.name}`;
    case "flow-step":
      return resolved.step.label ?? resolved.step.ref ?? resolved.step.kind;
    case "bundle":
      return `${resolved.bundle.from} → ${resolved.bundle.to}`;
    // `acme/shop`, not the registry host as well: the host is the same for
    // every module in almost every estate.
    case "module":
      return resolved.module.name;
    default:
      return selection.id;
  }
}

function ModuleBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "module" }>;
}) {
  const { module } = resolved;
  const counts = countsOf(index, module);
  const consumers = consumersOf(index, module);
  const deps = dependenciesOf(index, module);
  const owner = module.owner ? index.serviceById.get(module.owner) : undefined;
  const url = registryUrl(module);
  const to = modulePath(module.id);

  return (
    <>
      {module.registry ? <Label>{module.registry}</Label> : null}
      <Label>commit</Label>
      <Row>
        {module.commit ? (
          <Ident value={module.commit.slice(0, 12)} />
        ) : (
          /* Not pinned is a fact worth saying: it means two builds a day apart
             can describe two different modules under one name. */
          <span className="text-muted">not pinned</span>
        )}
      </Row>

      <Label>holds</Label>
      <div className="rows">
        <div className="row">
          <span className="flex-1">packages</span>
          <span className="tnum text-muted">{counts.packages}</span>
        </div>
        <div className="row">
          <span className="flex-1">interfaces</span>
          <span className="tnum text-muted">{counts.interfaces}</span>
        </div>
        <div className="row">
          <span className="flex-1">methods</span>
          <span className="tnum text-muted">{counts.methods}</span>
        </div>
        <div className="row">
          <span className="flex-1">messages</span>
          <span className="tnum text-muted">{counts.messages}</span>
        </div>
      </div>

      {/* Who publishes it, and - the more interesting half - who else reads it. */}
      <Label>published by</Label>
      {owner ? (
        <SelectLink id={owner.id}>{owner.id}</SelectLink>
      ) : (
        <p className="text-muted">
          nobody in this catalog — the module is published elsewhere
        </p>
      )}

      {consumers.length > 0 ? (
        <>
          <Label>read by</Label>
          <div className="rows">
            {consumers.map((service) => (
              <SelectLink key={service.id} id={service.id}>
                {service.id}
              </SelectLink>
            ))}
          </div>
        </>
      ) : null}

      {deps.length > 0 ? (
        <>
          <Label>depends on</Label>
          <div className="rows">
            {deps.map((dep) =>
              dep.module ? (
                <Link
                  key={dep.id}
                  to={paths.module(dep.module.slug)}
                  className="row mono hover:text-ink"
                >
                  {dep.module.name}
                </Link>
              ) : (
                /* A module may depend on one the estate never vendored. Naming
                   it and saying so beats a link into nothing. */
                <div key={dep.id} className="row mono text-muted">
                  {dep.id}
                  <span className="ml-auto">not in this catalog</span>
                </div>
              ),
            )}
          </div>
        </>
      ) : null}

      {to ? (
        <Link to={to} className="mt-3 block text-muted hover:text-ink">
          open the module →
        </Link>
      ) : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block text-muted hover:text-ink"
        >
          {module.name} on {module.registry} ↗
        </a>
      ) : null}
    </>
  );
}

function ServiceBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "service" }>;
}) {
  const { service, context } = resolved;
  const methods = methodCount(service);
  const events = service.aggregates.flatMap((a) => a.events);
  const unresolved = service.consumes.filter((c) => c.status === "unresolved");
  // Each flow this service takes part in, opened on the first step it is
  // on either end of - where it enters the story, not the top of the rail.
  const appearances = flowsForService(catalog, service.id).map((flow) => {
    const steps = walkSteps(flow.steps);
    const at = steps.findIndex((s) => s.from === service.id || s.to === service.id);
    return { flow, step: at >= 0 ? steps[at] : undefined, number: at + 1 };
  });

  return (
    <>
      <Ident
        block
        value={`${service.repo}/${service.path}`}
        className="mt-1.5 text-muted"
      />

      <Label>Provides</Label>
      {/* The count opens the tab that lists the methods it counted. */}
      <Link
        to={`${paths.service(context.id, service.slug)}?tab=provides`}
        className="mono rounded-control text-muted hover:text-ink"
      >
        <span className="tnum">{methods}</span> method
        {methods === 1 ? "" : "s"} over{" "}
        <span className="tnum">{service.provides.length}</span> service
        {service.provides.length === 1 ? "" : "s"}
      </Link>
      {service.provides.map((p) => (
        <Ident block key={p.id} value={p.id} className="text-muted" />
      ))}

      <Label>Consumes</Label>
      {service.consumes.length === 0 ? (
        <div className="mono text-muted">this service calls nobody</div>
      ) : null}
      {service.consumes.map((call) => (
        <Row key={call.id}>
          <Ident value={call.id} />
          <span className="ml-auto shrink-0">
            <StatusChip status={call.status} title={call.note} />
          </span>
        </Row>
      ))}
      {unresolved.length > 0 ? (
        <Link
          to={paths.problems()}
          className="mono mt-1 block rounded-control text-unresolved hover:underline"
        >
          <span className="tnum">{unresolved.length}</span> call
          {unresolved.length === 1 ? "" : "s"} resolve to nothing in the catalog
          →
        </Link>
      ) : null}

      <Label>Publishes</Label>
      {events.length === 0 ? (
        <div className="mono text-muted">no events</div>
      ) : null}
      {events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
          <Link
            to={`${eventPathOf(e.id) ?? paths.service(context.id, service.slug)}#${EVENT_ANCHOR.consumers}`}
            title={`${e.consumers.length} consumers of ${e.name}`}
            className="mono tnum ml-auto shrink-0 rounded-control text-muted hover:text-ink"
          >
            {e.consumers.length}
          </Link>
        </Row>
      ))}

      <Label>Appears in flows</Label>
      {appearances.length === 0 ? (
        <div className="mono text-muted">appears in no flow</div>
      ) : (
        <div className="flex flex-col gap-1">
          {appearances.map(({ flow, step, number }) => (
            <Link
              key={flow.slug}
              to={step ? paths.flowStep(flow.slug, step.id) : paths.flow(flow.slug)}
              className="mono text-accent"
              title={step ? `${flow.name}, from step ${number}` : flow.name}
            >
              {flow.slug}
              {step ? ` · step ${number}` : ""} →
            </Link>
          ))}
        </div>
      )}

      <Label>Context</Label>
      <SelectLink id={context.id}>{context.id}</SelectLink>
    </>
  );
}

function AggregateBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "aggregate" }>;
}) {
  const { aggregate, service, context } = resolved;
  const commands = aggregate.operations.filter((o) => o.kind === "command");
  const queries = aggregate.operations.filter((o) => o.kind === "query");
  const aggregatePath = paths.aggregate(
    context.id,
    service.slug,
    aggregate.slug,
  );

  return (
    <>
      <Label>Owner</Label>
      <SelectLink id={service.id}>{service.id}</SelectLink>

      <Label>Operations</Label>
      <div className="mono flex gap-3 text-muted">
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.commands}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{commands.length}</span> command
          {commands.length === 1 ? "" : "s"}
        </Link>
        <Link
          to={`${aggregatePath}#${AGGREGATE_ANCHOR.queries}`}
          className="rounded-control hover:text-ink"
        >
          <span className="tnum">{queries.length}</span> quer
          {queries.length === 1 ? "y" : "ies"}
        </Link>
      </div>

      <Label>Events</Label>
      {aggregate.events.length === 0 ? (
        <div className="mono text-muted">this aggregate publishes nothing</div>
      ) : null}
      {aggregate.events.map((e) => (
        <Row key={e.id}>
          <SelectLink id={e.id}>{e.name}</SelectLink>
        </Row>
      ))}
    </>
  );
}

function ContextBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "context" }>;
}) {
  const { context } = resolved;
  return (
    <>
      <p className="mt-1.5 text-muted">{context.summary}</p>
      <Label>Services</Label>
      {context.services.map((s) => (
        <Row key={s.id}>
          <SelectLink id={s.id}>{s.slug}</SelectLink>
          <Link
            to={`${paths.service(context.id, s.slug)}#${SERVICE_ANCHOR.events}`}
            className="mono ml-auto shrink-0 rounded-control text-muted hover:text-ink"
          >
            <span className="tnum">
              {s.aggregates.reduce((n, a) => n + a.events.length, 0)}
            </span>{" "}
            events
          </Link>
        </Row>
      ))}
    </>
  );
}

function ValueObjectBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "value-object" }>;
}) {
  const uses = usesOfDef(catalog, resolved.id);
  return (
    <>
      <Label>Fields</Label>
      <table className="w-full">
        <tbody>
          {resolved.def.fields.map((f) => (
            <tr key={f.name} className="align-top">
              <td className="mono py-0.5 pr-2 whitespace-nowrap">{f.name}</td>
              <td className="mono py-0.5 pr-2 text-muted">
                {f.ref ? <SelectLink id={f.ref}>{f.type}</SelectLink> : f.type}
              </td>
              <td className="py-0.5 text-muted">{f.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Label>Used in</Label>
      {uses.events.length === 0 && uses.defs.length === 0 ? (
        <div className="mono text-muted">nothing carries this type</div>
      ) : null}
      {uses.events.map((use) => (
        <Row key={use.eventId}>
          <SelectLink id={use.eventId}>{use.eventId}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">
            {use.versions.join(" ")}
          </span>
        </Row>
      ))}
      {uses.defs.map((id) => (
        <Row key={id}>
          <SelectLink id={id}>{id}</SelectLink>
          <span className="mono ml-auto shrink-0 text-muted">type</span>
        </Row>
      ))}
    </>
  );
}

function FlowStepBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "flow-step" }>;
}) {
  return (
    <>
      <div className="mono mt-1 mb-2 flex items-center gap-2 text-muted">
        <Link to={paths.flow(resolved.flow.slug)} className="text-accent">
          {resolved.flow.slug}
        </Link>
      </div>
      <StepDetailBody step={resolved.step} flow={resolved.flow} />
    </>
  );
}

/**
 * One bundled edge, opened.
 *
 * Compact mode trades every event label for a number, and this is where the
 * number is spent: the count on the line is the length of this list, and the
 * list is the only place the reader can find out which events it stood for.
 */
function BundleBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "bundle" }>;
}) {
  const { bundle } = resolved;
  return (
    <>
      <Label>Publisher</Label>
      <SelectLink id={bundle.from}>{bundle.from}</SelectLink>

      <Label>Consumer</Label>
      {resolved.to ? (
        <SelectLink id={bundle.to}>{bundle.to}</SelectLink>
      ) : (
        <div className="mono text-muted" title="not in the catalog">
          {bundle.to} — not in catalog
        </div>
      )}

      <Label>
        {bundle.events.length} {bundle.events.length === 1 ? "event" : "events"}
      </Label>
      {bundle.events.map((event) => (
        <Row key={event.id}>
          <SelectLink id={event.id}>{event.name}</SelectLink>
          <span className="ml-auto shrink-0">
            <StatusChip status={event.status} />
          </span>
        </Row>
      ))}
    </>
  );
}

/**
 * A node the model draws but the catalog has never heard of — an external
 * participant, most often. Saying so beats saying nothing.
 */
function UnknownBody({ selection }: { selection: Selection }) {
  const consumers = catalog.contexts.flatMap((c) =>
    c.services.flatMap((s) =>
      s.aggregates.flatMap((a) =>
        a.events
          .filter((e) => e.consumers.some((x) => x.service === selection.id))
          .map((e) => e),
      ),
    ),
  );
  const flows = catalog.flows.filter((f) =>
    f.participants.some((p) => p.id === selection.id),
  );

  return (
    <>
      <p className="meta mt-1.5 text-unresolved">
        nothing in the catalog owns this id
      </p>
      {consumers.length > 0 ? (
        <>
          <Label>Named as a consumer of</Label>
          {consumers.map((e) => (
            <Row key={e.id}>
              <SelectLink id={e.id}>{e.name}</SelectLink>
            </Row>
          ))}
        </>
      ) : null}
      {flows.length > 0 ? (
        <>
          <Label>Appears in flows</Label>
          {flows.map((f) => (
            <Link
              key={f.slug}
              to={paths.flow(f.slug)}
              className="mono block text-accent"
            >
              {f.slug} →
            </Link>
          ))}
        </>
      ) : null}
      {consumers.length === 0 && flows.length === 0 ? (
        <p className="meta mt-3">it is not referenced anywhere else either</p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function kindLabel(selection: Selection, resolved: Resolved | null): string {
  if (!resolved) return "unknown";
  if (resolved.kind === "flow-step") return `step ${resolved.number}`;
  return selection.kind;
}

/**
 * What pinning the open selection would pin, or null when the selection is not
 * a thing a reader can come back to. A column, a view and a store are read
 * inside the canvas that holds them; a step is read inside its flow. Pinning
 * one of those would bookmark a scroll position rather than an entity.
 */
function pinFor(
  resolved: Resolved | null,
): { kind: PinKind; id: string } | null {
  if (!resolved) return null;
  switch (resolved.kind) {
    case "event":
      return { kind: "event", id: resolved.event.id };
    case "service":
      return { kind: "service", id: resolved.service.id };
    case "aggregate":
      return { kind: "aggregate", id: resolved.aggregate.id };
    case "table":
      return { kind: "table", id: resolved.table.id };
    default:
      return null;
  }
}

export function DetailPanel() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  if (!selection) return null;

  const resolved = resolveSelection(selection.id);
  const page = selectionPath(selection);
  const pin = pinFor(resolved);

  return (
    <aside
      /* Slides 16px and fades in when the panel appears - not on every change
         of selection, which would set the whole rail moving each time the
         reader clicked a step. There is no exit: it unmounts on clear. */
      className="panel-in pane flex h-full w-full flex-col border-l border-line bg-canvas"
      aria-label="Selection detail"
    >
      <div className="sticky-bar flex shrink-0 items-center gap-2 border-b px-4 py-2.5 border-line">
        <span className="label">{kindLabel(selection, resolved)}</span>
        {resolved?.kind === "flow-step" ? (
          <StatusChip status={resolved.step.status} />
        ) : null}
        {/* Right-aligned beside the close: both are about the panel rather
            than about what is in it. */}
        {pin ? (
          <span className="ml-auto flex items-center">
            <PinButton kind={pin.kind} id={pin.id} size={14} />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => clear("panel")}
          aria-label="Close selection detail (Esc)"
          title="Esc"
          className="ml-auto rounded-control p-1 text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="mono break-all text-sm text-ink">
            {titleOf(resolved, selection)}
          </span>
          {resolved?.kind === "event" ||
          resolved?.kind === "service" ||
          resolved?.kind === "aggregate" ? (
            <span
              className="mono ctx"
              style={ctxStyle(
                "context" in resolved ? resolved.context.id : null,
              )}
            >
              {resolved.context.id}
            </span>
          ) : null}
        </div>
        {/* A synthetic id is not something a reader can paste anywhere, so a
            step and a bundle keep theirs to themselves. */}
        {resolved !== null &&
        resolved.kind !== "flow-step" &&
        resolved.kind !== "bundle" ? (
          <Ident block value={selection.id} className="mt-0.5 text-muted" />
        ) : null}

        {page ? (
          <Link
            to={page}
            className="mono mt-3 inline-block rounded-control text-accent hover:underline"
          >
            open page →
          </Link>
        ) : null}

        {resolved === null ? (
          <UnknownBody selection={selection} />
        ) : resolved.kind === "event" ? (
          <EventBody resolved={resolved} />
        ) : resolved.kind === "service" ? (
          <ServiceBody resolved={resolved} />
        ) : resolved.kind === "aggregate" ? (
          <AggregateBody resolved={resolved} />
        ) : resolved.kind === "context" ? (
          <ContextBody resolved={resolved} />
        ) : resolved.kind === "value-object" ? (
          <ValueObjectBody resolved={resolved} />
        ) : resolved.kind === "store" ? (
          <StoreBody resolved={resolved} />
        ) : resolved.kind === "table" ? (
          <TableBody resolved={resolved} />
        ) : resolved.kind === "view" ? (
          <ViewBody resolved={resolved} />
        ) : resolved.kind === "column" ? (
          <ColumnBody resolved={resolved} />
        ) : resolved.kind === "bundle" ? (
          <BundleBody resolved={resolved} />
        ) : resolved.kind === "module" ? (
          <ModuleBody resolved={resolved} />
        ) : (
          <FlowStepBody resolved={resolved} />
        )}
      </div>
    </aside>
  );
}

/**
 * Page shell for the routes that embed a diagram: the page on the left, the
 * selection detail on the right.
 *
 * The detail panel is not opened by dragging. It is collapsed to nothing while
 * there is no selection and expanded the moment there is one, driven from the
 * store rather than from the handle - the handle only decides how wide it is
 * once open, and that width is what gets remembered.
 */
export function WithDetail({
  id,
  children,
}: {
  /** Page name for the persisted layout: "portolan:<page>". */
  id: string;
  children: ReactNode;
}) {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  const hidden = useUiStore((s) => s.detailHidden);
  const setHidden = useUiStore((s) => s.setDetailHidden);
  const detailRef = usePanelRef();
  const settle = useCanvasResize();
  const narrow = useNarrow();
  const open = selection !== null && !hidden;

  // Picking something new is a request to see it. "]" means "not now", not
  // "never again", so the next selection brings the rail back rather than
  // landing silently behind a panel the reader forgot they folded away.
  const selectedId = selection?.id ?? null;
  useEffect(() => {
    if (selectedId !== null) setHidden(false);
  }, [selectedId, setHidden]);

  useEffect(() => {
    const panel = detailRef.current;
    if (!panel) return;
    if (open) panel.expand();
    else panel.collapse();
    // `narrow` is in the list because the Group unmounts across the
    // breakpoint: the panel that comes back has to be told again.
  }, [open, narrow, detailRef]);

  // Below the breakpoint there is no room for a third pane, so the rail becomes
  // a sheet over the page. Esc is already the app's "clear the selection", and
  // clearing the selection is exactly what closes this.
  if (narrow) {
    return (
      <div className="relative h-full min-h-0">
        {children}
        <SidePanel
          open={open}
          onClose={() => clear("panel")}
          side="right"
          label="Selection detail"
          width="85%"
        >
          <DetailPanel />
        </SidePanel>
      </div>
    );
  }

  return (
    <SavedGroup
      id={`portolan:${id}`}
      orientation="horizontal"
      className="h-full min-h-0"
    >
      <Panel id="content" className="h-full min-w-0" onResize={settle}>
        {children}
      </Panel>

      <ResizeHandle id="detail" />

      <Panel
        id="detail"
        defaultSize="24"
        minSize="16"
        collapsible
        collapsedSize="0"
        panelRef={detailRef}
        className="h-full"
        onResize={settle}
      >
        <DetailPanel />
      </Panel>
    </SavedGroup>
  );
}
