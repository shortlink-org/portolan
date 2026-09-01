// Everything a table remembers, and where it remembers it.
//
// Four different lifetimes, deliberately: the sort lives in the URL when the
// page has one to spare, so a sorted view can be sent to someone; the filters
// live for as long as the reader is looking; widths and hidden columns live in
// localStorage under the table's id; zebra striping lives once, globally,
// because it is a statement about tables rather than about this table.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { ColumnFiltersState, SortingState, Updater } from "@tanstack/react-table";
import {
  hiddenOf,
  readMemory,
  visibilityOf,
  writeMemory,
} from "./persist";
import { SORT_PARAM, formatSort, parseSort, sameSort } from "./sort-url";
import type { SortEntry } from "./sort-url";

/** TanStack hands back either the next value or a function producing it. */
export function applyUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === "function"
    ? (updater as (old: T) => T)(previous)
    : updater;
}

export interface TableStateOptions {
  tableId: string;
  /** Every column this table has, so a stale URL cannot name one it lacks. */
  columnIds: readonly string[];
  /** The order the page declares. Used until the reader says otherwise. */
  defaultSort: SortEntry[];
  /** True for index pages: the sort belongs in the address bar. */
  sortInUrl: boolean;
}

export interface TableState {
  sorting: SortingState;
  setSorting: (updater: Updater<SortingState>) => void;
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  columnFilters: ColumnFiltersState;
  setColumnFilters: (updater: Updater<ColumnFiltersState>) => void;
  /** The values a faceted column is currently narrowed to. Empty means all. */
  facetValues: (columnId: string) => string[];
  toggleFacet: (columnId: string, value: string) => void;
  columnVisibility: Record<string, boolean>;
  setColumnVisibility: (updater: Updater<Record<string, boolean>>) => void;
  columnSizing: Record<string, number>;
  setColumnSizing: (updater: Updater<Record<string, number>>) => void;
  filtersActive: boolean;
  clearFilters: () => void;
}

export function useTableState({
  tableId,
  columnIds,
  defaultSort,
  sortInUrl,
}: TableStateOptions): TableState {
  const [params, setParams] = useSearchParams();
  const [localSorting, setLocalSorting] = useState<SortingState>(defaultSort);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFiltersState] = useState<ColumnFiltersState>([]);

  // The URL is the source of truth only once it has said something. A page
  // that has never been sorted carries no param, and gets the page's default;
  // a param that is present but empty is the reader having cleared the sort,
  // which is a different thing from never having touched it.
  const urlSorting = useMemo(() => {
    if (!sortInUrl || !params.has(SORT_PARAM)) return null;
    return parseSort(params.get(SORT_PARAM), columnIds);
  }, [sortInUrl, params, columnIds]);

  const sorting = sortInUrl ? (urlSorting ?? defaultSort) : localSorting;

  const setSorting = useCallback(
    (updater: Updater<SortingState>) => {
      const next = applyUpdater(updater, sorting);
      if (!sortInUrl) {
        setLocalSorting(next);
        return;
      }
      if (urlSorting !== null && sameSort(urlSorting, next)) return;
      const nextParams = new URLSearchParams(params);
      nextParams.set(SORT_PARAM, formatSort(next));
      // Replace: a sort is a view of this page, not a page of its own, and
      // eight clicks on a header should not be eight presses of Back.
      setParams(nextParams, { replace: true });
    },
    [sorting, sortInUrl, urlSorting, params, setParams],
  );

  const setColumnFilters = useCallback(
    (updater: Updater<ColumnFiltersState>) =>
      setColumnFiltersState((previous) => applyUpdater(updater, previous)),
    [],
  );

  const facetValues = useCallback(
    (columnId: string): string[] => {
      const entry = columnFilters.find((filter) => filter.id === columnId);
      return Array.isArray(entry?.value) ? (entry.value as string[]) : [];
    },
    [columnFilters],
  );

  const toggleFacet = useCallback(
    (columnId: string, value: string) => {
      setColumnFiltersState((previous) => {
        const current = previous.find((filter) => filter.id === columnId);
        const values = Array.isArray(current?.value)
          ? (current.value as string[])
          : [];
        const next = values.includes(value)
          ? values.filter((v) => v !== value)
          : [...values, value];
        const rest = previous.filter((filter) => filter.id !== columnId);
        // An empty chip-set is no filter at all, not a filter matching nothing.
        return next.length === 0 ? rest : [...rest, { id: columnId, value: next }];
      });
    },
    [],
  );

  // Widths and hidden columns come back from the last visit before the first
  // paint, so the table never appears in one shape and settles into another.
  const [memory] = useState(() => readMemory(tableId));
  const [columnVisibility, setVisibilityState] = useState<Record<string, boolean>>(
    () => visibilityOf(memory.hidden),
  );
  const [columnSizing, setSizingState] = useState<Record<string, number>>(
    () => memory.sizing,
  );

  const setColumnVisibility = useCallback(
    (updater: Updater<Record<string, boolean>>) =>
      setVisibilityState((previous) => applyUpdater(updater, previous)),
    [],
  );
  const setColumnSizing = useCallback(
    (updater: Updater<Record<string, number>>) =>
      setSizingState((previous) => applyUpdater(updater, previous)),
    [],
  );

  // Skip the write on mount: it would only put back what was just read, and
  // on a table nobody has touched it would create a key for no reason.
  const written = useRef(false);
  useEffect(() => {
    if (!written.current) {
      written.current = true;
      return;
    }
    writeMemory(tableId, {
      sizing: columnSizing,
      hidden: hiddenOf(columnVisibility),
    });
  }, [tableId, columnSizing, columnVisibility]);

  const filtersActive = globalFilter !== "" || columnFilters.length > 0;
  const clearFilters = useCallback(() => {
    setGlobalFilter("");
    setColumnFiltersState([]);
  }, []);

  return {
    sorting,
    setSorting,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    facetValues,
    toggleFacet,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing,
    filtersActive,
    clearFilters,
  };
}
