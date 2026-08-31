// One template for both structural building blocks. An entity and a value
// object differ in whether identity matters, not in what there is to say about
// them, so they share a page and are told apart by the header and the icon.

import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { catalog } from "../data";
import { blockFields, rootEntity } from "../catalog";
import type { Block, BlockKind, Field } from "../catalog";
import { usagesOfDef } from "../lib/derive";
import type { DefUsage } from "../lib/derive";
import { KIND_LABEL, KIND_PLURAL } from "../lib/kinds";
import type { Kind } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import {
  BLOCK_ANCHOR,
  blockPath,
  eventPath,
  paths,
  servicePath,
} from "../routes";
import { NotFound } from "./NotFound";

const USAGE_KIND: Record<DefUsage["kind"], Kind | null> = {
  event: "event",
  entity: "entity",
  vo: "vo",
  rpc: "service",
  def: null,
};

function usagePath(usage: DefUsage): string | null {
  switch (usage.kind) {
    case "event":
      return eventPath(usage.id);
    case "entity":
    case "vo":
      return blockPath(usage.id);
    case "rpc":
      return servicePath(usage.owner);
    case "def":
      // Shared types have no page of their own; they are only ever seen
      // through the blocks that name them.
      return null;
  }
}

function ShapeTable({ fields }: { fields: Field[] }) {
  return (
    <table className="tbl tbl-sticky max-w-prose">
      <thead>
        <tr className="label">
          <th className="pb-2 text-left font-normal">name</th>
          <th className="pb-2 text-left font-normal">type</th>
          <th className="pb-2 text-left font-normal">doc</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const ref = field.ref;
          return (
            <tr key={field.name} className="align-top">
              <td className="mono py-1 pr-3 whitespace-nowrap">{field.name}</td>
              <td className="py-1 pr-3 whitespace-nowrap">
                <Ident
                  value={ref ?? field.type}
                  className="text-muted"
                  title={
                    ref
                      ? `shared type ${ref} — click to copy`
                      : `${field.type} — click to copy`
                  }
                >
                  {field.type}
                  {ref ? <span className="ml-1.5">↗</span> : null}
                </Ident>
              </td>
              <td className="meta py-1">{field.doc}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BlockPage({ kind }: { kind: BlockKind }) {
  const {
    context: contextId,
    service: serviceSlug,
    aggregate: aggSlug,
    block: blockSlug,
  } = useParams();

  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const aggregate = service?.aggregates.find((a) => a.slug === aggSlug);
  const list: Block[] =
    (kind === "vo" ? aggregate?.valueObjects : aggregate?.entities) ?? [];
  const block = list.find((b) => b.slug === blockSlug);

  const usages = useMemo(
    () =>
      block?.ref
        ? usagesOfDef(catalog, block.ref, block.id)
        : ([] as DefUsage[]),
    [block],
  );

  if (!context || !service || !aggregate || !block) {
    return <NotFound kind={KIND_LABEL[kind]} id={blockSlug} />;
  }

  const toc: TocItem[] = [
    { id: BLOCK_ANCHOR.shape, label: "Shape" },
    { id: BLOCK_ANCHOR.usedIn, label: "Used in" },
    { id: BLOCK_ANCHOR.siblings, label: "Siblings" },
  ];

  const fields = blockFields(catalog, block);
  const isRoot =
    kind === "entity" && rootEntity(aggregate)?.slug === block.slug;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={`${KIND_LABEL[kind]} · ${aggregate.id}`}
        name={block.name}
        id={block.id}
        right={
          <span className="flex items-center gap-2">
            {isRoot ? (
              <span className="chip status-verified" title="aggregate root">
                <span aria-hidden className="dot" />
                root
              </span>
            ) : null}
            <Link
              to={paths.aggregate(context.id, service.slug, aggregate.slug)}
              className="chip-lg border-line-strong text-muted"
            >
              <KindIcon kind="aggregate" />
              {aggregate.name}
            </Link>
          </span>
        }
      >
        <p className="mt-2 max-w-prose text-muted">{block.doc}</p>
        <div className="mono mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          {block.ref ? (
            <span className="flex items-center gap-1.5">
              shared type
              <Ident value={block.ref} className="text-ink" />— the same shape
              wherever it is named
            </span>
          ) : (
            <span>local to {aggregate.id} — no shared type</span>
          )}
          <span aria-hidden className="h-4 w-px bg-line-strong" />
          <a
            href={`#${BLOCK_ANCHOR.shape}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{fields.length}</span> fields
          </a>
          {block.ref ? (
            <a
              href={`#${BLOCK_ANCHOR.usedIn}`}
              className="rounded-control hover:text-ink"
            >
              <span className="tnum">{usages.length}</span>{" "}
              {usages.length === 1 ? "reference" : "references"}
            </a>
          ) : null}
        </div>
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <section id={BLOCK_ANCHOR.shape}>
            <SectionTitle
              anchor={BLOCK_ANCHOR.shape}
              right={
                <span className="mono text-muted">{fields.length} fields</span>
              }
            >
              Shape
            </SectionTitle>
            {fields.length === 0 ? (
              <Empty>the catalog knows this block by name only</Empty>
            ) : (
              <ShapeTable fields={fields} />
            )}
          </section>

          <div className="mt-section max-w-prose" id={BLOCK_ANCHOR.usedIn}>
            <SectionTitle
              anchor={BLOCK_ANCHOR.usedIn}
              right={
                block.ref ? (
                  <span className="mono text-muted">
                    {usages.length} references
                  </span>
                ) : null
              }
            >
              Used in
            </SectionTitle>
            {!block.ref ? (
              <Empty>
                an inline shape is used only here — give it a shared type to
                track it across the catalog
              </Empty>
            ) : usages.length === 0 ? (
              <Empty>nothing else names {block.ref}</Empty>
            ) : (
              <div className="flex flex-col gap-1" data-nav-list>
                {usages.map((usage) => {
                  const to = usagePath(usage);
                  const icon = USAGE_KIND[usage.kind];
                  const body = (
                    <>
                      {icon ? <KindIcon kind={icon} /> : null}
                      <span
                        className="mono"
                        style={
                          usage.kind === "event"
                            ? { color: "var(--kind-event)" }
                            : undefined
                        }
                      >
                        {usage.name}
                      </span>
                      <span className="mono truncate text-muted">
                        {usage.owner}
                      </span>
                      <span className="mono ml-auto flex shrink-0 gap-1.5 text-muted">
                        {usage.fields.length > 0 ? (
                          <span title="fields that carry this type">
                            {usage.fields.join(", ")}
                          </span>
                        ) : (
                          <span>same type</span>
                        )}
                        {usage.versions && usage.versions.length > 0 ? (
                          <span className="rounded-[4px] border px-1 border-line">
                            {usage.versions.join(" ")}
                          </span>
                        ) : null}
                      </span>
                    </>
                  );
                  return to ? (
                    <Link
                      key={`${usage.kind}:${usage.id}`}
                      to={to}
                      data-nav-item
                      className="row gap-2 px-3 py-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      key={`${usage.kind}:${usage.id}`}
                      className="flex items-center gap-2 rounded-control border px-3 py-2 border-line"
                      title="shared type — no page of its own"
                    >
                      {body}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-section max-w-prose" id={BLOCK_ANCHOR.siblings}>
            <SectionTitle anchor={BLOCK_ANCHOR.siblings}>Siblings</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {list
                .filter((b) => b.slug !== block.slug)
                .map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={
                      (blockPath(sibling.id) as string) ??
                      paths.aggregate(context.id, service.slug, aggregate.slug)
                    }
                    className="chip-lg border-line-strong text-muted"
                  >
                    <KindIcon kind={kind} />
                    {sibling.name}
                  </Link>
                ))}
              {list.length <= 1 ? (
                <Empty>
                  the only {KIND_LABEL[kind]} in {aggregate.name}
                </Empty>
              ) : null}
            </div>
            <div className="mono mt-2 text-muted">
              {KIND_PLURAL[kind]} of {aggregate.id}
            </div>
          </div>
        </div>

        <Toc items={toc} label={`Sections of this ${KIND_LABEL[kind]}`} />
      </div>
    </div>
  );
}
