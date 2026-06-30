/**
 * Federation Dashboard (doc 13 / F2) — cross-site control-tower read-model.
 *
 * Consumes ONLY federation.* read procedures (siteRollups, aggregateSummary,
 * siteKpiHistory, syncLog, status). The core NEVER controls a site: the only
 * action that touches a site is a DEEP-LINK ("Open site ↗") to the site's own
 * baseUrl in a new tab. No fabricated numbers — missing metrics render as N/A,
 * staleness is badged honestly (ok/stale/down) from the backend's freshness,
 * and with <2 reporting sites we show a "needs ≥2 sites" note instead of a
 * misleading ranking.
 *
 * Built role-agnostic: route-level RouteGuard (admin / MOD_FEDERATION) is wired
 * separately — see the agent report.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  Globe,
  Network,
  TrendingUp,
  Activity,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── helpers ────────────────────────────────────────────────────────────────

/** Honest N/A for any metric the site did not report (null/undefined). */
function fmt(v: number | null | undefined, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "N/A";
  return `${v}${suffix}`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "N/A";
  return v.toLocaleString();
}

/** Human "X min/hour ago" from a seconds age (honest staleness). */
function ageLabel(
  ageSec: number | null,
  t: (k: string, f: string, o?: Record<string, unknown>) => string,
): string {
  if (ageSec == null) return t("federation.neverSynced", "Never synced");
  if (ageSec < 90) return t("federation.ageSeconds", "{{n}}s ago", { n: ageSec });
  const min = Math.round(ageSec / 60);
  if (min < 90) return t("federation.ageMinutes", "{{n}} min ago", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return t("federation.ageHours", "{{n}}h ago", { n: hr });
  return t("federation.ageDays", "{{n}}d ago", { n: Math.round(hr / 24) });
}

function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

type FreshnessState = "ok" | "stale" | "down";

function FreshnessBadge({
  state,
  ageSec,
}: {
  state: FreshnessState;
  ageSec: number | null;
}) {
  const { t } = useTranslation();
  const label = ageLabel(ageSec, t);
  if (state === "ok") {
    return (
      <Badge className="border-transparent bg-success/15 text-success">
        <CheckCircle2 className="h-3 w-3" />
        {t("federation.fresh.ok", "OK")} · {label}
      </Badge>
    );
  }
  if (state === "stale") {
    return (
      <Badge className="border-transparent bg-warning/15 text-warning">
        <Clock className="h-3 w-3" />
        {t("federation.fresh.stale", "Stale")} · {label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      <CircleSlash className="h-3 w-3" />
      {t("federation.fresh.down", "Down")} · {label}
    </Badge>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function FederationDashboard() {
  const { t } = useTranslation();
  const [corporateFilter, setCorporateFilter] = useState<string>("__all__");

  const scopeInput =
    corporateFilter === "__all__" ? undefined : { corporateCode: corporateFilter };

  const rollupsQ = trpc.federation.siteRollups.useQuery(scopeInput);
  const summaryQ = trpc.federation.aggregateSummary.useQuery(scopeInput);
  // siteRollups intentionally omits baseUrl; the deep-link target comes from the
  // F0 sites registry (admin-scoped, same gate as this page). Consume-only.
  const sitesListQ = trpc.sites.list.useQuery();
  const statusQ = trpc.federation.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const syncLogQ = trpc.federation.syncLog.useQuery({ limit: 25 });

  const rollups = rollupsQ.data ?? [];
  const summary = summaryQ.data;

  // siteId → baseUrl for the "Open site ↗" deep-link.
  const baseUrlBySite = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sitesListQ.data ?? []) m.set(s.id, s.baseUrl);
    return m;
  }, [sitesListQ.data]);

  // Corporate codes for the scope filter (derived only from real site rows).
  const corporateOptions = useMemo(() => {
    const all = rollupsQ.data ?? [];
    const set = new Set<string>();
    for (const r of all) if (r.site.corporateCode) set.add(r.site.corporateCode);
    return Array.from(set).sort();
  }, [rollupsQ.data]);

  // Default the trend to the first site that actually has data.
  const trendSiteId = useMemo(() => {
    const withData = rollups.find((r) => r.kpi && (r.kpi.totalInspections ?? 0) > 0);
    return (withData ?? rollups[0])?.site.id;
  }, [rollups]);
  const [selectedTrendSite, setSelectedTrendSite] = useState<number | null>(null);
  const activeTrendSite = selectedTrendSite ?? trendSiteId ?? null;

  const historyQ = trpc.federation.siteKpiHistory.useQuery(
    { siteId: activeTrendSite ?? 0, days: 30 },
    { enabled: activeTrendSite != null },
  );
  const history = historyQ.data ?? [];

  const reporting = summary?.sitesReporting ?? 0;
  const sitesWithData = summary?.sitesWithData ?? 0;
  const downCount = rollups.filter((r) => r.freshness.state === "down").length;
  const staleCount = rollups.filter((r) => r.freshness.state === "stale").length;

  const status = statusQ.data;

  if (rollupsQ.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">
            {t("federation.loading", "Loading federation roll-up…")}
          </span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              {t("federation.dashboard", "Federation Dashboard")}
            </h1>
            <p className="text-muted-foreground">
              {t(
                "federation.dashboardDescription",
                "Read-only cross-site roll-up. The core aggregates each site's KPIs — it never controls a site.",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {corporateOptions.length > 0 && (
              <Select value={corporateFilter} onValueChange={setCorporateFilter}>
                <SelectTrigger className="w-[200px]">
                  <Network className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("federation.allCorporates", "All corporates")}
                  </SelectItem>
                  {corporateOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void rollupsQ.refetch();
                void summaryQ.refetch();
                void statusQ.refetch();
                void syncLogQ.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("federation.refresh", "Refresh")}
            </Button>
          </div>
        </div>

        {/* Empty state — no sites enrolled */}
        {rollups.length === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{t("federation.noSitesTitle", "No sites enrolled")}</AlertTitle>
            <AlertDescription>
              {t(
                "federation.noSitesBody",
                "Enroll at least one site (the core can self-enroll as a local site) for the aggregator to roll up KPIs.",
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Aggregate header cards — only from real rollups */}
        {rollups.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="glass-card">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.totalSites", "Sites")}
                  </span>
                  <span className="text-2xl font-bold">{summary?.sitesTotal ?? rollups.length}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card bg-success/10">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.reporting", "Reporting")}
                  </span>
                  <span className="text-2xl font-bold text-success">{reporting}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card bg-warning/10">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.stale", "Stale")}
                  </span>
                  <span className="text-2xl font-bold text-warning">{staleCount}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.down", "Down")}
                  </span>
                  <span className="text-2xl font-bold text-muted-foreground">{downCount}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card bg-primary/10">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.weightedYield", "Yield (units-weighted)")}
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {fmt(summary?.overallYieldRate ?? null, "%")}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-4">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {t("federation.totalThroughput", "Total throughput")}
                  </span>
                  <span className="text-2xl font-bold">
                    {fmtInt(summary?.totals.totalInspections ?? null)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Honest ≥2-sites note (no fabricated ranking with 1 site) */}
        {rollups.length > 0 && summary && !summary.crossSiteComparisonReady && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {t("federation.comparisonNotReadyTitle", "Cross-site comparison not available")}
            </AlertTitle>
            <AlertDescription>
              {t(
                "federation.comparisonNotReady",
                "Cần ≥2 site báo cáo để so sánh. (Cross-site comparison/ranking needs at least 2 reporting sites — currently {{n}}.)",
                { n: sitesWithData },
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Per-site KPI grid */}
        {rollups.length > 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                {t("federation.siteGrid", "Per-site KPIs")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("federation.site", "Site")}</TableHead>
                    <TableHead>{t("federation.region", "Region")}</TableHead>
                    <TableHead className="text-right">{t("federation.yield", "Yield")}</TableHead>
                    <TableHead className="text-right">{t("federation.oee", "OEE")}</TableHead>
                    <TableHead className="text-right">
                      {t("federation.throughput", "Throughput")}
                    </TableHead>
                    <TableHead className="text-right">{t("federation.ngRate", "NG")}</TableHead>
                    <TableHead>{t("federation.freshness", "Freshness")}</TableHead>
                    <TableHead>{t("federation.lastSync", "Last sync")}</TableHead>
                    <TableHead className="text-right">{t("federation.action", "Action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollups.map((r) => (
                    <TableRow key={r.site.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium flex items-center gap-2">
                            {r.site.name}
                            {r.site.isLocal && (
                              <Badge variant="outline" className="text-[10px]">
                                {t("federation.local", "local")}
                              </Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {r.site.code}
                            {r.site.corporateCode ? ` · ${r.site.corporateCode}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.site.region || "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(r.kpi?.yieldRate ?? null, "%")}
                      </TableCell>
                      <TableCell className="text-right">{fmt(r.kpi?.oee ?? null, "%")}</TableCell>
                      <TableCell className="text-right">
                        {fmtInt(r.kpi?.throughput ?? null)}
                      </TableCell>
                      <TableCell className="text-right">{fmt(r.kpi?.ngRate ?? null, "%")}</TableCell>
                      <TableCell>
                        <FreshnessBadge
                          state={r.freshness.state}
                          ageSec={r.freshness.ageSec}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtTime(r.site.lastSyncAt)}
                        {r.site.lastError && (
                          <span
                            className="block text-destructive truncate max-w-[180px]"
                            title={r.site.lastError}
                          >
                            {r.site.lastError}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {baseUrlBySite.get(r.site.id) ? (
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            title={t("federation.openSiteHint", "Open this site's own app (deep-link)")}
                          >
                            <a
                              href={baseUrlBySite.get(r.site.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("federation.openSite", "Open site")}
                              <ExternalLink className="h-3.5 w-3.5 ml-1" />
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* KPI trend + sync/health */}
        {rollups.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Trend (siteKpiHistory) */}
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    {t("federation.kpiTrend", "Site KPI trend (daily)")}
                  </CardTitle>
                  <Select
                    value={activeTrendSite != null ? String(activeTrendSite) : ""}
                    onValueChange={(v) => setSelectedTrendSite(Number(v))}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder={t("federation.selectSite", "Select site")} />
                    </SelectTrigger>
                    <SelectContent>
                      {rollups.map((r) => (
                        <SelectItem key={r.site.id} value={String(r.site.id)}>
                          {r.site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {historyQ.isLoading ? (
                  <div className="flex items-center justify-center h-[260px] text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    {t("federation.loadingTrend", "Loading trend…")}
                  </div>
                ) : history.length === 0 ? (
                  <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
                    {t("federation.noHistory", "No daily history yet for this site.")}
                  </div>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={history.map((h) => ({
                          day: fmtTime(h.bucketStart).split(",")[0] || "—",
                          yield: h.yieldRate,
                          oee: h.oee,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="day" className="text-xs" />
                        <YAxis domain={[0, 100]} className="text-xs" />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="yield"
                          name={t("federation.yield", "Yield")}
                          stroke="#10b981"
                          strokeWidth={2}
                          connectNulls
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="oee"
                          name={t("federation.oee", "OEE")}
                          stroke="#3b82f6"
                          strokeWidth={2}
                          connectNulls
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sync / health panel */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  {t("federation.syncHealth", "Aggregator sync & health")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Honest scheduler heartbeat */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {status?.isRunning ? (
                    <Badge className="border-transparent bg-success/15 text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("federation.aggregatorRunning", "Aggregator running")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      <CircleSlash className="h-3 w-3" />
                      {t("federation.aggregatorStopped", "Aggregator stopped")}
                    </Badge>
                  )}
                  {status?.cycleInFlight && (
                    <Badge variant="outline">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("federation.cycleInFlight", "Cycle in progress")}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t("federation.lastRun", "Last run")}: {fmtTime(status?.lastRunAt ?? null)}
                  </span>
                </div>
                {status?.lastError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs break-all">
                      {status.lastError}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Recent sync attempts */}
                <div className="max-h-[200px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">
                          {t("federation.when", "When")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {t("federation.siteId", "Site")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {t("federation.status", "Status")}
                        </TableHead>
                        <TableHead className="text-xs text-right">
                          {t("federation.metrics", "Metrics")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(syncLogQ.data ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-xs text-muted-foreground"
                          >
                            {t("federation.noSyncLog", "No sync attempts logged yet.")}
                          </TableCell>
                        </TableRow>
                      ) : (
                        (syncLogQ.data ?? []).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {fmtTime(s.startedAt)}
                            </TableCell>
                            <TableCell className="text-xs">#{s.siteId}</TableCell>
                            <TableCell className="text-xs">
                              {s.ok ? (
                                <span className="text-success">
                                  {s.status}
                                </span>
                              ) : (
                                <span
                                  className="text-destructive"
                                  title={s.error ?? undefined}
                                >
                                  {s.status}
                                  {s.httpStatus ? ` (${s.httpStatus})` : ""}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {s.metricsFetched}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
