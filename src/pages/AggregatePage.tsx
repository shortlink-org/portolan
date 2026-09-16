import { branchAggregate } from "../drafts/branch-entities";
import { usePickedDraft } from "../drafts/store";
import { DraftEventMark, DraftEventRows } from "../drafts/nav";
import { DraftBanner } from "../drafts/DraftBanner";
import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Link2 } from "lucide-react";
import { catalog, index } from "../data";
import { allRepos, blockCounts, blockFields, enumsOf, rootEntity } from "../catalog";
import { isStatusEnum } from "../lib/shape";
import type {
  Aggregate,
  Block,
  BlockKind,
  Operation,
  Service,
  Enum,
} from "../catalog";
import { flowsRunning, markdownOutline } from "../lib/derive";
import { CommandConsequences } from "../flow/CommandConsequences";
import { commandChain } from "../flow/chain";
import { commandAnchor, commandSummary } from "../flow/command-info";
import { anchorUrl, toClipboard } from "../lib/clipboard";
import {
  redisKeyspacesPersisting,
  tablesPersisting,
  viewsPresenting,
} from "../lib/data-model";
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
import { SourcePreviewLink } from "../components/SourcePreview";
import { sourceLocation, splitLine } from "../lib/source-link";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { RuleMarks } from "../components/RuleMarks";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { LifecycleDiagram } from "../components/LifecycleDiagram";
import { isTerminal } from "../lib/lifecycle";
import { InLanguage } from "../language/InLanguage";
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
    { kind: "enum", n: counts.enums, anchor: AGGREGATE_ANCHOR.enums },
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
          {aggregate.kind === "model-group" ? "aggregate boundary" : "root"}
          <KindIcon kind="entity" />
          {rootTo ? (
            <Link to={rootTo} className="text-ink hover:underline">
              {aggregate.root}
            </Link>
          ) : (
            <span className="text-ink">{aggregate.kind === "model-group" ? "not specified" : aggregate.root}</span>
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
  rootDelta,
}: {
  kind: BlockKind;
  blocks: Block[];
  linkTo: (block: Block) => string;
  rootName?: string;
  /** Fields a branch added to or dropped from the root. */
  rootDelta?: { added: number; removed: number } | null;
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
              {block.deprecated ? (
                <span className="chip ml-2" title="marked @deprecated in the source">
                  deprecated
                </span>
              ) : null}
              <span className="meta block max-w-prose truncate" title={block.doc}>
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
              {rootDelta && block.name === rootName ? (
                <span className="mono" title="fields the branch added to the root, and dropped from it">
                  {rootDelta.added ? <span className="text-verified">+{rootDelta.added}</span> : null}
                  {rootDelta.removed ? <span className="ml-1 text-unresolved">−{rootDelta.removed}</span> : null}
                </span>
              ) : null}
            </span>
            <RowActions copy={block.id} label={block.name} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The closed sets, each with its values on the row: a reader scanning the
 * aggregate wants to see "placed, confirmed, cancelled" without opening a
 * page, and a set has few enough values that the row can hold them.
 */
function EnumList({
  aggregate,
  linkTo,
}: {
  aggregate: Aggregate;
  linkTo: (item: Enum) => string;
}) {
  const enums = enumsOf(aggregate);
  if (enums.length === 0) {
    return (
      <Empty>no enums declared — every field here is a scalar or a shape</Empty>
    );
  }
  const states = aggregate.lifecycle?.states ?? [];
  return (
    <div className="rows grid-cols-[auto_1fr_auto_auto]" data-nav-list>
      {enums.map((item) => (
        <div key={item.id} className="row items-start gap-2 px-3 py-2">
          <span className="mt-0.5 flex shrink-0">
            <KindIcon kind="enum" />
          </span>
          <span className="min-w-0 flex-1">
            <Link
              to={linkTo(item)}
              data-nav-item
              className="mono rounded-control"
              title={item.name}
            >
              {item.name}
            </Link>
            {isStatusEnum(item, states) ? (
              <a
                href={`#${AGGREGATE_ANCHOR.lifecycle}`}
                className="chip status-verified ml-2"
                title="its values are the lifecycle's states"
              >
                <span aria-hidden className="dot" />
                the status
              </a>
            ) : null}
            {item.deprecated ? (
              <span className="chip ml-2" title="marked deprecated in the source">
                deprecated
              </span>
            ) : null}
            <span className="meta block max-w-prose truncate" title={item.doc}>
              {item.doc}
            </span>
            <span className="mono mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-muted">
              {item.values.map((value) => (
                <span
                  key={value.name}
                  className={value.deprecated ? "line-through" : undefined}
                  title={value.doc || undefined}
                >
                  {value.name}
                </span>
              ))}
            </span>
          </span>
          <span className="mono flex shrink-0 items-center gap-2 text-muted">
            <span>{item.values.length}v</span>
          </span>
          <RowActions copy={item.id} label={item.name} />
        </div>
      ))}
    </div>
  );
}

function CommandLink({ id }: { id: string }) {
  const { pathname, search } = useLocation();
  const hash = encodeURIComponent(commandAnchor(id));
  return (
    <Link to={{ pathname, search, hash: `#${hash}` }}
      onClick={() => { void toClipboard(anchorUrl(hash)); }}
      className="rounded-control p-1 text-muted hover:text-ink"
      aria-label={`Copy link to command ${id}`} title={`Copy link to ${id}`}>
      <Link2 size={12} aria-hidden />
    </Link>
  );
}

/** Commands and queries, their preconditions, entry points and consequences. */
function OperationList({
  kind,
  operations,
  service,
  aggregate,
  marks,
}: {
  kind: "command" | "query";
  operations: Operation[];
  service: Service;
  aggregate: Aggregate;
  /** Operations a branch added or dropped, by id. */
  marks?: ReadonlyMap<string, "added" | "removed"> | undefined;
}) {
  // Whether this service records what exposes an operation at all. A catalog
  // written before anything read a transport layer says nothing either way,
  // and answering "no endpoint runs it" from that silence would be inventing.
  const recorded = service.aggregates.some((aggregate) =>
    aggregate.operations.some((operation) => operation.exposedBy?.length),
  );
  const to = servicePath(service.id);
  const pins = allRepos(catalog);
  const chains = useMemo(() => new Map(operations.filter((op) => op.kind === "command").map((op) =>
    [op.id, commandChain(catalog, service, aggregate, op)],
  )), [operations, service, aggregate]);

  return (
    <ul className="flex flex-col gap-1">
      {operations.map((op) => {
        const runs = flowsRunning(catalog, service, aggregate, op);
        const chain = chains.get(op.id);
        const summary = chain ? commandSummary(chain, service.id) : null;
        const location = op.source ? sourceLocation(op.source, service, pins) : null;
        return (
        <li
          key={op.id}
          id={op.kind === "command" ? commandAnchor(op.id) : undefined}
          className={`flex scroll-mt-12 items-start gap-2 border-l-2 px-2 py-1.5 bg-surface ${
            kind === "command" ? "border-verified" : "border-line-strong"
          }`}
          style={
            marks?.get(op.id) === "added"
              ? { background: "color-mix(in srgb, var(--status-verified) 8%, var(--surface))" }
              : marks?.get(op.id) === "removed"
                ? { opacity: 0.6, textDecoration: "line-through" }
                : undefined
          }
        >
          <span className="mt-px shrink-0">
            <KindIcon kind={kind} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2">
              <Ident block value={op.id} className={op.deprecated ? "line-through" : undefined} />
              {summary ? (
                <span className="mono text-muted" title="Unique events and downstream services linked in flows; not a guarantee of complete coverage">
                  {summary.unknown ? "consequences unknown" : `${summary.events} ${plural(summary.events, "event")} · ${summary.services} ${plural(summary.services, "downstream service")}${summary.incomplete ? " · partial" : ""}`}
                </span>
              ) : null}
              {op.kind === "command" ? <CommandLink id={op.id} /> : null}
              {marks?.get(op.id) ? (
                <span
                  className={`mono inline-flex items-center gap-1 text-xs ${marks.get(op.id) === "added" ? "text-verified" : "text-unresolved"}`}
                  title={marks.get(op.id) === "added" ? "added in this branch" : "removed in this branch"}
                >
                  {marks.get(op.id) === "added" ? "+ new in branch" : "− removed in branch"}
                </span>
              ) : null}
              {op.deprecated ? (
                <span className="chip" title="marked @deprecated in the source">
                  deprecated
                </span>
              ) : null}
              {op.source ? (
                <SourcePreviewLink location={location} className="mono ml-auto text-muted hover:text-ink">
                  {splitLine(op.source).path.split("/").pop()}
                  {splitLine(op.source).line ? `:${splitLine(op.source).line}` : ""}
                </SourcePreviewLink>
              ) : null}
            </span>
            {op.doc ? <p className="mt-0.5 max-w-prose text-muted">{op.doc}</p> : null}
            {kind === "command" ? (
              <CommandConsequences catalog={catalog} service={service} operation={op} chain={chain!} />
            ) : null}
            {/* What the caller hands in: the message's own shape. An empty
                list is said out loud - a query that takes nothing is a fact
                about the query, not a gap in the reading. */}
            {op.fields ? (
              op.fields.length ? (
                <dl className="mono mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-muted">
                  {op.fields.map((field) => (
                    <div key={field.name} className="contents">
                      <dt className={field.deprecated ? "line-through" : undefined}>{field.name}</dt>
                      <dd className="min-w-0 truncate">
                        <span className="text-ink">{field.type}</span>
                        <RuleMarks field={field} />
                        {field.doc ? <span className="ml-2">{field.doc}</span> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mono mt-1 text-muted">takes nothing</p>
              )
            ) : null}
            {runs.length ? (
              <p className="mono mt-1 flex flex-wrap items-center gap-x-2 text-muted">
                <span>runs in</span>
                {runs.map(({ flow, stepId }) => (
                  <Link
                    key={flow.slug}
                    to={paths.flowStep(flow.slug, stepId)}
                    className="rounded-control hover:text-ink"
                    title={flow.name}
                  >
                    {flow.slug}
                  </Link>
                ))}
              </p>
            ) : null}
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
        );
      })}
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
  const mainAggregate = service?.aggregates.find((a) => a.slug === aggSlug);
  // With a branch version picked, the page reads the
  // branch's operations and root, and marks what differs from main.
  const pickedEntity = usePickedDraft(mainAggregate?.id ?? "")?.entity;
  const branch = useMemo(
    () => (mainAggregate && pickedEntity ? branchAggregate(mainAggregate, pickedEntity) : null),
    [mainAggregate, pickedEntity],
  );
  const aggregate = branch?.aggregate ?? mainAggregate;

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
  const redisKeyspaces = redisKeyspacesPersisting(index, aggregate.id);

  // The readme's own headings first, then the five sections the page adds
  // under it. One rail, in the order the page is actually written in.
  const toc: TocItem[] = [
    ...outline.map((h) => ({ id: h.slug, label: h.text, depth: h.depth })),
    { id: AGGREGATE_ANCHOR.entities, label: "Entities" },
    { id: AGGREGATE_ANCHOR.valueObjects, label: "Value objects" },
    { id: AGGREGATE_ANCHOR.enums, label: "Enums" },
    ...(aggregate.lifecycle ? [{ id: AGGREGATE_ANCHOR.lifecycle, label: "Lifecycle" }] : []),
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
  const enumPathOf = (item: Enum) =>
    paths.enum(context.id, service.slug, aggregate.slug, item.slug);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={
          <>
            {aggregate.kind === "model-group" ? "model group" : "aggregate"} ·{" "}
            <Link
              to={paths.service(context.id, service.slug)}
              className="rounded-control hover:text-ink hover:underline"
            >
              {service.id}
            </Link>
          </>
        }
        name={aggregate.name}
        id={aggregate.id}
        contextId={context.id}
        pin={{ kind: "aggregate", id: aggregate.id }}
      />

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <DraftBanner id={aggregate.id} className="mb-[calc(var(--gutter)+1rem)]" />
          <InLanguage id={aggregate.id} />

          <BuildingBlocks
            aggregate={aggregate}
            rootTo={root ? entityPath(root) : null}
          />

          <Markdown mermaid>{aggregate.readme}</Markdown>
          {aggregate.kind === "model-group" ? <p className="mb-section text-muted">Models discovered in this application. Their relationships are extracted from the source; aggregate boundaries have not been specified.</p> : null}

          <div
            className="mt-section"
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
              rootDelta={branch?.rootFields}
            />
          </div>

          <div
            className="mt-section"
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

          <div
            className="mt-section"
            id={AGGREGATE_ANCHOR.enums}
          >
            <SectionTitle
              anchor={AGGREGATE_ANCHOR.enums}
              right={
                <span>closed sets — a consumer handles every value</span>
              }
            >
              Enums
            </SectionTitle>
            <EnumList aggregate={aggregate} linkTo={enumPathOf} />
          </div>

          {aggregate.lifecycle ? (
            <div className="mt-section" id={AGGREGATE_ANCHOR.lifecycle}>
              <SectionTitle
                anchor={AGGREGATE_ANCHOR.lifecycle}
                right={
                  <span className="tnum">
                    {aggregate.lifecycle.states.length}{" "}
                    {plural(aggregate.lifecycle.states.length, "state")} ·{" "}
                    {aggregate.lifecycle.transitions.length}{" "}
                    {plural(aggregate.lifecycle.transitions.length, "move")} ·{" "}
                    {aggregate.lifecycle.states.filter((s) => isTerminal(aggregate.lifecycle!, s)).length}{" "}
                    terminal
                  </span>
                }
              >
                Lifecycle
              </SectionTitle>
              {/* Where the root can go from where it is, as the code wrote it
                  down: one table of moves, read off the source. The first
                  state is where a new one starts; a state nothing leads out
                  of is where it becomes a record. */}
              <LifecycleDiagram
                aggregate={aggregate}
                eventPath={(id) => {
                  const event = aggregate.events.find((e) => e.id === id);
                  return event ? paths.event(context.id, service.slug, aggregate.slug, event.slug) : null;
                }}
              />
            </div>
          ) : null}

          <div className="mt-section" id={AGGREGATE_ANCHOR.events}>
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
                className="rows grid-cols-[auto_auto_1fr_auto_auto_auto]"
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
                      <DraftEventMark id={event.id} />
                    </div>
                  );
                })}
                <DraftEventRows aggregateId={aggregate.id} />
              </div>
            )}
          </div>

          {/* Rows and consequence trees use the available width; only the
              operation descriptions keep a prose reading measure. */}
          <div className="mt-8 flex flex-col gap-section">
            <div id={AGGREGATE_ANCHOR.commands}>
              <SectionTitle
                anchor={AGGREGATE_ANCHOR.commands}
                right={
                  <span>
                    {aggregate.kind === "model-group" ? "write operations discovered in this application" : "they change the aggregate — one row lock each"}
                  </span>
                }
              >
                Commands
              </SectionTitle>
              {commands.length === 0 ? (
                <Empty>{aggregate.kind === "model-group" ? "no application commands discovered" : "nothing changes this aggregate from outside"}</Empty>
              ) : null}
              <OperationList kind="command" operations={commands} service={service} aggregate={aggregate} marks={branch?.operationMarks} />
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
                <Empty>{aggregate.kind === "model-group" ? "no application queries discovered" : "nothing reads this aggregate by name"}</Empty>
              ) : null}
              <OperationList kind="query" operations={queries} service={service} aggregate={aggregate} marks={branch?.operationMarks} />
            </div>
          </div>

          {/* Where this aggregate actually lives. It sits after the model and
              before the backlinks because it answers a question about THIS
              aggregate — one a reader asks once they believe the model. */}
          <div
            className="mt-section"
            id={AGGREGATE_SECTION.persistence}
          >
            <SectionTitle
              anchor={AGGREGATE_SECTION.persistence}
              right={
                <span>
                  tables and Redis keys that hold it
                  {presented.length > 0 ? ", then the views over it" : ""}
                </span>
              }
            >
              Persistence
            </SectionTitle>
            {persistence.length === 0 && redisKeyspaces.length === 0 ? (
              <Empty>
                No persistence found for {aggregate.name} — the extractor maps
                tables and Redis key families via `persists`
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
                {redisKeyspaces.map(({ keyspace, store }) => (
                  <div
                    key={`${store.id}:${keyspace.pattern}`}
                    className="row px-2 py-1.5"
                  >
                    <KindIcon kind="store" />
                    <Link
                      to={paths.store(context.id, service.slug, store.slug)}
                      data-nav-item
                      className="mono min-w-0 break-all rounded-control"
                    >
                      {keyspace.pattern}
                    </Link>
                    <span className="chip">redis key</span>
                    <span className="mono text-muted">{store.slug}</span>
                    <span className="mono text-muted">
                      {keyspace.operations.join("/")}
                    </span>
                    <RowActions
                      copy={keyspace.pattern}
                      reveal={store.id}
                      label={keyspace.pattern}
                    />
                  </div>
                ))}
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

        <Toc items={toc} label={aggregate.kind === "model-group" ? "Sections of this model group" : "Sections of this aggregate"} title="Outline" />
      </div>
    </div>
  );
}
