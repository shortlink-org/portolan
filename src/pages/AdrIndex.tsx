import { useMemo } from "react";
import { catalog } from "../data";
import type { Adr } from "../catalog";
import { scopeLabel, sortAdrs } from "../lib/adr";
import {
  AdrNumber,
  AdrScopePill,
  AdrStatusChip,
} from "../components/primitives";
import { Empty } from "../components/PageHeader";
import { RowActions } from "../components/RowActions";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { paths } from "../routes";

/**
 * A table, not cards: the number, the status and the date are the whole point,
 * and they only read as a column when they are in one.
 *
 * Everything the page used to do by hand - the status and scope facets, the
 * count, the sort - is now the table's, declared rather than written. What is
 * left here is what only this page knows: that a decision has a number, that
 * the number is padded, and that the newest decision is the one to show first.
 */
const COLUMNS: ColumnSpec<Adr>[] = [
  {
    id: "number",
    header: "#",
    type: "number",
    value: (adr) => adr.number,
    // The padded form, struck through when the decision is no longer in force.
    cell: (adr) => <AdrNumber adr={adr} />,
    align: "left",
  },
  {
    id: "title",
    header: "title",
    type: "text",
    value: (adr) => adr.title,
    primary: true,
    title: (adr) => adr.title,
  },
  {
    id: "status",
    header: "status",
    type: "status",
    value: (adr) => adr.status,
    // A decision's statuses are its own vocabulary - accepted, superseded -
    // rather than the catalog's verified/declared/unresolved.
    cell: (adr) => <AdrStatusChip status={adr.status} />,
    facet: true,
  },
  {
    id: "scope",
    header: "scope",
    type: "text",
    value: (adr) => scopeLabel(adr.scope),
    // Not a link inside the row: an anchor cannot contain another one.
    cell: (adr) => <AdrScopePill scope={adr.scope} link={false} />,
    facet: true,
  },
  {
    id: "date",
    header: "date",
    type: "date",
    value: (adr) => adr.date,
  },
];

export function AdrIndex() {
  const rows = useMemo(() => sortAdrs(catalog.adrs), []);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Decisions</h1>
      </div>

      <div className="mt-section max-w-table">
        <DataTable
          tableId="adrs"
          caption="Decision records"
          columns={COLUMNS}
          rows={rows}
          rowId={(adr) => adr.id}
          /* The newest decision is the one being looked for; the rest is
             history, and history reads backwards. */
          defaultSort={[{ id: "number", desc: true }]}
          sortInUrl
          rowLink={(adr) => paths.adr(adr.slug)}
          rowActions={(adr) => <RowActions copy={adr.id} label={adr.id} />}
          empty={<Empty>nothing on the record matches this filter</Empty>}
        />
      </div>
    </div>
  );
}
