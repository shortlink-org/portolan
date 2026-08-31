import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { catalog } from "../data";
import { blockCounts, blockFields, rootEntity } from "../catalog";
import type { Aggregate, Block, BlockKind } from "../catalog";
import { markdownOutline } from "../lib/derive";
import { KIND_LABEL, KIND_PLURAL } from "../lib/kinds";
import type { LeafKind } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import { AGGREGATE_ANCHOR, paths } from "../routes";
import { Markdown } from "../components/Markdown";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
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
    { kind: "vo", n: counts.valueObjects, anchor: AGGREGATE_ANCHOR.valueObjects },
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
    return <Empty>this aggregate declares no {KIND_PLURAL[kind]}</Empty>;
  }
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((block) => {
        const fields = blockFields(catalog, block);
        return (
          <Link
            key={block.id}
            to={linkTo(block)}
            className="row items-start gap-2 px-3 py-2"
          >
            <span className="mt-0.5 flex shrink-0">
              <KindIcon kind={kind} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="mono" title={block.name}>
                {block.name}
              </span>
              {block.name === rootName ? (
                <span className="mono ml-2 text-muted">root</span>
              ) : null}
              <span className="block truncate text-muted" title={block.doc}>
                {block.doc}
              </span>
            </span>
            <span className="mono ml-auto shrink-0 text-muted">
              {block.ref ? (
                <span title={`shared type ${block.ref}`}>{block.ref}</span>
              ) : (
                <span title="shape written inline">inline</span>
              )}
              <span className="ml-2">{fields.length}f</span>
            </span>
          </Link>
        );
      })}
    </div>
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
      />

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <BuildingBlocks
            aggregate={aggregate}
            rootTo={root ? entityPath(root) : null}
          />

          <Markdown>{aggregate.readme}</Markdown>

          <div className="mt-section max-w-prose" id={AGGREGATE_ANCHOR.entities}>
            <SectionTitle
              right={
                <span className="mono text-muted">
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

          <div className="mt-section max-w-prose" id={AGGREGATE_ANCHOR.valueObjects}>
            <SectionTitle
              right={
                <span className="mono text-muted">
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
            <SectionTitle>Events</SectionTitle>
            {aggregate.events.length === 0 ? (
              <Empty>
                this aggregate publishes no events — see the readme for why
              </Empty>
            ) : (
              <div className="flex flex-col gap-1">
                {aggregate.events.map((event) => (
                  <Link
                    key={event.id}
                    to={paths.event(
                      context.id,
                      service.slug,
                      aggregate.slug,
                      event.slug,
                    )}
                    className="row flex-wrap gap-2 px-3 py-2"
                  >
                    <KindIcon kind="event" />
                    <span className="mono" style={{ color: "var(--kind-event)" }}>
                      {event.name}
                    </span>
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
                    <span className="mono ml-auto text-muted">
                      {event.consumers.length} consumers
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 grid max-w-prose gap-6 grid-cols-2">
            <div id={AGGREGATE_ANCHOR.commands}>
              <SectionTitle>Commands</SectionTitle>
              {commands.length === 0 ? <Empty>none</Empty> : null}
              <ul className="flex flex-col gap-1">
                {commands.map((op) => (
                  <li
                    key={op.id}
                    className="mono flex items-center gap-1.5 border-l-2 px-2 py-1 border-verified bg-surface"
                  >
                    <KindIcon kind="command" />
                    {op.id}
                  </li>
                ))}
              </ul>
            </div>
            <div id={AGGREGATE_ANCHOR.queries}>
              <SectionTitle>Queries</SectionTitle>
              {queries.length === 0 ? <Empty>none</Empty> : null}
              <ul className="flex flex-col gap-1">
                {queries.map((op) => (
                  <li
                    key={op.id}
                    className="mono flex items-center gap-1.5 border-l-2 px-2 py-1 border-line-strong bg-surface"
                  >
                    <KindIcon kind="query" />
                    {op.id}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {outline.length > 0 ? (
          <nav
            /* Pinned beside the page it indexes, translucent so the content
               scrolling past it stays visible. */
            className="sticky-bar sticky top-0 hidden h-fit w-52 shrink-0 self-start rounded-card border-l pl-4 lg:block border-line"
            aria-label="Readme outline"
          >
            <div className="label mb-2">Outline</div>
            <ul>
              {outline.map((heading) => (
                <li
                  key={heading.slug}
                  style={{ paddingLeft: (heading.depth - 1) * 10 }}
                >
                  <a
                    href={`#${heading.slug}`}
                    className={`block truncate py-0.5 hover:underline ${heading.depth === 1 ? "text-ink" : "text-muted"}`}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
