import * as React from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import {
  Sigma,
  FunctionSquare,
  GitBranch,
  Braces,
  ScrollText,
  Calculator,
  Info,
} from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, EmptyState } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import {
  MetricDefinitionBadge,
} from "@/components/MetricDefinitionBadge";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type MetricSummary = RouterOutputs["semantics"]["list"][number];
type MetricDefinition = RouterOutputs["semantics"]["get"];

/** Translated label for a metric scope, falling back to the raw key. */
function scopeLabel(t: (k: string, d: string) => string, scope: string): string {
  return t(`metricCatalog.scopeLabel.${scope}`, scope);
}

/**
 * Format a MetricResult value HONESTLY per its unit convention (registry notes):
 * ratio metrics are normalized fractions 0..1 → percent; DPMO is a natural
 * per-million count; Throughput is a natural unit count. Never fabricates a
 * number — null (inputs absent in the window) surfaces as an explicit message.
 */
function formatMetricValue(
  metric: string,
  value: number | null,
  t: (k: string, d: string) => string,
): string {
  if (value == null) return t("metricCatalog.preview.noValue", "No data in the selected window");
  const m = metric.toUpperCase();
  if (m === "DPMO") return `${Math.round(value).toLocaleString()} DPMO`;
  if (m === "THROUGHPUT") return value.toLocaleString();
  // Ratio metrics (OEE / A / P / Q / FPY) are fractions 0..1 — show as percent.
  return `${(value * 100).toFixed(2)}%`;
}

// ── Live compute preview (factory scope only — the one scope computable with no
//    scopeId). Any machine/line-grain metric needs a specific id and is surfaced
//    on dashboards instead, so it is guarded, never fabricated. ────────────────
function FactoryComputePreview({ metric }: { metric: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [win, setWin] = React.useState<{ from: Date; to: Date } | null>(null);

  const q = trpc.semantics.compute.useQuery(
    {
      metric,
      scope: "factory",
      from: win?.from ?? new Date(0),
      to: win?.to ?? new Date(0),
    },
    { enabled: win != null, retry: false, refetchOnWindowFocus: false },
  );

  const run = () => {
    const now = new Date();
    setWin({ from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now });
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Calculator className="size-4 text-primary" aria-hidden="true" />
          {t("metricCatalog.preview.title", "Live preview")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("metricCatalog.preview.factoryHint", "Factory · last 30 days")}
        </span>
      </div>

      {win == null ? (
        <Button type="button" variant="outline" size="sm" onClick={run} className="gap-1.5">
          <Calculator className="size-4" aria-hidden="true" />
          {t("metricCatalog.preview.run", "Run live preview")}
        </Button>
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("metricCatalog.preview.computing", "Computing…")}
        </p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          {t("metricCatalog.preview.error", "Could not compute a live value")}
          {q.error?.message ? ` — ${q.error.message}` : ""}
        </p>
      ) : q.data ? (
        <div className="space-y-1.5">
          <div className="text-2xl font-semibold tabular-nums">
            {formatMetricValue(q.data.metric, q.data.value, t)}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("metricCatalog.preview.window", "Window")}:{" "}
            {new Date(q.data.window.from).toLocaleDateString()} –{" "}
            {new Date(q.data.window.to).toLocaleDateString()}
          </p>
          {q.data.parts && Object.keys(q.data.parts).length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {Object.entries(q.data.parts).map(([k, v]) => (
                <span key={k} className="tabular-nums">
                  <span className="font-medium text-foreground/70">{k}</span>:{" "}
                  {v == null ? "—" : v.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          <p className="pt-0.5 font-mono text-[11px] text-muted-foreground">
            {q.data.definition_version}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Canonical implementation pointer(s) — a single key or a per-scope mapping. */
function ImplementationPointers({
  t,
  implementation,
}: {
  t: (k: string, d: string) => string;
  implementation: MetricDefinition["implementation"];
}): React.JSX.Element {
  const entries: Array<[string | null, string]> =
    typeof implementation === "string"
      ? [[null, implementation]]
      : Object.entries(implementation);
  return (
    <div className="space-y-1.5">
      {entries.map(([scope, fn]) => (
        <div key={scope ?? "_"} className="flex flex-wrap items-center gap-2">
          {scope && (
            <Badge variant="outline" className="text-xs">
              {scopeLabel(t, scope)}
            </Badge>
          )}
          <code className="font-mono text-xs break-all text-muted-foreground">{fn}</code>
        </div>
      ))}
    </div>
  );
}

/** Detail body — renders instantly from the list row, then enriches with `get`. */
function MetricDetail({ summary }: { summary: MetricSummary }): React.JSX.Element {
  const { t } = useTranslation();
  const def = trpc.semantics.get.useQuery(
    { metric: summary.metric },
    { staleTime: 5 * 60_000, retry: false },
  );
  const inputs = summary.inputs ?? [];
  const supportsFactory = summary.scope.includes("factory");
  const definition = def.data as MetricDefinition | undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <Sigma className="size-5 text-primary" aria-hidden="true" />
          {summary.metric}
          <MetricDefinitionBadge
            metricKey={summary.metric}
            version={summary.version}
            showCatalogLink={false}
          />
        </DialogTitle>
        <DialogDescription>
          {t(
            "metricCatalog.detail.subtitle",
            "Governed definition from the semantic layer — computed through its canonical implementation.",
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* Formula */}
        <section className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <FunctionSquare className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("metricCatalog.detail.formula", "Formula")}
          </h4>
          <code className="block rounded-md bg-muted px-3 py-2 font-mono text-sm break-words whitespace-pre-wrap">
            {summary.formula}
          </code>
        </section>

        {/* Scope */}
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">{t("metricCatalog.detail.scope", "Scope")}</h4>
          <div className="flex flex-wrap gap-1.5">
            {summary.scope.map((s) => (
              <Badge key={s} variant="secondary">
                {scopeLabel(t, s)}
              </Badge>
            ))}
          </div>
        </section>

        {/* Lineage / inputs */}
        <section className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("metricCatalog.detail.lineage", "Lineage / inputs")}
          </h4>
          {inputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("metricCatalog.detail.noInputs", "No declared inputs")}
            </p>
          ) : (
            <ul className="space-y-2">
              {inputs.map((inp, i) => (
                <li key={i} className="rounded-md border p-2.5">
                  <p className="font-mono text-xs font-medium">{inp.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{inp.source}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Canonical implementation (from get) */}
        <section className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <Braces className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("metricCatalog.detail.implementation", "Canonical implementation")}
          </h4>
          {def.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t("metricCatalog.badge.loading", "Loading definition…")}
            </p>
          ) : definition ? (
            <ImplementationPointers t={t} implementation={definition.implementation} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("metricCatalog.badge.error", "Definition unavailable")}
            </p>
          )}
        </section>

        {/* Notes (from get) */}
        {definition?.notes && (
          <section className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-sm font-medium">
              <ScrollText className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("metricCatalog.detail.notes", "Notes")}
            </h4>
            <p className="text-sm leading-relaxed text-muted-foreground">{definition.notes}</p>
          </section>
        )}

        <Separator />

        {/* Live compute preview — guarded to factory-computable metrics only */}
        {supportsFactory ? (
          <FactoryComputePreview metric={summary.metric} />
        ) : (
          <p className="flex items-start gap-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(
              "metricCatalog.preview.needsScope",
              "A live value needs a specific machine or line, so it is shown on dashboards rather than here.",
            )}
          </p>
        )}
      </div>
    </>
  );
}

export function MetricCatalogContent(): React.JSX.Element {
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<MetricSummary | null>(null);

  const list = trpc.semantics.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  });

  const metrics = list.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Sigma className="h-6 w-6 text-primary" />}
        title={t("metricCatalog.title", "Metric catalog")}
        description={t(
          "metricCatalog.subtitle",
          "Governed KPI definitions from the semantic layer — one definition, one truth. Each metric is versioned and computed through its canonical implementation.",
        )}
      />

      <AsyncBoundary
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        isEmpty={metrics.length === 0}
        onRetry={() => list.refetch()}
        preset="table"
        errorTitle={t("metricCatalog.loadError", "Could not load the metric catalog")}
        retryLabel={t("common.retry", "Thử lại")}
        emptyState={
          <EmptyState
            variant="no-config"
            title={t("metricCatalog.empty.title", "No governed metrics")}
            description={t(
              "metricCatalog.empty.desc",
              "The semantic layer has no metric definitions yet. Add versioned definitions under contracts/metrics.",
            )}
          />
        }
      >
        <DataTable<MetricSummary>
          data={metrics}
          getRowId={(m) => m.metric}
          onRowClick={(m) => setSelected(m)}
          searchable
          paginated={false}
          searchPlaceholder={t("metricCatalog.searchPlaceholder", "Search metrics…")}
          initialSort={{ columnId: "metric", dir: "asc" }}
          columns={[
            {
              id: "metric",
              header: t("metricCatalog.col.metric", "Metric"),
              sortValue: (m) => m.metric,
              filterValue: (m) => `${m.metric} ${m.definition_version}`,
              cell: (m) => (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{m.metric}</span>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {m.definition_version}
                  </Badge>
                </span>
              ),
            },
            {
              id: "scope",
              header: t("metricCatalog.col.scope", "Scope"),
              filterValue: (m) => m.scope.join(" "),
              cell: (m) => (
                <span className="flex flex-wrap gap-1">
                  {m.scope.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[11px]">
                      {scopeLabel(t, s)}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              id: "formula",
              header: t("metricCatalog.col.formula", "Formula"),
              filterValue: (m) => m.formula,
              cell: (m) => (
                <code className="font-mono text-xs text-muted-foreground">{m.formula}</code>
              ),
            },
            {
              id: "inputs",
              header: t("metricCatalog.col.inputs", "Inputs"),
              align: "right",
              width: "90px",
              sortValue: (m) => m.inputs?.length ?? 0,
              cell: (m) => (
                <span className="tabular-nums text-muted-foreground">
                  {m.inputs?.length ?? 0}
                </span>
              ),
            },
          ]}
        />
      </AsyncBoundary>

      <Dialog
        open={selected != null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && <MetricDetail summary={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MetricCatalog(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("metricCatalog.title", "Metric catalog")}>
      <PageContainer>
        <MetricCatalogContent />
      </PageContainer>
    </DashboardLayout>
  );
}
