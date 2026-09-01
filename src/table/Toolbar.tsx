// What sits above a table, once a table is big enough to need anything.
//
// The threshold matters more than the contents: a filter over six rows is a
// control that costs more attention than the scanning it saves. Above it, the
// order is the order a reader reaches for - narrow it, see how much is left,
// then take it somewhere.

import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Download, Ellipsis, Rows3, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Facets } from "./Facets";
import type { FacetValue } from "./Facets";
import { ColumnsMenu } from "./ColumnsMenu";
import type { ColumnToggle } from "./ColumnsMenu";

export interface FacetGroup {
  columnId: string;
  label: string;
  values: FacetValue[];
  selected: string[];
}

export interface ExportActions {
  copyMarkdown: () => void;
  copyCsv: () => void;
  downloadCsv: () => void;
}

/** Copy that reports itself, because a clipboard write is otherwise silent. */
function ExportMenu({ actions, note }: { actions: ExportActions; note: string }) {
  const items: [string, () => void, ReactNode][] = [
    ["Copy as Markdown", actions.copyMarkdown, null],
    ["Copy as CSV", actions.copyCsv, null],
    [
      "Download CSV",
      actions.downloadCsv,
      <Download key="i" size={12} aria-hidden className="ml-auto shrink-0" />,
    ],
  ];
  return (
    <Menu>
      <MenuButton
        aria-label="Export this view"
        title={`Export ${note}`}
        className={({ open }) => `tbtn ${open ? "tbtn-on" : ""}`}
      >
        <Ellipsis size={13} aria-hidden />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 min-w-48 rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        <p className="mono px-2 py-1 text-muted">{note}</p>
        {items.map(([label, run, trailing]) => (
          <MenuItem key={label}>
            {({ focus }) => (
              <button
                type="button"
                onClick={run}
                className={`mono flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left ${
                  focus ? "bg-raised" : ""
                }`}
              >
                {label}
                {trailing}
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

export function Toolbar({
  filter,
  onFilter,
  facets,
  onToggleFacet,
  shown,
  total,
  filtersActive,
  onClearFilters,
  columns,
  onToggleColumn,
  zebra,
  onToggleZebra,
  exports,
}: {
  filter: string;
  onFilter: (value: string) => void;
  /** Empty on a markdown table: a README gets a text filter and nothing else. */
  facets: readonly FacetGroup[];
  onToggleFacet: (columnId: string, value: string) => void;
  shown: number;
  total: number;
  filtersActive: boolean;
  onClearFilters: () => void;
  /** Omitted below six columns, where there is nothing worth hiding. */
  columns?: readonly ColumnToggle[];
  onToggleColumn?: (id: string) => void;
  zebra: boolean;
  /** Omitted on a markdown table, which offers a text filter and nothing else. */
  onToggleZebra?: () => void;
  exports?: ExportActions;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <label className="tbtn gap-1.5 focus-within:border-line-strong">
        <Search size={13} aria-hidden className="shrink-0" />
        <input
          type="search"
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="filter"
          aria-label="Filter rows"
          /* Sized to a search term, not to the toolbar: an input that grows
             to fill the row makes every table look like a search page. */
          className="mono w-32 bg-transparent text-ink placeholder:text-muted focus:outline-none"
        />
      </label>

      {facets.map((group) => (
        <Facets
          key={group.columnId}
          label={group.label}
          values={group.values}
          selected={group.selected}
          onToggle={(value) => onToggleFacet(group.columnId, value)}
        />
      ))}

      {/* The count is the answer to the question the filter just asked. */}
      <span className="mono text-muted">
        <span className="tnum">{shown}</span> of{" "}
        <span className="tnum">{total}</span>
      </span>

      {filtersActive ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="mono flex items-center gap-1 rounded-control text-muted hover:text-ink"
        >
          <X size={12} aria-hidden />
          clear filters
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {onToggleZebra ? (
          <button
            type="button"
            onClick={onToggleZebra}
            aria-pressed={zebra}
            title="Stripe alternate rows"
            aria-label="Stripe alternate rows"
            className={`tbtn ${zebra ? "tbtn-on" : ""}`}
          >
            <Rows3 size={13} aria-hidden />
          </button>
        ) : null}
        {columns && onToggleColumn ? (
          <ColumnsMenu columns={columns} onToggle={onToggleColumn} />
        ) : null}
        {exports ? (
          <ExportMenu
            actions={exports}
            note={
              shown === total
                ? `all ${total} rows`
                : `${shown} of ${total} rows`
            }
          />
        ) : null}
      </div>
    </div>
  );
}
