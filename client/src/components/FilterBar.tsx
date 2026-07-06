/**
 * FilterBar — a reusable, URL-synced filter/scope bar for list & dashboard pages.
 *
 * Across the platform, filter/scope bars (product / line / machine / date range)
 * were re-implemented per page and their state was lost on reload/back because it
 * lived in local component state instead of the URL. This primitive centralises
 * that: filter values are written to the query string (via the wouter router), so
 * views become shareable, bookmarkable, and consistent. Pages that only want the
 * state (not the bar UI) can use the `useUrlFilters` hook directly.
 *
 * The primitive is intentionally label-agnostic — all human-readable text comes
 * from the caller's `FilterDef` list, so it stays i18n-safe. Only tiny built-in
 * affordances ("Clear", "Filters") use plain-English defaults that callers may
 * override in future via props if needed.
 *
 * URL contract:
 *  - `search` / `select` / `date` filters store one query param named `key`.
 *  - `daterange` filters store two params: `${key}From` and `${key}To` (YYYY-MM-DD).
 *  - Empty / undefined values are removed from the URL entirely.
 *  - Unrelated params (`tab=`, `id=`, …) are always preserved on write.
 *
 * @example
 * ```tsx
 * const filters: FilterDef[] = [
 *   { key: "q", type: "search", label: "Search", placeholder: "Serial, ref…" },
 *   { key: "line", type: "select", label: "Line", options: [
 *       { value: "L1", label: "Line 1" }, { value: "L2", label: "Line 2" } ] },
 *   { key: "window", type: "daterange", label: "Date range" },
 * ];
 *
 * // URL-synced (default). Read the values elsewhere on the page:
 * const { values } = useUrlFilters(filters);
 * // values.q, values.line, values.windowFrom, values.windowTo
 *
 * <FilterBar filters={filters}>
 *   <Button size="sm" onClick={exportCsv}>Export</Button>
 * </FilterBar>
 * ```
 */
import * as React from "react";
import { useLocation, useSearch } from "wouter";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, Search, SlidersHorizontal, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FilterDef =
  | { key: string; type: "search"; label: string; placeholder?: string }
  | {
      key: string;
      type: "select";
      label: string;
      options: Array<{ value: string; label: string }>;
      placeholder?: string;
    }
  | { key: string; type: "date"; label: string }
  | { key: string; type: "daterange"; label: string }; // stores as `${key}From` / `${key}To`

export type FilterValues = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** All query-param keys a set of defs manages (daterange expands to From/To). */
function managedKeys(defs: FilterDef[]): string[] {
  const keys: string[] = [];
  for (const def of defs) {
    if (def.type === "daterange") {
      keys.push(`${def.key}From`, `${def.key}To`);
    } else {
      keys.push(def.key);
    }
  }
  return keys;
}

/** Format a Date as a stable, timezone-safe `YYYY-MM-DD` string (local calendar day). */
function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` string back into a local-midnight Date (undefined if invalid). */
function parseDay(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return undefined;
  const [y, m, day] = parts;
  return new Date(y, m - 1, day);
}

// ---------------------------------------------------------------------------
// useUrlFilters — the URL-sync hook (usable standalone)
// ---------------------------------------------------------------------------

/**
 * Reads/writes filter values from the current URL's query string using the same
 * wouter idiom the rest of the codebase uses (`useSearch()` to read, the
 * `useLocation()` setter to navigate). Unrelated params are never clobbered.
 */
export function useUrlFilters(defs: FilterDef[]): {
  values: FilterValues;
  setValue: (key: string, value: string | undefined) => void;
  setValues: (patch: FilterValues) => void;
  clear: () => void;
  activeCount: number;
} {
  const search = useSearch();
  const [location, setLocation] = useLocation();

  const keys = React.useMemo(() => managedKeys(defs), [defs]);

  const values = React.useMemo<FilterValues>(() => {
    const params = new URLSearchParams(search);
    const next: FilterValues = {};
    for (const key of keys) {
      const val = params.get(key);
      if (val !== null && val !== "") next[key] = val;
    }
    return next;
  }, [search, keys]);

  // Base every write on the freshest URL so unrelated params (tab=, id=, …) survive.
  const writeParams = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(search);
      mutate(params);
      const qs = params.toString();
      setLocation(qs ? `${location}?${qs}` : location);
    },
    [search, location, setLocation],
  );

  const setValue = React.useCallback(
    (key: string, value: string | undefined) => {
      writeParams((params) => {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      });
    },
    [writeParams],
  );

  const setValues = React.useCallback(
    (patch: FilterValues) => {
      writeParams((params) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === "") params.delete(key);
          else params.set(key, value);
        }
      });
    },
    [writeParams],
  );

  const clear = React.useCallback(() => {
    writeParams((params) => {
      for (const key of keys) params.delete(key);
    });
  }, [writeParams, keys]);

  const activeCount = React.useMemo(() => {
    let count = 0;
    for (const def of defs) {
      if (def.type === "daterange") {
        if (values[`${def.key}From`] || values[`${def.key}To`]) count++;
      } else if (values[def.key]) {
        count++;
      }
    }
    return count;
  }, [defs, values]);

  return { values, setValue, setValues, clear, activeCount };
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export interface FilterBarProps {
  filters: FilterDef[];
  /** Controlled value map. Combine with `onChange` + `syncToUrl={false}`. */
  values?: FilterValues;
  onChange?: (values: FilterValues) => void;
  /** Sync state to the URL query string (default `true`). */
  syncToUrl?: boolean;
  className?: string;
  /** Extra controls rendered on the right (e.g. an export button). */
  children?: React.ReactNode;
}

/** Small uppercase caption used to label each control accessibly. */
function ControlLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </Label>
  );
}

/** Debounced text/search control — commits ~200ms after the user stops typing. */
function SearchControl({
  def,
  id,
  value,
  onCommit,
}: {
  def: Extract<FilterDef, { type: "search" }>;
  id: string;
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  const [text, setText] = React.useState<string>(value ?? "");

  const valueRef = React.useRef<string | undefined>(value);
  const onCommitRef = React.useRef(onCommit);
  React.useEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onCommit;
  });

  // Reflect external changes (URL navigation, clear, controlled updates).
  React.useEffect(() => {
    setText(value ?? "");
  }, [value]);

  // Debounce commits.
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const current = valueRef.current ?? "";
      const trimmed = text.trim();
      if (current !== trimmed) onCommitRef.current(trimmed === "" ? undefined : trimmed);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [text]);

  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{def.label}</ControlLabel>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          value={text}
          placeholder={def.placeholder}
          aria-label={def.label}
          onChange={(e) => setText(e.target.value)}
          className="h-9 w-48 pl-8 pr-8"
        />
        {text !== "" && (
          <button
            type="button"
            aria-label={`Clear ${def.label}`}
            onClick={() => {
              setText("");
              onCommit(undefined);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Single-select control. */
function SelectControl({
  def,
  id,
  value,
  onCommit,
}: {
  def: Extract<FilterDef, { type: "select" }>;
  id: string;
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{def.label}</ControlLabel>
      <div className="flex items-center gap-1">
        <Select value={value ?? ""} onValueChange={(v) => onCommit(v || undefined)}>
          <SelectTrigger id={id} aria-label={def.label} className="h-9 w-44">
            <SelectValue placeholder={def.placeholder ?? def.label} />
          </SelectTrigger>
          <SelectContent>
            {def.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${def.label}`}
            onClick={() => onCommit(undefined)}
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Single-date picker (popover + calendar). */
function DateControl({
  def,
  id,
  value,
  onCommit,
}: {
  def: Extract<FilterDef, { type: "date" }>;
  id: string;
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = parseDay(value);

  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{def.label}</ControlLabel>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-label={def.label}
              className={cn(
                "h-9 w-44 justify-start font-normal",
                !selected && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="size-4" aria-hidden="true" />
              {selected ? formatDay(selected) : def.label}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(d) => {
                onCommit(d ? formatDay(d) : undefined);
                setOpen(false);
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${def.label}`}
            onClick={() => onCommit(undefined)}
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Date-range picker — writes `${key}From` / `${key}To`. */
function DateRangeControl({
  def,
  id,
  from,
  to,
  onCommit,
}: {
  def: Extract<FilterDef, { type: "daterange" }>;
  id: string;
  from: string | undefined;
  to: string | undefined;
  onCommit: (patch: FilterValues) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const range: DateRange | undefined = React.useMemo(() => {
    const f = parseDay(from);
    const t = parseDay(to);
    if (!f && !t) return undefined;
    return { from: f, to: t };
  }, [from, to]);

  const hasValue = Boolean(from || to);
  const summary = hasValue ? `${from ?? "…"} → ${to ?? "…"}` : def.label;

  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{def.label}</ControlLabel>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-label={def.label}
              className={cn(
                "h-9 w-56 justify-start font-normal",
                !hasValue && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="size-4" aria-hidden="true" />
              {summary}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={range}
              onSelect={(r) => {
                onCommit({
                  [`${def.key}From`]: r?.from ? formatDay(r.from) : undefined,
                  [`${def.key}To`]: r?.to ? formatDay(r.to) : undefined,
                });
              }}
              numberOfMonths={2}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        {hasValue && (
          <button
            type="button"
            aria-label={`Clear ${def.label}`}
            onClick={() =>
              onCommit({
                [`${def.key}From`]: undefined,
                [`${def.key}To`]: undefined,
              })
            }
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A horizontal, wrapping filter bar. URL-synced by default; pass
 * `values` + `onChange` + `syncToUrl={false}` for a controlled component.
 */
export function FilterBar({
  filters,
  values: controlledValues,
  onChange,
  syncToUrl = true,
  className,
  children,
}: FilterBarProps): React.JSX.Element {
  const url = useUrlFilters(filters);
  const baseId = React.useId();

  const isControlled = !syncToUrl && controlledValues !== undefined;
  const values: FilterValues = isControlled ? controlledValues : url.values;

  const keys = React.useMemo(() => managedKeys(filters), [filters]);

  const activeCount = React.useMemo(() => {
    if (!isControlled) return url.activeCount;
    let count = 0;
    for (const def of filters) {
      if (def.type === "daterange") {
        if (values[`${def.key}From`] || values[`${def.key}To`]) count++;
      } else if (values[def.key]) {
        count++;
      }
    }
    return count;
  }, [isControlled, url.activeCount, filters, values]);

  /** Apply a patch of managed keys to both the URL (if synced) and `onChange`. */
  const applyPatch = React.useCallback(
    (patch: FilterValues) => {
      const next: FilterValues = { ...values };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") delete next[key];
        else next[key] = value;
      }
      if (!isControlled) url.setValues(patch);
      onChange?.(next);
    },
    [values, isControlled, url, onChange],
  );

  const setKey = React.useCallback(
    (key: string, value: string | undefined) => applyPatch({ [key]: value }),
    [applyPatch],
  );

  const handleClear = React.useCallback(() => {
    if (!isControlled) url.clear();
    const cleared: FilterValues = { ...values };
    for (const key of keys) delete cleared[key];
    onChange?.(cleared);
  }, [isControlled, url, values, keys, onChange]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 text-card-foreground",
        className,
      )}
      role="search"
    >
      <SlidersHorizontal
        aria-hidden="true"
        className="mb-2.5 size-4 shrink-0 text-muted-foreground"
      />

      {filters.map((def) => {
        const id = `${baseId}-${def.key}`;
        switch (def.type) {
          case "search":
            return (
              <SearchControl
                key={def.key}
                def={def}
                id={id}
                value={values[def.key]}
                onCommit={(v) => setKey(def.key, v)}
              />
            );
          case "select":
            return (
              <SelectControl
                key={def.key}
                def={def}
                id={id}
                value={values[def.key]}
                onCommit={(v) => setKey(def.key, v)}
              />
            );
          case "date":
            return (
              <DateControl
                key={def.key}
                def={def}
                id={id}
                value={values[def.key]}
                onCommit={(v) => setKey(def.key, v)}
              />
            );
          case "daterange":
            return (
              <DateRangeControl
                key={def.key}
                def={def}
                id={id}
                from={values[`${def.key}From`]}
                to={values[`${def.key}To`]}
                onCommit={applyPatch}
              />
            );
          default:
            return null;
        }
      })}

      {activeCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Clear all filters"
          onClick={handleClear}
          className="mb-0.5 h-9 gap-1.5 text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          Clear
        </Button>
      )}

      {children != null && (
        <div className="ml-auto flex items-end gap-2">{children}</div>
      )}
    </div>
  );
}

export default FilterBar;
