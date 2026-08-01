import * as React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Sigma, BookOpen } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * MetricDefinitionBadge — a compact, reusable "OEE@v1" chip that annotates any
 * KPI with the GOVERNED definition it was computed from (SYNAPSE Tầng 2 semantic
 * layer, doc 46 FE-W2). Clicking the chip opens a popover with the canonical
 * formula + scope + notes fetched LAZILY from `trpc.semantics.get`, plus a link
 * to the Metric Catalog. Drop it next to a dashboard number so provenance is one
 * click away — "one definition, one truth".
 *
 * @example
 * ```tsx
 * <MetricDefinitionBadge metricKey="OEE" version="v1" />
 * <MetricDefinitionBadge metricKey="FPY" />  // version resolved from the registry
 * ```
 */

/** Canonical route for the Metric Catalog page (wired into the router separately). */
export const METRIC_CATALOG_ROUTE = "/metric-catalog";

type MetricDefinition = inferRouterOutputs<AppRouter>["semantics"]["get"];

export interface MetricDefinitionBadgeProps {
  /** Metric name as known to the semantic layer (case-insensitive), e.g. "OEE". */
  metricKey: string;
  /**
   * Version — `"v1"` or `1`. Optional: when omitted the chip resolves it from the
   * governed definition once the popover is opened.
   */
  version?: string | number;
  /** Render the "View in metric catalog" link inside the popover. Default true. */
  showCatalogLink?: boolean;
  className?: string;
}

/** `1` | `"1"` | `"v1"` → `"v1"`; nullish / empty → null. */
function normalizeVersion(v: string | number | undefined): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? `v${v}` : null;
  const s = v.trim();
  if (!s) return null;
  return /^v/i.test(s) ? s.toLowerCase() : `v${s}`;
}

/** Translated label for a metric scope, falling back to the raw key. */
function scopeLabel(t: (k: string, d: string) => string, scope: string): string {
  return t(`metricCatalog.scopeLabel.${scope}`, scope);
}

export function MetricDefinitionBadge({
  metricKey,
  version,
  showCatalogLink = true,
  className,
}: MetricDefinitionBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  // Lazy — only touch the semantic layer once the popover is actually opened.
  const def = trpc.semantics.get.useQuery(
    { metric: metricKey },
    { enabled: open, staleTime: 5 * 60_000, retry: false },
  );

  const normalized = normalizeVersion(version);
  const definition = def.data as MetricDefinition | undefined;
  const label =
    normalized != null
      ? `${metricKey}@${normalized}`
      : definition
        ? `${definition.metric}@v${definition.version}`
        : metricKey;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Never let the chip bubble up into a parent row/card click handler.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5",
            "font-mono text-xs font-medium text-primary whitespace-nowrap",
            "transition-colors hover:bg-primary/20",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={t("metricCatalog.badge.aria", {
            label,
            defaultValue: "Governed definition {{label}}",
          })}
        >
          <Sigma className="size-3 shrink-0" aria-hidden="true" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-primary">{label}</span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("metricCatalog.badge.governed", "Governed")}
          </span>
        </div>

        {def.isLoading && (
          <p className="text-xs text-muted-foreground">
            {t("metricCatalog.badge.loading", "Loading definition…")}
          </p>
        )}
        {def.isError && (
          <p className="text-xs text-destructive">
            {t("metricCatalog.badge.error", "Definition unavailable")}
          </p>
        )}

        {definition && (
          <div className="space-y-2">
            <div>
              <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                {t("metricCatalog.detail.formula", "Formula")}
              </p>
              <code className="block rounded bg-muted px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap">
                {definition.formula}
              </code>
            </div>
            <div className="flex flex-wrap gap-1">
              {definition.scope.map((s) => (
                <span
                  key={s}
                  className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {scopeLabel(t, s)}
                </span>
              ))}
            </div>
            {definition.notes && (
              <p className="line-clamp-3 text-xs text-muted-foreground">{definition.notes}</p>
            )}
          </div>
        )}

        {showCatalogLink && (
          <Link
            href={METRIC_CATALOG_ROUTE}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            {t("metricCatalog.badge.viewInCatalog", "View in metric catalog")}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default MetricDefinitionBadge;
