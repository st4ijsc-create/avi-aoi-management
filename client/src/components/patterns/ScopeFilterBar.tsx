/**
 * ScopeFilterBar — the canonical scope/filter bar for analytics & cockpit pages.
 *
 * Across the platform, analytics and cockpit pages each re-implemented the same
 * "scope" row — factory / line / machine / product model / date range — with
 * ad-hoc state that was lost on reload and inconsistent between pages. This
 * primitive centralises that row on top of two Wave-1/Wave-2 building blocks:
 *
 *   - the URL-sync plumbing from {@link useUrlFilters} (FilterBar.tsx), so scope
 *     is shareable, bookmarkable and survives navigation; and
 *   - the preset entity selects from EntityPicker (FactorySelect / LineSelect /
 *     MachineSelect / ProductModelSelect), so option loading stays in one place.
 *
 * URL contract (query params, all optional):
 *   factoryId · lineId · machineId · productModelId  → integer ids
 *   dateFrom · dateTo                                → `YYYY-MM-DD`
 * Empty / unset values are removed from the URL entirely; unrelated params
 * (tab=, id=, …) are always preserved on write (handled by useUrlFilters).
 *
 * Number ↔ URL: EntityPicker values are numbers, the URL is strings. On write we
 * `String(id)` (or remove the param when null). On read we `Number(param)` and
 * guard `NaN` (a malformed param is treated as unset, never surfaced as `NaN`).
 *
 * @example Analytics page — show only line / machine / date range, read scope:
 * ```tsx
 * import { ScopeFilterBar, useScope } from "@/components/patterns/ScopeFilterBar";
 *
 * function DefectAnalytics() {
 *   const { scope } = useScope(["line", "machine", "dateRange"]);
 *   const { data } = trpc.analytics.defects.useQuery({
 *     lineId: scope.lineId,
 *     machineId: scope.machineId,
 *     from: scope.dateFrom,
 *     to: scope.dateTo,
 *   });
 *   return (
 *     <>
 *       <ScopeFilterBar show={["line", "machine", "dateRange"]}>
 *         <Button size="sm" onClick={exportCsv}>Export</Button>
 *       </ScopeFilterBar>
 *       <DefectChart rows={data} />
 *     </>
 *   );
 * }
 * ```
 */
import * as React from "react";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FactorySelect,
  LineSelect,
  MachineSelect,
  ProductModelSelect,
  type EntitySelectProps,
} from "@/components/patterns/EntityPicker";
import { useUrlFilters, type FilterDef, type FilterValues } from "@/components/FilterBar";
// doc 64 IA-10 S0.2 — trục phạm vi bền (shell). URL THẮNG; trục lấp chỗ trống
// (điều hướng không mất scope); setScope write-through cả hai.
import { useAssetScope } from "@/contexts/AssetScopeContext";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScopeValues {
  factoryId?: number;
  lineId?: number;
  machineId?: number;
  productModelId?: number;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
}

/** Which scope controls the bar renders (also the fixed render order). */
export type ScopeControl =
  | "factory"
  | "line"
  | "machine"
  | "productModel"
  | "dateRange";

export interface ScopeFilterBarProps {
  /**
   * Which scope controls to show, in the order given (the bar renders exactly
   * this subset). Defaults to all five in canonical order.
   */
  show?: ScopeControl[];
  /** Controlled value. Combine with `onChange` + `syncToUrl={false}`. */
  value?: ScopeValues;
  onChange?: (scope: ScopeValues) => void;
  /** Persist scope in the URL query string (default `true`). */
  syncToUrl?: boolean;
  className?: string;
  /** Extra right-side controls (e.g. an export button). */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SHOW: ScopeControl[] = [
  "factory",
  "line",
  "machine",
  "productModel",
  "dateRange",
];

/** English default labels — i18n-safe (no hardcoded VI/ZH). */
const LABELS = {
  factory: "Factory",
  line: "Line",
  machine: "Machine",
  productModel: "Product",
  dateRange: "Date range",
  clear: "Clear",
} as const;

/** The number-valued scope keys and their matching URL params (same name). */
const ID_KEYS = [
  "factoryId",
  "lineId",
  "machineId",
  "productModelId",
] as const;
type IdKey = (typeof ID_KEYS)[number];

/** Map each entity control to its scope/URL id key. */
const CONTROL_KEY: Record<
  Exclude<ScopeControl, "dateRange">,
  IdKey
> = {
  factory: "factoryId",
  line: "lineId",
  machine: "machineId",
  productModel: "productModelId",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a Date as a timezone-safe `YYYY-MM-DD` (local calendar day). */
function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a local-midnight Date (undefined if malformed). */
function parseDay(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return undefined;
  const [y, m, day] = parts;
  return new Date(y, m - 1, day);
}

/** Parse a URL string into a positive-guarded number id (undefined if bad). */
function toId(s: string | undefined): number | undefined {
  if (s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

/** Build the useUrlFilters defs for a given `show` subset. */
function buildDefs(show: ScopeControl[]): FilterDef[] {
  return show.map<FilterDef>((kind) => {
    if (kind === "dateRange") {
      // daterange stores `${key}From` / `${key}To` → dateFrom / dateTo.
      return { key: "date", type: "daterange", label: LABELS.dateRange };
    }
    // Options are unused (we render EntityPicker, not FilterBar's <Select>),
    // but the def type/key drives useUrlFilters' managed-key set + activeCount.
    return {
      key: CONTROL_KEY[kind],
      type: "select",
      label: LABELS[kind],
      options: [],
    };
  });
}

/** URL string map → typed ScopeValues (only for the controls in `show`). */
function toScope(values: FilterValues, show: ScopeControl[]): ScopeValues {
  const scope: ScopeValues = {};
  for (const kind of show) {
    if (kind === "dateRange") {
      if (values.dateFrom) scope.dateFrom = values.dateFrom;
      if (values.dateTo) scope.dateTo = values.dateTo;
    } else {
      const key = CONTROL_KEY[kind];
      const id = toId(values[key]);
      if (id !== undefined) scope[key] = id;
    }
  }
  return scope;
}

/** A patch of ScopeValues → URL string patch (undefined removes the param). */
function toFilterPatch(patch: Partial<ScopeValues>): FilterValues {
  const out: FilterValues = {};
  for (const key of ID_KEYS) {
    if (key in patch) {
      const v = patch[key];
      out[key] = v === undefined || v === null ? undefined : String(v);
    }
  }
  if ("dateFrom" in patch) out.dateFrom = patch.dateFrom || undefined;
  if ("dateTo" in patch) out.dateTo = patch.dateTo || undefined;
  return out;
}

/** Apply a ScopeValues patch onto a scope, deleting keys set to undefined. */
function applyScope(
  base: ScopeValues,
  patch: Partial<ScopeValues>,
): ScopeValues {
  const next: ScopeValues = { ...base };
  for (const [k, v] of Object.entries(patch) as [
    keyof ScopeValues,
    ScopeValues[keyof ScopeValues],
  ][]) {
    if (v === undefined || v === null || v === "") delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

function hasAnyValue(scope: ScopeValues): boolean {
  return (
    scope.factoryId !== undefined ||
    scope.lineId !== undefined ||
    scope.machineId !== undefined ||
    scope.productModelId !== undefined ||
    scope.dateFrom !== undefined ||
    scope.dateTo !== undefined
  );
}

/** Stable dependency key for a `show` array (identity-independent). */
function showKey(show: ScopeControl[]): string {
  return show.join(",");
}

// ---------------------------------------------------------------------------
// useScope — read/write the active scope without rendering the bar
// ---------------------------------------------------------------------------

/**
 * Read the active scope (from the URL) and mutate it, without rendering the bar.
 * Pages that only consume scope (charts, queries) use this; the bar itself is
 * rendered elsewhere on the page (or on another page sharing the same URL).
 */
export function useScope(show?: ScopeControl[]): {
  scope: ScopeValues;
  setScope: (patch: Partial<ScopeValues>) => void;
  clear: () => void;
} {
  const controls = show ?? DEFAULT_SHOW;
  const key = showKey(controls);
  const defs = React.useMemo(() => buildDefs(controls), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = useUrlFilters(defs);
  // doc 64 IA-10 S0.2 — trục ISA-95 bền ở shell: URL param THẮNG (link chia sẻ
  // được); khi URL không có, trục lấp factoryId/lineId/machineId để scope SỐNG
  // qua điều hướng. Không provider → axis rỗng → hành vi y hệt cũ.
  const assetAxis = useAssetScope();

  const scope = React.useMemo(() => {
    const merged = toScope(url.values, controls);
    if (controls.includes("factory") && merged.factoryId === undefined && assetAxis.axis.factoryId !== undefined) {
      merged.factoryId = assetAxis.axis.factoryId;
    }
    if (controls.includes("line") && merged.lineId === undefined && assetAxis.axis.lineId !== undefined) {
      merged.lineId = assetAxis.axis.lineId;
    }
    if (controls.includes("machine") && merged.machineId === undefined && assetAxis.axis.machineId !== undefined) {
      merged.machineId = assetAxis.axis.machineId;
    }
    return merged;
  }, [url.values, key, assetAxis.axis]); // eslint-disable-line react-hooks/exhaustive-deps

  const setScope = React.useCallback(
    (patch: Partial<ScopeValues>) => {
      url.setValues(toFilterPatch(patch));
      // Write-through trục cho 3 cấp tài sản (đổi trang vẫn giữ lựa chọn).
      const axisPatch: { factoryId?: number; lineId?: number; machineId?: number } = {};
      if ("factoryId" in patch) axisPatch.factoryId = patch.factoryId ?? undefined;
      if ("lineId" in patch) axisPatch.lineId = patch.lineId ?? undefined;
      if ("machineId" in patch) axisPatch.machineId = patch.machineId ?? undefined;
      if (Object.keys(axisPatch).length > 0) assetAxis.setAxis(axisPatch);
    },
    [url, assetAxis],
  );

  return { scope, setScope, clear: url.clear };
}

// ---------------------------------------------------------------------------
// Internal control primitives
// ---------------------------------------------------------------------------

/** Small stacked caption that labels a control accessibly. */
function ControlLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </Label>
  );
}

/** One entity (factory/line/machine/product) select with a label. */
function EntityField({
  id,
  label,
  Select,
  value,
  onChange,
}: {
  id: string;
  label: string;
  Select: (p: EntitySelectProps) => React.JSX.Element;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{label}</ControlLabel>
      <Select
        id={id}
        aria-label={label}
        placeholder={label}
        clearable
        value={value ?? null}
        onChange={(v) => onChange(v === null ? undefined : toId(String(v)))}
        className="w-44"
      />
    </div>
  );
}

/** Date-range popover writing `dateFrom` / `dateTo`. */
function DateRangeField({
  id,
  from,
  to,
  onChange,
}: {
  id: string;
  from: string | undefined;
  to: string | undefined;
  onChange: (patch: Pick<ScopeValues, "dateFrom" | "dateTo">) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const range: DateRange | undefined = React.useMemo(() => {
    const f = parseDay(from);
    const t = parseDay(to);
    if (!f && !t) return undefined;
    return { from: f, to: t };
  }, [from, to]);

  const hasValue = Boolean(from || to);
  const summary = hasValue ? `${from ?? "…"} → ${to ?? "…"}` : LABELS.dateRange;

  return (
    <div className="flex flex-col gap-1">
      <ControlLabel htmlFor={id}>{LABELS.dateRange}</ControlLabel>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              aria-label={LABELS.dateRange}
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
              onSelect={(r) =>
                onChange({
                  dateFrom: r?.from ? formatDay(r.from) : undefined,
                  dateTo: r?.to ? formatDay(r.to) : undefined,
                })
              }
              numberOfMonths={2}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        {hasValue && (
          <button
            type="button"
            aria-label={`${LABELS.clear} ${LABELS.dateRange}`}
            onClick={() => onChange({ dateFrom: undefined, dateTo: undefined })}
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScopeFilterBar
// ---------------------------------------------------------------------------

/**
 * A horizontal, wrapping scope bar (factory / line / machine / product / date
 * range). URL-synced by default; pass `value` + `onChange` + `syncToUrl={false}`
 * for a controlled component. `onChange` fires on every change in both modes.
 */
export function ScopeFilterBar({
  show = DEFAULT_SHOW,
  value: controlledValue,
  onChange,
  syncToUrl = true,
  className,
  children,
}: ScopeFilterBarProps): React.JSX.Element {
  const baseId = React.useId();
  const key = showKey(show);
  const defs = React.useMemo(() => buildDefs(show), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = useUrlFilters(defs);

  const isControlled = !syncToUrl && controlledValue !== undefined;

  const scope: ScopeValues = React.useMemo(
    () => (isControlled ? controlledValue : toScope(url.values, show)),
    [isControlled, controlledValue, url.values, key], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const apply = React.useCallback(
    (patch: Partial<ScopeValues>) => {
      if (!isControlled) url.setValues(toFilterPatch(patch));
      onChange?.(applyScope(scope, patch));
    },
    [isControlled, url, onChange, scope],
  );

  const handleClear = React.useCallback(() => {
    if (!isControlled) url.clear();
    onChange?.({});
  }, [isControlled, url, onChange]);

  const active = hasAnyValue(scope);

  return (
    <div
      role="search"
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 text-card-foreground",
        className,
      )}
    >
      {show.map((kind) => {
        const id = `${baseId}-${kind}`;
        switch (kind) {
          case "factory":
            return (
              <EntityField
                key={kind}
                id={id}
                label={LABELS.factory}
                Select={FactorySelect}
                value={scope.factoryId}
                onChange={(v) => apply({ factoryId: v })}
              />
            );
          case "line":
            return (
              <EntityField
                key={kind}
                id={id}
                label={LABELS.line}
                Select={LineSelect}
                value={scope.lineId}
                onChange={(v) => apply({ lineId: v })}
              />
            );
          case "machine":
            return (
              <EntityField
                key={kind}
                id={id}
                label={LABELS.machine}
                Select={MachineSelect}
                value={scope.machineId}
                onChange={(v) => apply({ machineId: v })}
              />
            );
          case "productModel":
            return (
              <EntityField
                key={kind}
                id={id}
                label={LABELS.productModel}
                Select={ProductModelSelect}
                value={scope.productModelId}
                onChange={(v) => apply({ productModelId: v })}
              />
            );
          case "dateRange":
            return (
              <DateRangeField
                key={kind}
                id={id}
                from={scope.dateFrom}
                to={scope.dateTo}
                onChange={(patch) => apply(patch)}
              />
            );
          default:
            return null;
        }
      })}

      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${LABELS.clear} scope`}
          onClick={handleClear}
          className="mb-0.5 h-9 gap-1.5 text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          {LABELS.clear}
        </Button>
      )}

      {children != null && (
        <div className="ml-auto flex items-end gap-2">{children}</div>
      )}
    </div>
  );
}

export default ScopeFilterBar;
