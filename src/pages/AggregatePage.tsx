import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { catalog, index } from "../data";
import { blockCounts, blockFields, rootEntity } from "../catalog";
import type {
  Aggregate,
  Block,
  BlockKind,
  Operation,
  Service,
} from "../catalog";
import { markdownOutline } from "../lib/derive";
import { tablesPersisting, viewsPresenting } from "../lib/data-model";
import { plural } from "../lib/format";
import { KIND_LABEL, KIND_PLURAL } from "../lib/kinds";
import type { LeafKind } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import {
  AGGREGATE_ANCHOR,
  AGGREGATE_SECTION,
  EVENT_ANCHOR,
  LINKS_HERE,
  paths,
  servicePath,
  tablePath,
  viewPath,
} from "../routes";
import { methodId } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { NotFound } from "./NotFound";

/**
 * The strip above the readme. It answers "what is in this aggregate" before
 * the prose gets a chance to, and every count is a way into the section that
 * holds the things counted.
 */
function BuildingBlocks({
  aggregate,
  rootTo,
}: {
  aggregate: Aggregate;
  rootTo: string | null;
}) {
  const counts = blockCounts(aggregate);
  const chips: { kind: LeafKind; n: number; anchor: string }[] = [
    { kind: "entity", n: counts.entities, anchor: AGGREGATE_ANCHOR.entities },
    {
      kind: "vo",
      n: counts.valueObjects,
      anchor: AGGREGATE_ANCHOR.valueObjects,
    },
    { kind: "event", n: counts.events, anchor: AGGREGATE_ANCHOR.events },
    { kind: "command", n: counts.commands, anchor: AGGREGATE_ANCHOR.commands },
    { kind: "query", n: counts.queries, anchor: AGGREGATE_ANCHOR.queries },
  ];

  return (
    <section className="mb-section overflow-hidden rounded-card border border-line shadow-xs">
      <div className="label border-b border-line bg-surface px-4 py-2">
        Building blocks
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="mono flex items-center gap-1.5 text-muted">
          root
          <KindIcon kind="entity" />
          {rootTo ? (
            <Link to={rootTo} className="text-ink hover:underline">
              {aggregate.root}
            </Link>
          ) : (
            <span className="text-ink">{aggregate.root}</span>
          )}
        </span>
        <span aria-hidden className="h-4 w-px bg-line-strong" />
        {chips.map(({ kind, n, anchor }) => (
          <a
            key={kind}
            href={`#${anchor}`}
            className="mono flex items-center gap-1.5 text-muted hover:text-ink"
            title={`jump to ${KIND_PLURAL[kind]}`}
          >
            <KindIcon kind={kind} />
            <span
              className={n === 0 ? "text-muted" : "text-ink"}
              style={
                kind === "event" && n > 0
                  ? { color: "var(--kind-event)" }
                  : undefined
              }
            >
              {n}
            </span>
            {n === 1 ? KIND_LABEL[kind] : KIND_PLURAL[kind]}
          </a>
        ))}
      </div>
    </section>
  );
}

function BlockList({
  kind,
  blocks,
  linkTo,
  rootName,
}: {
  kind: BlockKind;
  blocks: Block[];
  linkTo: (block: Block) => string;
  rootName?: string;
}) {
  if (blocks.length === 0) {
    return (
      <Empty>no {KIND_PLURAL[kind]} declared — the shape lives elsewhere</Empty>
    );
  }
  return (
    /* icon, the block itself, where its shape comes from, actions - one
       column each, so the provenance holds the same column down the list. */
    <div className="rows grid-cols-[auto_1fr_auto_auto]" data-nav-list>
      {/* A div holding a link, not a link holding buttons: the shared-type id
          copies itself and the row carries actions, and neither of those can
          live inside an anchor. */}
      {blocks.map((block) => {
        const fields = blockFields(catalog, block);
        return (
          <div key={block.id} className="row items-start gap-2 px-3 py-2">
            <span className="mt-0.5 flex shrink-0">
              <KindIcon kind={kind} />
            </span>
            <span className="min-w-0 flex-1">
              <Link
                to={linkTo(block)}
                data-nav-item
                className="mono rounded-control"
                title={block.name}
              >
                {block.name}
              </Link>
              {block.name === rootName ? (
                <span className="mono ml-2 text-muted">root</span>
              ) : null}
              <span className="meta block truncate" title={block.doc}>
                {block.doc}
              </span>
            </span>
            <span className="mono flex shrink-0 items-center gap-2 text-muted">
              {block.ref ? (
                <Ident value={block.ref} title={`shared type ${block.ref}`} />
              ) : (
                <span title="shape written inline">inline</span>
              )}
              <span>{fields.length}f</span>
            </span>
            <RowActions copy={block.id} label={block.name} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Commands and queries with what each one actually does. The sentence is the
 * point: a bare `CancelOrder` says nothing about when it is refused, and the
 * precondition is exactly what a reader came to this page for.
 */
function OperationList({
  kind,
  operations,
  service,
}: {
  kind: "command" | "query";
  operations: Operation[];
  service: Service;
}) {
  // Whether this service records what exposes an operation at all. A catalog
  // written before anything read a transport layer says nothing either way,
  // and answering "no endpoint runs it" from that silence would be inventing.
  const recorded = service.aggregates.some((aggregate) =>
    aggregate.operations.some((operation) => operation.exposedBy?.length),
  );
  const to = servicePath(service.id);

  return (
    <ul className="flex flex-col gap-1">
      {operations.map((op) => (
        <li
          key={op.id}
          className={`flex items-start gap-2 border-l-2 px-2 py-1.5 bg-surface ${
            kind === "command" ? "border-verified" : "border-line-strong"
          }`}
        >
          <span className="mt-px shrink-0">
            <KindIcon kind={kind} />
          </span>
          <div className="min-w-0">
            <Ident block value={op.id} />
            {op.doc ? <p className="mt-0.5 text-muted">{op.doc}</p> : null}
            {op.exposedBy?.length ? (
              <p className="mono mt-1 flex flex-wrap items-center gap-x-2 text-muted">
                <span>exposed by</span>
                {op.exposedBy.map((method) =>
                  to ? (
                    <Link
                      key={method}
                      to={`${to}?tab=provides`}
                      className="rounded-control hover:text-ink"
                      title="the interface method that runs this"
                    >
                      {methodId(service, method)}
                    </Link>
                  ) : (
                    <span key={method}>{methodId(service, method)}</span>
                  ),
                )}
              </p>
            ) : recorded ? (
              // Said out loud rather than left blank: an operation no endpoint
              // runs is reachable only from inside, and here that is a design
              // decision rather than an omission.
              <p className="mono mt-1 text-muted">
                no endpoint runs it — internal to the service
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AggregatePage() {
  const {
    context: contextId,
    service: serviceSlug,
    aggregate: aggSlug,
  } = useParams();
  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const aggregate = service?.aggregates.find((a) => a.slug === aggSlug);

  const outline = useMemo(
    () => (aggregate ? markdownOutline(aggregate.readme) : []),
    [aggregate],
  );

  if (!context || !service || !aggregate)
    return <NotFound kind="Aggregate" id={aggSlug} />;

  const commands = aggregate.operations.filter((o) => o.kind === "command");
  const queries = aggregate.operations.filter((o) => o.kind === "query");
  const root = rootEntity(aggregate);
  const persistence = tablesPersisting(index, aggregate.id);
  const presented = viewsPresenting(index, aggregate.id);

  // The readme's own headings first, then the five sections the page adds
  // under it. One rail, in the order the page is actually written in.
  const toc: TocItem[] = [
    ...outline.map((h) => ({ id: h.slug, label: h.text, depth: h.depth })),
    { id: AGGREGATE_ANCHOR.entities, label: "Entities" },
    { id: AGGREGATE_ANCHOR.valueObjects, label: "Value objects" },
    { id: AGGREGATE_ANCHOR.events, label: "Events" },
    { id: AGGREGATE_ANCHOR.commands, label: "Commands" },
    { id: AGGREGATE_ANCHOR.queries, label: "Queries" },
    { id: AGGREGATE_SECTION.persistence, label: "Persistence" },
    { id: LINKS_HERE, label: "What links here" },
  ];

  const voPath = (block: Block) =>
    paths.valueObject(context.id, service.slug, aggregate.slug, block.slug);
  const entityPath = (block: Block) =>
    paths.entity(context.id, service.slug, aggregate.slug, block.slug);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={`aggregate · ${service.id}`}
        name={aggregate.name}
        id={aggregate.id}
        contextId={context.id}
        pin={{ kind: "aggregate", id: aggregate.id }}
      />

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <BuildingBlocks
            aggregate={aggregate}
            rootTo={root ? entityPath(root) : null}
          />

          <Markdown>{aggregate.readme}</Markdown>

          <div
            className="mt-section max-w-prose"
            id={AGGREGATE_ANCHOR.entities}
          >
            <SectionTitle
              anchor={AGGREGATE_ANCHOR.entities}
              right={
                <span>
                  identity matters — these are tracked over time
                </span>
              }
            >
              Entities
            </SectionTitle>
            <BlockList
              kind="entity"
              blocks={aggregate.entities}
              linkTo={entityPath}
              rootName={aggregate.root}
            />
          </div>

          <div
            className="mt-section max-w-prose"
            id={AGGREGATE_ANCHOR.valueObjects}
          >
            <SectionTitle
              anchor={AGGREGATE_ANCHOR.valueObjects}
              right={
                <span>
                  no identity — equal values are the same value
                </span>
              }
            >
              Value objects
            </SectionTitle>
            <BlockList
              kind="vo"
              blocks={aggregate.valueObjects}
              linkTo={voPath}
            />
          </div>

          <div className="mt-section max-w-prose" id={AGGREGATE_ANCHOR.events}>
            <SectionTitle anchor={AGGREGATE_ANCHOR.events}>Events</SectionTitle>
            {aggregate.events.length === 0 ? (
              <Empty>
                nothing is announced from here — the readme says why
              </Empty>
            ) : (
              /* The row is a div rather than a link so the consumer count can
                 be a link of its own: a count that says "4 consumers" and does
                 not take you to them is a count that lied. */
              <div
                className="rows grid-cols-[auto_auto_1fr_auto_auto]"
                data-nav-list
              >
                {aggregate.events.map((event) => {
                  const to = paths.event(
                    context.id,
                    service.slug,
                    aggregate.slug,
                    event.slug,
                  );
                  return (
                    <div key={event.id} className="row gap-2 px-3 py-2">
                      <KindIcon kind="event" />
                      <Link
                        to={to}
                        data-nav-item
                        className="mono rounded-control"
                        style={{ color: "var(--kind-event)" }}
                      >
                        {event.name}
                      </Link>
                      <span className="flex gap-1">
                        {event.versions.map((v, i) => (
                          <span
                            key={v.version}
                            className="mono rounded-[4px] border px-1"
                            style={{
                              borderColor:
                                i === event.versions.length - 1
                                  ? "var(--accent)"
                                  : "var(--border)",
                              color:
                                i === event.versions.length - 1
                                  ? "var(--accent)"
                                  : "var(--fg-muted)",
                            }}
                          >
                            {v.version}
                          </span>
                        ))}
                      </span>
                      <Link
                        to={`${to}#${EVENT_ANCHOR.consumers}`}
                        className="mono rounded-control text-muted hover:text-ink"
                        title="open the consumers of this event"
                      >
                        <span className="tnum">{event.consumers.length}</span>{" "}
                        {event.consumers.length === 1
                          ? "consumer"
                          : "consumers"}
                      </Link>
                      <RowActions
                        copy={event.id}
                        reveal={event.id}
                        label={event.name}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* One column, not two: an operation whose precondition is written
              down is a paragraph, and two prose columns half a page wide would
              turn every one of them into a ladder. */}
          <div className="mt-8 flex max-w-prose flex-col gap-section">
            <div id={AGGREGATE_ANCHOR.commands}>
              <SectionTitle
                anchor={AGGREGATE_ANCHOR.commands}
                right={
                  <span>
                    they change the aggregate — one row lock each
                  </span>
                }
              >
                Commands
              </SectionTitle>
              {commands.length === 0 ? (
                <Empty>nothing changes this aggregate from outside</Empty>
              ) : null}
              <OperationList kind="command" operations={commands} service={service} />
            </div>
            <div id={AGGREGATE_ANCHOR.queries}>
              <SectionTitle
                anchor={AGGREGATE_ANCHOR.queries}
                right={
                  <span>
                    they change nothing — and may be behind
                  </span>
                }
              >
                Queries
              </SectionTitle>
              {queries.length === 0 ? (
                <Empty>nothing reads this aggregate by name</Empty>
              ) : null}
              <OperationList kind="query" operations={queries} service={service} />
            </div>
          </div>

          {/* Where this aggregate actually lives. It sits after the model and
              before the backlinks because it answers a question about THIS
              aggregate — one a reader asks once they believe the model. */}
          <div
            className="mt-section max-w-table"
            id={AGGREGATE_SECTION.persistence}
          >
            <SectionTitle
              anchor={AGGREGATE_SECTION.persistence}
              right={
                <span>
                  one row per table that holds it
                  {presented.length > 0 ? ", then the views over it" : ""}
                </span>
              }
            >
              Persistence
            </SectionTitle>
            {persistence.length === 0 ? (
              <Empty>
                No persistence found for {aggregate.name} — the extractor maps
                tables via `persists` in migrations metadata
              </Empty>
            ) : (
              /* icon, name, what it is, store, width, actions. Tables and
                 views share the columns because a reader reads them as one
                 list - which is why a table with no role still emits the
                 cell the views put their kind in. */
              <div
                className="rows grid-cols-[auto_auto_auto_1fr_auto_auto]"
                data-nav-list
              >
                {persistence.map(({ table, store }) => {
                  const to = tablePath(table.id);
                  return (
                    <div key={table.id} className="row px-2 py-1.5">
                      <KindIcon kind="table" />
                      {to ? (
                        <Link
                          to={to}
                          data-nav-item
                          className="mono rounded-control"
                        >
                          {table.name}
                        </Link>
                      ) : (
                        <span className="mono">{table.name}</span>
                      )}
                      {table.role ? (
                        <span className="chip">{table.role}</span>
                      ) : (
                        <span />
                      )}
                      <span className="mono text-muted">{store.slug}</span>
                      <span className="mono text-muted">
                        <span className="tnum">{table.columns.length}</span>{" "}
                        {plural(table.columns.length, "column")}
                      </span>
                      <RowActions
                        copy={table.id}
                        reveal={table.id}
                        label={table.name}
                      />
                    </div>
                  );
                })}
                {/* A view is not persistence — it holds nothing — but it is
                    how this aggregate is actually read back, and a reader who
                    has found the tables wants the reports over them next. */}
                {presented.map(({ view, store }) => {
                  const to = viewPath(view.id);
                  return (
                    <div key={view.id} className="row px-2 py-1.5">
                      <KindIcon kind="view" />
                      {to ? (
                        <Link
                          to={to}
                          data-nav-item
                          className="mono rounded-control"
                        >
                          {view.name}
                        </Link>
                      ) : (
                        <span className="mono">{view.name}</span>
                      )}
                      <span className="chip">
                        {view.materialized ? "matview" : "view"}
                      </span>
                      <span className="mono text-muted">{store.slug}</span>
                      <span className="mono text-muted">
                        <span className="tnum">{view.columns.length}</span>{" "}
                        {plural(view.columns.length, "column")}
                      </span>
                      <RowActions
                        copy={view.id}
                        reveal={view.id}
                        label={view.name}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* An aggregate is reached through its events and nothing else, so
              every row here arrived by way of one, and says which. */}
          <WhatLinksHere
            target={{ kind: "aggregate", id: aggregate.id }}
            empty="nothing outside this aggregate names one of its events"
          />
        </div>

        <Toc items={toc} label="Sections of this aggregate" title="Outline" />
      </div>
    </div>
  );
}
