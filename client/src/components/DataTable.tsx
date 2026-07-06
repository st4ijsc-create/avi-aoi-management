import * as React from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/AnalyticsSkeleton";

/**
 * DataTable — the shared, typed, accessible table primitive for the platform.
 *
 * Built on top of `ui/table`, it centralizes the sort / filter / paginate /
 * select logic that ~80 pages previously hand-rolled. It is fully generic over
 * the row type `T`, label-agnostic (all user-facing strings are English-default
 * props so pages can pass translated strings), and works in light and dark mode
 * using only semantic Tailwind tokens.
 *
 * @example
 * ```tsx
 * type User = { id: string; name: string; role: string; createdAt: Date };
 *
 * <DataTable<User>
 *   data={users}
 *   getRowId={(u) => u.id}
 *   searchable
 *   onRowClick={(u) => navigate(`/users/${u.id}`)}
 *   columns={[
 *     {
 *       id: "name",
 *       header: t("users.name"),
 *       cell: (u) => u.name,
 *       sortValue: (u) => u.name,
 *       filterValue: (u) => u.name,
 *     },
 *     {
 *       id: "role",
 *       header: t("users.role"),
 *       cell: (u) => u.role,
 *       sortValue: (u) => u.role,
 *     },
 *     {
 *       id: "createdAt",
 *       header: t("users.created"),
 *       cell: (u) => u.createdAt.toLocaleDateString(),
 *       sortValue: (u) => u.createdAt,
 *       align: "right",
 *     },
 *   ]}
 * />
 * ```
 */
export interface DataTableColumn<T> {
  /** Stable unique column identifier (used for sort state, React keys). */
  id: string;
  /** Header content. May be a translated string or arbitrary node. */
  header: React.ReactNode;
  /** Render the cell for a given row. */
  cell: (row: T) => React.ReactNode;
  /**
   * When provided, the column becomes sortable. Return a comparable primitive;
   * numbers/dates compare numerically, everything else compares as a locale
   * string. `null` / `undefined` always sort last.
   */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  /** When provided, the column's text is included in the global search. */
  filterValue?: (row: T) => string;
  /** Horizontal alignment for header + cells. Defaults to "left". */
  align?: "left" | "right" | "center";
  /** Fixed column width, e.g. "120px". */
  width?: string;
  /** Extra classes applied to every cell (and header) of this column. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** Stable identity for a row — used for keys and selection. */
  getRowId: (row: T) => string | number;
  /** Fires when a row body (not a control inside it) is activated. */
  onRowClick?: (row: T) => void;

  // selection (optional)
  selectable?: boolean;
  selectedIds?: Array<string | number>;
  onSelectionChange?: (ids: Array<string | number>) => void;

  // paging (client-side)
  /** Rows per page. Default 25. Ignored when `paginated={false}`. */
  pageSize?: number;
  /** Enable client-side pagination. Default true. */
  paginated?: boolean;

  // search (client-side global filter across columns that define filterValue)
  /** Render a debounced global search input above the table. Default false. */
  searchable?: boolean;
  /** Placeholder for the search input. Default "Search…". */
  searchPlaceholder?: string;

  // state
  /** Show the loading skeleton instead of rows. */
  loading?: boolean;
  /** Custom empty rendering. Defaults to <EmptyState />. */
  emptyState?: React.ReactNode;
  /** Initial sort column + direction. */
  initialSort?: { columnId: string; dir: "asc" | "desc" };
  /** Keep the header visible while scrolling. Default true. */
  stickyHeader?: boolean;
  className?: string;

  // toolbar slot (right side of the search row) for page-specific actions
  toolbar?: React.ReactNode;
}

type SortState = { columnId: string; dir: "asc" | "desc" } | null;

/** Debounce a rapidly-changing value (used for the search box). */
function useDebouncedValue<V>(value: V, delayMs: number): V {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/** Compare two sortValue results. Nulls always sort last (in both directions). */
function compareValues(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;

  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av).localeCompare(String(bv), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const alignClass: Record<
  NonNullable<DataTableColumn<unknown>["align"]>,
  string
> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  selectable = false,
  selectedIds,
  onSelectionChange,
  pageSize = 25,
  paginated = true,
  searchable = false,
  searchPlaceholder = "Search…",
  loading = false,
  emptyState,
  initialSort,
  stickyHeader = true,
  className,
  toolbar,
}: DataTableProps<T>): React.JSX.Element {
  const [sort, setSort] = React.useState<SortState>(initialSort ?? null);
  const [rawSearch, setRawSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const search = useDebouncedValue(rawSearch, 150);

  const selectedSet = React.useMemo(
    () => new Set(selectedIds ?? []),
    [selectedIds]
  );

  // Reset to page 1 whenever the effective filter or the dataset shape changes.
  React.useEffect(() => {
    setPage(1);
  }, [search, pageSize, paginated]);

  // 1. Filter
  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data;
    const searchableCols = columns.filter((c) => c.filterValue);
    if (searchableCols.length === 0) return data;
    return data.filter((row) =>
      searchableCols.some((col) =>
        col.filterValue!(row).toLowerCase().includes(query)
      )
    );
  }, [data, columns, search]);

  // 2. Sort
  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col?.sortValue) return filtered;
    const sortValue = col.sortValue;
    const factor = sort.dir === "asc" ? 1 : -1;
    // Stable sort: decorate with original index as tie-breaker.
    return filtered
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = compareValues(sortValue(a.row), sortValue(b.row));
        return cmp !== 0 ? cmp * factor : a.index - b.index;
      })
      .map((entry) => entry.row);
  }, [filtered, columns, sort]);

  // 3. Paginate
  const total = sorted.length;
  const usePaging = paginated && pageSize > 0;
  const pageCount = usePaging ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const clampedPage = Math.min(page, pageCount);

  React.useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);

  const pageRows = React.useMemo(() => {
    if (!usePaging) return sorted;
    const start = (clampedPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, usePaging, clampedPage, pageSize]);

  const rangeStart = total === 0 ? 0 : (clampedPage - 1) * (usePaging ? pageSize : total) + 1;
  const rangeEnd = usePaging
    ? Math.min(clampedPage * pageSize, total)
    : total;

  // Sorting: toggle asc → desc → none for the given column.
  const toggleSort = React.useCallback((columnId: string) => {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) {
        return { columnId, dir: "asc" };
      }
      if (prev.dir === "asc") return { columnId, dir: "desc" };
      return null;
    });
  }, []);

  // Selection helpers (operate on the current visible page).
  const pageIds = React.useMemo(
    () => pageRows.map((row) => getRowId(row)),
    [pageRows, getRowId]
  );
  const selectedOnPage = pageIds.filter((id) => selectedSet.has(id));
  const allPageSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const somePageSelected =
    selectedOnPage.length > 0 && selectedOnPage.length < pageIds.length;

  const emitSelection = React.useCallback(
    (next: Set<string | number>) => {
      onSelectionChange?.(Array.from(next));
    },
    [onSelectionChange]
  );

  const toggleSelectAllOnPage = React.useCallback(() => {
    const next = new Set(selectedSet);
    if (allPageSelected) {
      pageIds.forEach((id) => next.delete(id));
    } else {
      pageIds.forEach((id) => next.add(id));
    }
    emitSelection(next);
  }, [selectedSet, allPageSelected, pageIds, emitSelection]);

  const toggleSelectRow = React.useCallback(
    (id: string | number) => {
      const next = new Set(selectedSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      emitSelection(next);
    },
    [selectedSet, emitSelection]
  );

  const columnCount = columns.length + (selectable ? 1 : 0);

  // ---- Loading ----
  if (loading) {
    return (
      <div className={cn("w-full", className)}>
        <TableSkeleton
          rows={usePaging ? Math.min(pageSize, 8) : 8}
          columns={Math.max(1, columnCount)}
        />
      </div>
    );
  }

  const headerCellBase =
    "text-foreground h-10 px-2 align-middle font-medium whitespace-nowrap";

  return (
    <div className={cn("w-full space-y-3", className)}>
      {/* Toolbar row: search + page-specific actions */}
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex-1 min-w-[200px] max-w-sm">
            {searchable && (
              <Input
                type="search"
                value={rawSearch}
                onChange={(e) => setRawSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9"
              />
            )}
          </div>
          {toolbar && (
            <div className="flex items-center gap-2">{toolbar}</div>
          )}
        </div>
      )}

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader
            className={cn(
              stickyHeader && "sticky top-0 z-10 bg-card",
              "[&_tr]:border-b"
            )}
          >
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-[40px] pl-3">
                  <Checkbox
                    checked={
                      allPageSelected
                        ? true
                        : somePageSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={toggleSelectAllOnPage}
                    aria-label="Select all rows on this page"
                    disabled={pageIds.length === 0}
                  />
                </TableHead>
              )}
              {columns.map((col) => {
                const isSorted = sort?.columnId === col.id;
                const ariaSort: React.AriaAttributes["aria-sort"] = col.sortValue
                  ? isSorted
                    ? sort!.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined;
                return (
                  <TableHead
                    key={col.id}
                    aria-sort={ariaSort}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      headerCellBase,
                      alignClass[col.align ?? "left"],
                      col.className
                    )}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 select-none rounded-sm outline-none",
                          "hover:text-foreground text-muted-foreground transition-colors",
                          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                          isSorted && "text-foreground",
                          col.align === "right" && "flex-row-reverse",
                          col.align === "center" && "mx-auto"
                        )}
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          sort!.dir === "asc" ? (
                            <ChevronUp className="size-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="size-3.5 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3.5 shrink-0 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">
                        {col.header}
                      </span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columnCount}
                  className="h-auto p-0 whitespace-normal"
                >
                  {emptyState ?? (
                    <EmptyState
                      variant={
                        search.trim() ? "no-results" : "no-data"
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => {
                const id = getRowId(row);
                const isSelected = selectedSet.has(id);
                const clickable = Boolean(onRowClick);
                return (
                  <TableRow
                    key={String(id)}
                    data-state={isSelected ? "selected" : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick!(row);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      clickable &&
                        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    )}
                  >
                    {selectable && (
                      <TableCell
                        className="w-[40px] pl-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectRow(id)}
                          aria-label="Select row"
                        />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        style={col.width ? { width: col.width } : undefined}
                        className={cn(
                          alignClass[col.align ?? "left"],
                          col.className
                        )}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer: range + prev/next */}
      {usePaging && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{rangeStart}</span>
            {"–"}
            <span className="tabular-nums">{rangeEnd}</span>
            {" of "}
            <span className="tabular-nums">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              <span className="tabular-nums">{clampedPage}</span>
              {" / "}
              <span className="tabular-nums">{pageCount}</span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={clampedPage >= pageCount}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
