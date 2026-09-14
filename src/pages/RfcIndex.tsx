import { useMemo } from "react";
import { catalog } from "../data";
import { allRfcs } from "../catalog";
import type { Rfc } from "../catalog";
import { useDocumentTitle } from "../app/title";
import { sortRfcs } from "../lib/rfc";
import { scopeLabel } from "../lib/adr";
import { RfcDisplayId, RfcStatusChip, AdrScopePill } from "../components/primitives";
import { CapabilityEmpty, Empty } from "../components/PageHeader";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { RowActions } from "../components/RowActions";
import { paths } from "../routes";

const COLUMNS: ColumnSpec<Rfc>[] = [
  {
    id: "id",
    header: "RFC",
    type: "text",
    value: (rfc) => rfc.displayId,
    cell: (rfc) => <RfcDisplayId rfc={rfc} />,
  },
  {
    id: "title",
    header: "title",
    type: "text",
    value: (rfc) => rfc.title,
    primary: true,
    title: (rfc) => rfc.title,
  },
  {
    id: "status",
    header: "source status",
    type: "status",
    value: (rfc) => rfc.status,
    cell: (rfc) => <RfcStatusChip rfc={rfc} />,
    facet: true,
  },
  {
    id: "lifecycle",
    header: "lifecycle",
    type: "status",
    value: (rfc) => rfc.lifecycle,
    facet: true,
  },
  {
    id: "scope",
    header: "scope",
    type: "text",
    value: (rfc) => scopeLabel(rfc.scope),
    cell: (rfc) => <AdrScopePill scope={rfc.scope} link={false} />,
    facet: true,
  },
  {
    id: "updated",
    header: "last activity",
    type: "date",
    value: (rfc) => rfc.updatedAt ?? rfc.createdAt ?? "",
  },
];

export function RfcIndex() {
  useDocumentTitle("RFCs");
  const rows = useMemo(() => sortRfcs(allRfcs(catalog)), []);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <h1 className="text-lg font-semibold">RFCs</h1>
      {rows.length === 0 ? (
        <div className="mt-section">
          <CapabilityEmpty
            title="No requests for comments in this catalog"
            signal="Signal: RFC files or configured issue and pull-request sources → rfcs[]."
          >
            RFCs preserve proposals, their review state, and the architecture they may change. Configure an RFC source without treating proposals as accepted decisions.
          </CapabilityEmpty>
        </div>
      ) : (
        <div className="mt-section max-w-table">
          <DataTable
            tableId="rfcs"
            className="rfc-table"
            caption="Requests for comments"
            columns={COLUMNS}
            rows={rows}
            rowId={(rfc) => rfc.id}
            defaultSort={[{ id: "updated", desc: true }]}
            sortInUrl
            rowLink={(rfc) => paths.rfc(rfc.slug)}
            rowActions={(rfc) => <RowActions copy={rfc.id} label={rfc.id} />}
            empty={<Empty>nothing matches this filter</Empty>}
          />
        </div>
      )}
    </div>
  );
}
