import { useDocumentTitle } from "../app/title";
import { useMemo } from "react";
import { Link } from "react-router";
import { catalog, index } from "../data";
import type { ProtoModule } from "../catalog";
import { CapabilityEmpty, Empty } from "../components/PageHeader";
import { RowActions } from "../components/RowActions";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { MODULE_ANCHOR, paths } from "../routes";
import { countsOf, modules } from "../lib/registry";

/**
 * Every schema module the estate publishes or vendors.
 *
 * A table rather than cards, for the same reason the decisions index is one:
 * the commit, the counts and the publisher only read as columns when they are
 * in one, and "which of these is not pinned" is a question you answer by
 * scanning down rather than across.
 */
const COLUMNS: ColumnSpec<ProtoModule>[] = [
  {
    id: "module",
    header: "module",
    type: "mono",
    value: (module) => module.name,
    primary: true,
    title: (module) => module.id,
  },
  {
    id: "registry",
    header: "registry",
    type: "text",
    // A module that was never published has no registry, and saying so is
    // more useful than an empty cell that reads as missing data.
    value: (module) => module.registry ?? "not published",
    facet: true,
  },
  {
    id: "owner",
    header: "published by",
    type: "mono",
    // Nobody in the catalog owning it is the ordinary case, not a gap.
    value: (module) => module.owner ?? "—",
  },
  {
    id: "packages",
    header: "packages",
    type: "count",
    value: (module) => module.packages.length,
    href: (module) => `${paths.module(module.slug)}#${MODULE_ANCHOR.packages}`,
  },
  {
    id: "interfaces",
    header: "interfaces",
    type: "count",
    value: (module) => countsOf(index, module).interfaces,
    href: (module) =>
      `${paths.module(module.slug)}#${MODULE_ANCHOR.interfaces}`,
  },
  {
    id: "read-by",
    header: "read by",
    type: "count",
    value: (module) => countsOf(index, module).consumers,
    href: (module) => `${paths.module(module.slug)}#${MODULE_ANCHOR.used}`,
  },
  {
    id: "commit",
    header: "commit",
    type: "mono",
    // Not pinned means two builds a day apart can describe two different
    // modules under one name, which is worth reading in a column.
    value: (module) =>
      module.commit ? module.commit.slice(0, 12) : "not pinned",
  },
];

export function RegistryIndex() {
  useDocumentTitle("Registry");
  const rows = useMemo(() => modules(catalog), []);
  const bare = rows.length === 0;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Registry</h1>
      </div>

      {bare ? (
        <div className="mt-section">
          <CapabilityEmpty
            title="No schema modules discovered yet"
            signal="Signals: .proto files and registry metadata from BSR or local modules → modules[]."
            actions={<Link className="product-primary" to={catalog.contexts.length === 0 ? paths.settingsProjects() : paths.settingsPipeline()}>{catalog.contexts.length === 0 ? "Connect a project" : "Review extraction"}</Link>}
          >
            Registry modules show where shared contracts are published, pinned and consumed. Review the project’s protobuf and registry extractors to populate this index.
          </CapabilityEmpty>
        </div>
      ) : (
        <div className="mt-section max-w-table">
          <DataTable
            tableId="modules"
            caption="Schema modules"
            columns={COLUMNS}
            rows={rows}
            rowId={(module) => module.id}
            defaultSort={[{ id: "module", desc: false }]}
            sortInUrl
            rowLink={(module) => paths.module(module.slug)}
            rowActions={(module) => (
              <RowActions copy={module.id} label={module.id} />
            )}
            empty={<Empty>no module matches this filter</Empty>}
          />
        </div>
      )}
    </div>
  );
}
