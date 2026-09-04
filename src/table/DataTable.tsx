// One table, everywhere.
//
// Index pages used to hand-write a <table> each, which meant each one sorted
// (or did not) in its own way, and a table in a README was a third thing
// again. This is the one primitive underneath all of them: the page declares
// what its columns HOLD, and this decides what that means - how they sort,
// which way they line up, what a cell looks like, what the toolbar offers.
//
// It owns the parts a page should not have to re-litigate: the sticky header,
// the density, the j/k list, the selected row, the widths the reader dragged.
// TanStack owns the models. Neither owns the markup, which stays here as the
// same .tbl the app already had.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, Row, RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useDensity } from "../app/density";
import { useUiStore } from "../app/ui-store";
import { useSelectionStore } from "../selection/store";
import { toClipboard } from "../lib/clipboard";
import { comparatorFor } from "./compare";
import { defaultCell } from "./cells";
import { Toolbar } from "./Toolbar";
import type { ExportActions, FacetGroup } from "./Toolbar";
import { csvFilename, toCsv, toMarkdown } from "./export";
import { applyUpdater, useTableState } from "./useTableState";
import type { SortEntry } from "./sort-url";
import type { CellValue, ColumnSpec } from "./types";
import { canFacet, cellText, defaultAlign, isTextish } from "./types";

/** Registered features, and only those: v9 installs nothing it is not asked for. */
const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
});

type Features = typeof FEATURES;

/**
 * Above this many rows the body is virtualized. Never paginated: a page
 * boundary breaks find-in-page, breaks "sort by date and look at the end",
 * and turns one list into an argument about which page a row is on.
 */
const VIRTUALIZE_AT = 200;

/** Row heights, matching the two --row-h settings the density toggle writes. */
const ROW_H = { comfortable: 40, compact: 30 } as const;

/** How far a column may be auto-fitted before it is just a wide column. */
const AUTOFIT_MAX = 560;
const MIN_WIDTH = 56;

export interface DataTableProps<T extends RowData> {
  /** Stable id. Widths and hidden columns are remembered under it. */
  tableId: string;
  columns: readonly ColumnSpec<T>[];
  rows: readonly T[];
  rowId: (row: T) => string;
  /** The order the page declares. */
  defaultSort?: SortEntry[];
  /** Index pages: put the sort in the address so the view can be sent. */
  sortInUrl?: boolean;
  /** Where a row goes when it is clicked. Omitted where a row goes nowhere. */
  rowLink?: (row: T) => string | null | undefined;
  /** Copy and reveal, per row. */
  rowActions?: (row: T) => ReactNode;
  /** The catalog id this row is, so the global selection can light it up. */
  selectionId?: (row: T) => string | null | undefined;
  /**
   * A second row underneath, spanning every column. Returns null for the rows
   * that have nothing to expand - which is most of them, most of the time.
   * A table with detail rows is never virtualized: the rows are no longer one
   * height, and a virtualizer that guesses wrong scrolls to the wrong place.
   */
  subRow?: (row: T) => ReactNode | null;
  /** Rows at which the toolbar appears. 8 on an index page, 10 in a README. */
  toolbarAt?: number;
  /** README tables: a text filter and nothing else. */
  minimal?: boolean;
  /** No toolbar, no sort, no memory. Small README tables stay quiet. */
  plain?: boolean;
  empty?: ReactNode;
  /** Accessible name, and the name the export menu reports. */
  caption?: string;
  className?: string;
}

/** The columns a menu may hide: everything but the one that names the row. */
function hideable<T>(spec: ColumnSpec<T>, primaryId: string): boolean {
  return spec.enableHiding ?? spec.id !== primaryId;
}

export function DataTable<T extends RowData>({
  tableId,
  columns: specs,
  rows: data,
  rowId,
  defaultSort = [],
  sortInUrl = false,
  rowLink,
  rowActions,
  selectionId,
  subRow,
  toolbarAt = 8,
  minimal = false,
  plain = false,
  empty,
  caption,
  className = "",
}: DataTableProps<T>) {
  const navigate = useNavigate();
  const { density } = useDensity();
  const zebra = useUiStore((s) => s.zebra);
  const toggleZebra = useUiStore((s) => s.toggleZebra);
  const selection = useSelectionStore((s) => s.selection);

  const tableRef = useRef<HTMLTableElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const specById = useMemo(
    () => new Map(specs.map((spec) => [spec.id, spec])),
    [specs],
  );
  const columnIds = useMemo(() => specs.map((spec) => spec.id), [specs]);
  // The column that names the row: it carries the link and the j/k focus, and
  // it is the one column a reader may not switch off.
  const primaryId = (specs.find((spec) => spec.primary) ?? specs[0])?.id ?? "";

  const state = useTableState({
    tableId,
    columnIds,
    defaultSort,
    sortInUrl: sortInUrl && !plain,
  });

  // Widths measured from the first layout. Transient on purpose: only a width
  // the reader dragged is worth remembering, and a width measured in a narrow
  // window should not follow them into a wide one.
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const sizing = useMemo(
    () => ({ ...measured, ...state.columnSizing }),
    [measured, state.columnSizing],
  );
  const resized = Object.keys(state.columnSizing).length > 0;

  const columnDefs = useMemo<ColumnDef<Features, T, unknown>[]>(
    () =>
      specs.map((spec) => {
        const compare = comparatorFor(spec.type);
        return {
          id: spec.id,
          accessorFn: (row: T) => spec.value(row),
          header: spec.header,
          // Ascending only. The table reverses this itself for descending.
          sortFn: (a: Row<Features, T>, b: Row<Features, T>, id: string) =>
            compare(a.getValue<CellValue>(id), b.getValue<CellValue>(id)),
          // The empty cell goes last in both directions, which is a promise
          // no comparator can keep on its own.
          sortUndefined: "last" as const,
          enableSorting: (spec.enableSorting ?? true) && !plain,
          enableHiding: hideable(spec, primaryId),
          // A chip-set narrows to the values it has switched on; an empty set
          // is not a filter.
          filterFn: (row: Row<Features, T>, id: string, value: unknown) => {
            if (!Array.isArray(value) || value.length === 0) return true;
            return (value as string[]).includes(cellText(row.getValue(id)));
          },
          size: spec.size,
          minSize: spec.minSize ?? MIN_WIDTH,
        };
      }),
    [specs, plain, primaryId],
  );

  const table = useTable<Features, T>({
    features: FEATURES,
    columns: columnDefs,
    data: data as T[],
    getRowId: (row) => rowId(row),
    state: {
      sorting: state.sorting,
      globalFilter: state.globalFilter,
      columnFilters: state.columnFilters,
      columnVisibility: state.columnVisibility,
      columnSizing: sizing,
    },
    onSortingChange: state.setSorting,
    onColumnFiltersChange: state.setColumnFilters,
    onColumnVisibilityChange: state.setColumnVisibility,
    onColumnSizingChange: (updater) => {
      const next = applyUpdater(updater, sizing);
      // Only what differs from the measured layout is the reader's doing, and
      // only the reader's doing is worth storing.
      state.setColumnSizing((previous) => {
        const out = { ...previous };
        for (const [id, width] of Object.entries(next)) {
          if (measured[id] !== width) out[id] = width;
        }
        return out;
      });
    },
    columnResizeMode: "onChange",
    enableMultiSort: true,
    enableSortingRemoval: true,
    globalFilterFn: (row: Row<Features, T>, id: string, value: unknown) => {
      const needle = String(value).trim().toLowerCase();
      if (needle === "") return true;
      return cellText(row.getValue<CellValue>(id))
        .toLowerCase()
        .includes(needle);
    },
    // The free-text filter searches what is written in words, not the numbers
    // and dates beside them: typing "3" should not match a version column.
    getColumnCanGlobalFilter: (column) => {
      const spec = specById.get(column.id);
      return spec !== undefined && isTextish(spec.type);
    },
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const visibleIds = visibleColumns.map((column) => column.id).join(",");
  const rows = table.getRowModel().rows;
  const total = data.length;

  // Measure once per column set, before paint, so the resize handles have a
  // real width to start from and nothing is ever seen mid-settle.
  useLayoutEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const ids = visibleIds === "" ? [] : visibleIds.split(",");
    const missing = ids.filter((id) => measured[id] === undefined);
    if (missing.length === 0) return;
    const next: Record<string, number> = {};
    for (const id of missing) {
      const th = element.querySelector<HTMLElement>(
        `th[data-col="${CSS.escape(id)}"]`,
      );
      if (th) next[id] = Math.round(th.getBoundingClientRect().width);
    }
    if (Object.keys(next).length > 0) {
      setMeasured((previous) => ({ ...previous, ...next }));
    }
  }, [visibleIds, measured]);

  /**
   * Double-clicking an edge fits the column to what is in it. The cells are
   * briefly let out of their box, read, and put back inside one frame, which
   * is the only way to ask a clipped element how wide it would rather be.
   */
  const autoFit = useCallback(
    (columnId: string) => {
      const element = tableRef.current;
      if (!element) return;
      element.classList.add("cell-measure");
      let widest = MIN_WIDTH;
      const cells = element.querySelectorAll<HTMLElement>(
        `[data-col="${CSS.escape(columnId)}"] .cell-body`,
      );
      for (const cell of cells) widest = Math.max(widest, cell.scrollWidth);
      element.classList.remove("cell-measure");
      // The padding the cell itself adds, which scrollWidth does not include.
      const width = Math.min(AUTOFIT_MAX, widest + 34);
      state.setColumnSizing((previous) => ({ ...previous, [columnId]: width }));
    },
    [state.setColumnSizing],
  );

  // --- The toolbar's inputs ------------------------------------------------

  const facetGroups = useMemo<FacetGroup[]>(() => {
    if (plain || minimal) return [];
    const groups: FacetGroup[] = [];
    for (const spec of specs) {
      if (!spec.facet || !canFacet(spec.type)) continue;
      const counts = new Map<string, number>();
      for (const row of data) {
        const value = cellText(spec.value(row));
        if (value === "") continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      if (counts.size < 2) continue;
      const compare = comparatorFor(spec.type);
      groups.push({
        columnId: spec.id,
        label: spec.header,
        // The chips read in the column's own order, so a status set is not
        // alphabetical and a kind set is not either.
        values: [...counts.entries()]
          .sort(([a], [b]) => compare(a, b))
          .map(([value, count]) => ({ value, count })),
        selected: state.facetValues(spec.id),
      });
    }
    return groups;
  }, [specs, data, plain, minimal, state.facetValues]);

  const sheet = useCallback(() => {
    const leaves = table.getVisibleLeafColumns();
    return {
      headers: leaves.map((column) => specById.get(column.id)?.header ?? column.id),
      rows: rows.map((row) =>
        leaves.map((column) => cellText(row.getValue<CellValue>(column.id))),
      ),
    };
  }, [table, rows, specById]);

  const exports = useMemo<ExportActions>(
    () => ({
      copyMarkdown: () => void toClipboard(toMarkdown(sheet())),
      copyCsv: () => void toClipboard(toCsv(sheet())),
      downloadCsv: () => {
        const blob = new Blob([toCsv(sheet())], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = csvFilename(tableId);
        link.click();
        URL.revokeObjectURL(url);
      },
    }),
    [sheet, tableId],
  );

  const columnToggles = useMemo(
    () =>
      table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide())
        .map((column) => ({
          id: column.id,
          header: specById.get(column.id)?.header ?? column.id,
          visible: column.getIsVisible(),
        })),
    [table, specById, state.columnVisibility],
  );

  const showToolbar = !plain && total >= toolbarAt;

  // --- Rows ----------------------------------------------------------------

  const virtual = rows.length > VIRTUALIZE_AT && !subRow;
  const rowHeight = ROW_H[density];
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 12,
  });
  const items = virtual ? virtualizer.getVirtualItems() : [];
  const padTop = items.length > 0 ? (items[0]?.start ?? 0) : 0;
  const padBottom =
    items.length > 0
      ? virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0)
      : 0;

  const selectedRowId = useMemo(() => {
    if (!selectionId || !selection) return null;
    const hit = data.find((row) => selectionId(row) === selection.id);
    return hit ? rowId(hit) : null;
  }, [selectionId, selection, data, rowId]);

  // A selection made somewhere else - the tree, a diagram, the palette - has
  // to be visible here, which means scrolled to when it is off screen.
  useEffect(() => {
    if (!selectedRowId) return;
    const row = tableRef.current?.querySelector<HTMLElement>(
      `tr[data-row="${CSS.escape(selectedRowId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedRowId]);

  const columnCount = visibleColumns.length + (rowActions ? 1 : 0);

  const renderRow = (row: Row<Features, T>, index: number) => {
    const original = row.original;
    const link = rowLink?.(original) ?? null;
    const active = selectedRowId !== null && row.id === selectedRowId;
    const row_ = (
      <tr
        key={row.id}
        data-row={row.id}
        /* Striping reads off the display position rather than nth-child, so a
           virtualized body's spacer rows cannot flip the parity. */
        data-even={index % 2 === 0}
        data-selected={active || undefined}
        style={virtual ? { height: rowHeight } : undefined}
        className={active ? "bg-surface" : undefined}
        onClick={
          link
            ? (event) => {
                // Ids, row actions and links inside cells are their own
                // targets; the row is what is left over.
                if (
                  (event.target as HTMLElement).closest("a,button,input,label")
                ) {
                  return;
                }
                navigate(link);
              }
            : undefined
        }
      >
        {row.getVisibleCells().map((cell) => {
          const spec = specById.get(cell.column.id);
          if (!spec) return null;
          const value = cell.getValue<CellValue>();
          const align = spec.align ?? defaultAlign(spec.type);
          const body = spec.cell
            ? spec.cell(original)
            : defaultCell(spec.type, value, spec.href?.(original));
          const isPrimary = spec.id === primaryId;
          return (
            <td
              key={cell.id}
              data-col={spec.id}
              title={spec.title?.(original)}
              className={`px-4 align-middle ${align === "right" ? "text-right" : ""} ${
                link && isPrimary ? "cursor-pointer" : ""
              }`}
              style={resized ? { width: sizing[spec.id] } : undefined}
            >
              <span
                className={`cell-body ${spec.type === "text" ? "" : "cell-body-nowrap"} ${
                  align === "right" ? "text-right" : ""
                }`}
              >
                {link && isPrimary ? (
                  // The row navigates on click; this is the same trip for a
                  // keyboard, and the link j/k walks. A real <Link>, so the
                  // basename is applied and a middle click still opens a tab.
                  <Link
                    to={link}
                    data-nav-item
                    className="rounded-control hover:underline"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </span>
            </td>
          );
        })}
        {rowActions ? (
          <td className="px-4 align-middle whitespace-nowrap">
            {rowActions(original)}
          </td>
        ) : null}
      </tr>
    );

    const detail = subRow?.(original) ?? null;
    if (!detail) return row_;

    return (
      <Fragment key={row.id}>
        {row_}
        <tr className="bg-surface">
          <td colSpan={columnCount} className="px-4 py-2">
            {detail}
          </td>
        </tr>
      </Fragment>
    );
  };

  return (
    <div className={className}>
      {showToolbar ? (
        <Toolbar
          filter={state.globalFilter}
          onFilter={state.setGlobalFilter}
          facets={facetGroups}
          onToggleFacet={state.toggleFacet}
          shown={rows.length}
          total={total}
          filtersActive={state.filtersActive}
          onClearFilters={state.clearFilters}
          /* Offered above five columns - counted as the table has, not as the
             menu would list: the column that names the row is not hideable,
             and a six-column table is still a six-column table. */
          columns={!minimal && specs.length > 5 ? columnToggles : undefined}
          onToggleColumn={
            !minimal && specs.length > 5
              ? (id) => table.getColumn(id)?.toggleVisibility()
              : undefined
          }
          /* A README gets a text filter and nothing else; striping is a
             preference about the app, and a README is not where it is set. */
          zebra={zebra}
          onToggleZebra={minimal ? undefined : toggleZebra}
          exports={minimal ? undefined : exports}
        />
      ) : null}

      {/* `isolate`: the sticky head and column stack by z-index inside the
          table, and those numbers must not reach the page - a corner cell at
          z-30 would otherwise ride over the pinned name row as it passes. */}
      <div
        ref={scrollRef}
        className="isolate overflow-x-auto rounded-card border border-line shadow-xs"
        style={virtual ? { maxHeight: "70vh", overflowY: "auto" } : undefined}
      >
        <table
          ref={tableRef}
          data-nav-list
          className={`tbl tbl-sticky ${zebra && !plain ? "tbl-zebra" : ""}`}
          style={
            resized
              ? { tableLayout: "fixed", width: "max-content", minWidth: "100%" }
              : undefined
          }
        >
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="text-left">
                {group.headers.map((header) => {
                  const spec = specById.get(header.column.id);
                  if (!spec) return null;
                  const align = spec.align ?? defaultAlign(spec.type);
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const rank = header.column.getSortIndex();
                  return (
                    <th
                      key={header.id}
                      data-col={spec.id}
                      scope="col"
                      /* No `relative` here: the sticky header is already a
                         containing block for the resize handle, and a utility
                         `position` would take the header off the top of the
                         scroller it is supposed to be pinned to. */
                      className="px-4 font-normal"
                      style={resized ? { width: sizing[spec.id] } : undefined}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          data-sorted={sorted !== false}
                          title={`Sort by ${spec.header}. Shift-click to add a second key.`}
                          className={`th-sort ${align === "right" ? "justify-end" : ""}`}
                        >
                          <span className="truncate">{spec.header}</span>
                          {sorted === "desc" ? (
                            <ChevronDown
                              size={12}
                              aria-hidden
                              className="sort-mark"
                            />
                          ) : (
                            <ChevronUp
                              size={12}
                              aria-hidden
                              className="sort-mark"
                            />
                          )}
                          {/* Only worth saying when there is more than one key. */}
                          {rank > 0 ? (
                            <span className="sort-rank">{rank + 1}</span>
                          ) : null}
                        </button>
                      ) : (
                        <span className="label">{spec.header}</span>
                      )}
                      {!plain ? (
                        <span
                          /* A pointer affordance and nothing else. Given no
                             role: the app does not implement keyboard column
                             resizing, and a control that announces itself
                             without answering the keyboard is worse than one
                             that stays quiet. */
                          aria-hidden
                          title={`Drag to resize ${spec.header}, double-click to fit`}
                          className={`col-resize ${
                            header.column.getIsResizing() ? "col-resize-on" : ""
                          }`}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={() => autoFit(spec.id)}
                        />
                      ) : null}
                    </th>
                  );
                })}
                {rowActions ? <th className="px-4" /> : null}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 text-muted">
                  {empty ?? "nothing here matches this filter"}
                </td>
              </tr>
            ) : virtual ? (
              <>
                {padTop > 0 ? (
                  <tr aria-hidden style={{ height: padTop }}>
                    <td colSpan={columnCount} />
                  </tr>
                ) : null}
                {items.map((item) => {
                  const row = rows[item.index];
                  return row ? renderRow(row, item.index) : null;
                })}
                {padBottom > 0 ? (
                  <tr aria-hidden style={{ height: padBottom }}>
                    <td colSpan={columnCount} />
                  </tr>
                ) : null}
              </>
            ) : (
              rows.map((row, index) => renderRow(row, index))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
