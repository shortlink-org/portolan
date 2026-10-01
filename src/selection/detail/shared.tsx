// Presentational helpers every body of the right rail is built from.

import type { ReactNode } from "react";
import { catalog, index } from "../../data";
import { allRepos, columnNameOfId, relationOfColumnId } from "../../catalog";
import { sourceLocation } from "../../lib/source-link";
import { SourcePreviewLink } from "../../components/SourcePreview";
import { useSelectionStore } from "../store";

export function Label({ children }: { children: ReactNode }) {
  return <div className="label mt-3 mb-1">{children}</div>;
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 py-0.5">{children}</div>;
}

export function PanelSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b px-3 py-3 last:border-b-0 border-line">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {meta ? <span className="mono text-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The panel's own way of moving the selection, without leaving the page. */
export function SelectLink({ id, children }: { id: string; children: ReactNode }) {
  const select = useSelectionStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(id, "panel")}
      title={id}
      data-peek={id}
      className="mono trunc rounded-control text-left text-accent hover:underline"
    >
      {children}
    </button>
  );
}

/**
 * Where a value goes and where it came from, as two lists of column links.
 *
 * Written once and used from both the table body and the column body, because
 * "who reads this" is the same question at either zoom level and a reader who
 * has learned to read it on a column should not have to learn it again.
 */
export function LineageRows({ ids }: { ids: readonly string[] }) {
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

export function SchemaEvidenceSource({ source, owner }: { source: string; owner: string }) {
  return <SourcePreviewLink location={sourceLocation(source, index.serviceById.get(owner), allRepos(catalog))} className="mono break-all text-muted hover:text-accent">{source}</SourcePreviewLink>;
}
