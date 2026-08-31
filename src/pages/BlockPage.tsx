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
import { blockPath, eventPath, paths, servicePath } from "../routes";
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
    <table className="w-full max-w-[900px]">
      <thead>
        <tr className="label">
          <th className="pb-1 text-left font-normal">name</th>
          <th className="pb-1 text-left font-normal">type</th>
          <th className="pb-1 text-left font-normal">doc</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const ref = field.ref;
          return (
            <tr key={field.name} className="border-t align-top border-line">
              <td className="mono py-1 pr-3 whitespace-nowrap">{field.name}</td>
              <td className="mono py-1 pr-3 whitespace-nowrap text-muted">
                {field.type}
                {ref ? (
                  <span
                    className="ml-1.5"
                    title={`shared type ${ref}`}
                    style={{ color: "var(--fg-muted)" }}
                  >
                    ↗
                  </span>
                ) : null}
              </td>
              <td className="py-1 text-muted">{field.doc}</td>
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
      block?.ref ? usagesOfDef(catalog, block.ref, block.id) : ([] as DefUsage[]),
    [block],
  );

  if (!context || !service || !aggregate || !block) {
    return <NotFound kind={KIND_LABEL[kind]} id={blockSlug} />;
  }

  const fields = blockFields(catalog, block);
  const isRoot = kind === "entity" && rootEntity(aggregate)?.slug === block.slug;

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
        <p className="mt-1.5 max-w-[900px] text-muted">{block.doc}</p>
        <div className="mono mt-1.5 text-muted">
          {block.ref ? (
            <>
              shared type <span className="text-ink">{block.ref}</span> — the
              same shape wherever it is named
            </>
          ) : (
            <>local to {aggregate.id} — no shared type</>
          )}
        </div>
      </PageHeader>

      <div className="p-4">
        <SectionTitle
          right={<span className="mono text-muted">{fields.length} fields</span>}
        >
          Shape
        </SectionTitle>
        {fields.length === 0 ? (
          <Empty>the catalog knows this block by name only</Empty>
        ) : (
          <ShapeTable fields={fields} />
        )}

        <div className="mt-8 max-w-[900px]">
          <SectionTitle
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
              an inline shape is used only here — give it a shared type to track
              it across the catalog
            </Empty>
          ) : usages.length === 0 ? (
            <Empty>nothing else names {block.ref}</Empty>
          ) : (
            <div className="flex flex-col gap-1">
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
                        <span className="border px-1 border-line">
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
                    className="row gap-2 px-2 py-1.5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    key={`${usage.kind}:${usage.id}`}
                    className="flex items-center gap-2 border px-2 py-1.5 border-line"
                    title="shared type — no page of its own"
                  >
                    {body}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 max-w-[900px]">
          <SectionTitle>Siblings</SectionTitle>
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
    </div>
  );
}
