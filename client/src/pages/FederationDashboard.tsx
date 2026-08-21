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
import { useState, useMemo, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  StatusBadge,
  MetricCard,
  SectionCard,
  PageHeader,
  PageContainer,
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisProps,
} from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
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
  Radio,
  ChevronRight,
  ChevronDown,
  Bell,
  Cpu,
  Factory,
  Building2,
  ArrowRight,
} from "lucide-react";

type FederationOutputs = inferRouterOutputs<AppRouter>["federation"];
type SiteDetailOutput = FederationOutputs["siteDetail"];
type AlertRollupOutput = FederationOutputs["alertRollup"];
type CategoryRollupOutput = FederationOutputs["categoryRollup"];
type RollupCategoryKey = CategoryRollupOutput["category"];

/** Compact live projection pushed on the `sites:global` room. Mirrors the
 *  server's SiteUpdateEvent (server/_core/socket.ts) — kept local to avoid a
 *  server-internal import from the client bundle. */
interface SiteUpdateEvent {
  siteCode: string;
  siteId: number;
  status: string;
  freshness?: "ok" | "stale" | "down";
  asOf?: string | null;
  fetchedAt?: string | null;
  kpi?: {
    yieldRate?: number | null;
    ngRate?: number | null;
    throughput?: number | null;
    oee?: number | null;
  } | null;
  alerts?: { open: number; critical: number } | null;
  ts: number;
}
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

/** Honest em-dash for a null/undefined category metric (never a fabricated 0). */
function dash(v: number | null | undefined, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toLocaleString()}${suffix}`;
}

/** "avgRepairHours" → "Avg repair hours" for the generic metrics bag. */
function humanizeMetricKey(k: string): string {
  const spaced = k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const CATEGORY_TABS = ["inspection", "oee", "fleet", "safety", "pdm"] as const;

/** Map a detail-tree node's yield/inspection posture → a StatusBadge status. */
function deviceStatus(
  yieldRate: number | null,
  total: number | null,
): { status: string; label: string } {
  if (total == null || total === 0) return { status: "idle", label: "no data" };
  if (yieldRate == null) return { status: "unknown", label: "—" };
  if (yieldRate >= 98) return { status: "ok", label: `${yieldRate}%` };
  if (yieldRate >= 90) return { status: "warning", label: `${yieldRate}%` };
  return { status: "down", label: `${yieldRate}%` };
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

// ── U5 · Site drill panel (siteDetail: factory/station/device tree) ──────────

function SiteDrillPanel({
  loading,
  error,
  detail,
  deepLink,
}: {
  loading: boolean;
  error: string | null;
  detail: SiteDetailOutput | null;
  deepLink: string | null;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("federation.loadingDetail", "Loading site detail…")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs break-all">{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!detail) return null;

  // Honest: a remote site that returned no detailRows (older site) → no tree.
  if (!detail.hasDetail) {
    return (
      <div className="p-4 space-y-3">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>
            {t("federation.noDetailTitle", "No detail feed (older site)")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "federation.noDetailBody",
              "This site's roll-up did not include a station/device breakdown (a remote/older site that doesn't serve the deepened feed). Open the remote app for its full drill-down.",
            )}
          </AlertDescription>
        </Alert>
        {deepLink && (
          <Button asChild variant="outline" size="sm">
            <a href={deepLink} target="_blank" rel="noopener noreferrer">
              {t("federation.openSite", "Open site")}
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Factory className="h-4 w-4 text-primary" />
        <span className="font-medium text-foreground">{detail.site.name}</span>
        <FreshnessBadge state={detail.freshness.state} ageSec={detail.freshness.ageSec} />
        <span>·</span>
        <span>{t("federation.asOf", "as of")} {fmtTime(detail.asOf)}</span>
      </div>
      <div className="space-y-3">
        {detail.stations.map((st) => (
          <div key={st.stationCode} className="rounded-lg border bg-background/60">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="h-4 w-4 text-muted-foreground" />
                {st.stationName || st.stationCode}
                <span className="text-xs text-muted-foreground">({st.stationCode})</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("federation.deviceCount", "{{n}} device(s)", { n: st.deviceCount })}
              </span>
            </div>
            <div className="divide-y">
              {st.devices.map((dv) => {
                const ds = deviceStatus(dv.yieldRate, dv.totalInspections);
                return (
                  <div
                    key={dv.machineId ?? dv.machineCode}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium">
                        {dv.machineName || dv.machineCode || `#${dv.machineId ?? "?"}`}
                      </span>
                      {dv.machineCode && (
                        <span className="text-xs text-muted-foreground truncate">
                          {dv.machineCode}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {t("federation.throughput", "Throughput")}: {fmtInt(dv.totalInspections)}
                      </span>
                      <span>
                        {t("federation.cycleTime", "Cycle")}: {dash(dv.avgCycleTime, "s")}
                      </span>
                      <StatusBadge status={ds.status} label={ds.label} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── U5 · Cross-site alert roll-up panel (alertRollup) ────────────────────────

function AlertRollupPanel({ data }: { data: AlertRollupOutput | undefined }) {
  const { t } = useTranslation();
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<Bell className="h-4 w-4" />}
          label={t("federation.openAlerts", "Open alerts")}
          value={data.totals.open.toLocaleString()}
          tone={data.totals.open > 0 ? "warning" : "default"}
        />
        <MetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label={t("federation.criticalAlerts", "Critical")}
          value={data.totals.critical.toLocaleString()}
          tone={data.totals.critical > 0 ? "error" : "default"}
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label={t("federation.nearMiss", "Near-miss")}
          value={data.totals.nearMiss.toLocaleString()}
        />
        <MetricCard
          icon={<Network className="h-4 w-4" />}
          label={t("federation.sitesWithAlertFeed", "Sites w/ alert feed")}
          value={`${data.sitesWithAlertFeed}/${data.sitesTotal}`}
        />
      </div>

      {/* Honest basis note — a site without an alert feed contributes nothing. */}
      {data.sitesWithAlertFeed < data.sitesTotal && (
        <p className="text-xs text-muted-foreground">
          {t(
            "federation.alertFeedBasis",
            "{{n}} of {{total}} sites provide an alert feed; sites without one contribute nothing (not a fabricated 0).",
            { n: data.sitesWithAlertFeed, total: data.sitesTotal },
          )}
        </p>
      )}

      {data.top.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {data.sitesWithAlertFeed === 0
            ? t("federation.noAlertFeed", "No site is reporting an alert feed yet.")
            : t("federation.noOpenAlerts", "No open alerts across reporting sites.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("federation.severity", "Severity")}</TableHead>
              <TableHead>{t("federation.site", "Site")}</TableHead>
              <TableHead>{t("federation.alertTitle", "Title")}</TableHead>
              <TableHead className="text-right">{t("federation.count", "Count")}</TableHead>
              <TableHead>{t("federation.time", "Time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.top.map((a, i) => (
              <TableRow key={`${a.siteCode}-${a.kind}-${i}`}>
                <TableCell>
                  <StatusBadge status={a.severity} label={a.severity} />
                </TableCell>
                <TableCell className="text-sm">{a.siteCode}</TableCell>
                <TableCell className="text-sm">
                  <span className="font-medium">{a.title || a.kind}</span>
                  <span className="block text-xs text-muted-foreground">{a.kind}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{a.count}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {fmtTime(a.at ?? null)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ── U5 · Per-category cross-site grid (categoryRollup) ───────────────────────

function CategoryGrid({ data }: { data: CategoryRollupOutput | undefined }) {
  const { t } = useTranslation();
  if (!data) return null;

  // Collect the union of metric keys across sites so the grid has stable columns.
  const metricKeys = Array.from(
    new Set(
      data.perSite.flatMap((p) => (p.metrics ? Object.keys(p.metrics) : [])),
    ),
  ).sort();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t("federation.sitesReportingCategory", "{{n}}/{{total}} sites reporting this category", {
            n: data.sitesReporting,
            total: data.sitesTotal,
          })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("federation.site", "Site")}</TableHead>
              <TableHead>{t("federation.freshness", "Freshness")}</TableHead>
              <TableHead className="text-right">{t("federation.yield", "Yield")}</TableHead>
              <TableHead className="text-right">{t("federation.oee", "OEE")}</TableHead>
              <TableHead className="text-right">{t("federation.throughput", "Throughput")}</TableHead>
              <TableHead className="text-right">{t("federation.ngRate", "NG")}</TableHead>
              {metricKeys.map((k) => (
                <TableHead key={k} className="text-right whitespace-nowrap">
                  {humanizeMetricKey(k)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.perSite.map((p) => (
              <TableRow key={p.siteCode}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium flex items-center gap-2">
                      {p.siteName}
                      {p.isLocal && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("federation.local", "local")}
                        </Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.siteCode}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {p.hasData ? (
                    <FreshnessBadge state={p.freshness.state} ageSec={p.freshness.ageSec} />
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      <CircleSlash className="h-3 w-3" />
                      {t("federation.noCategoryFeed", "no feed")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{dash(p.yieldRate, "%")}</TableCell>
                <TableCell className="text-right">{dash(p.oee, "%")}</TableCell>
                <TableCell className="text-right">{dash(p.throughput)}</TableCell>
                <TableCell className="text-right">{dash(p.ngRate, "%")}</TableCell>
                {metricKeys.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {dash(p.metrics?.[k] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Honest metric totals — contributing-site count is explicit, never a 0. */}
      {metricKeys.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {metricKeys.map((k) => {
            const total = data.metricTotals[k];
            const reporting = data.metricReporting[k] ?? 0;
            return (
              <div
                key={k}
                className="rounded-lg border px-3 py-2 text-xs"
                title={t(
                  "federation.metricBasis",
                  "{{n}} site(s) contributed to this total",
                  { n: reporting },
                )}
              >
                <span className="text-muted-foreground">{humanizeMetricKey(k)}: </span>
                <span className="font-semibold tabular-nums">
                  {reporting > 0 ? total.toLocaleString() : "—"}
                </span>
                <span className="text-muted-foreground"> ({reporting})</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function FederationDashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [corporateFilter, setCorporateFilter] = useState<string>("__all__");
  // U5 — drill (site row → factory/station/device tree) + category tab.
  const [drillSiteCode, setDrillSiteCode] = useState<string | null>(null);
  const [category, setCategory] = useState<RollupCategoryKey>("inspection");

  const scopeInput =
    corporateFilter === "__all__" ? undefined : { corporateCode: corporateFilter };

  // Poll every 30s as the honest fallback when the aggregator/socket live layer
  // is off. When live events ARE flowing, the merged overlay (below) supersedes
  // the polled headline fields, so the poll just keeps the slower fields fresh.
  const rollupsQ = trpc.federation.siteRollups.useQuery(scopeInput, {
    refetchInterval: 30_000,
  });
  const summaryQ = trpc.federation.aggregateSummary.useQuery(scopeInput);
  // siteRollups intentionally omits baseUrl; the deep-link target comes from the
  // F0 sites registry (admin-scoped, same gate as this page). Consume-only.
  const sitesListQ = trpc.sites.list.useQuery();
  const statusQ = trpc.federation.status.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const syncLogQ = trpc.federation.syncLog.useQuery({ limit: 25 });

  // U5 — alert roll-up (cross-site) + per-category cross-site view. Both honour
  // the corporate scope filter. Category view is driven by the segmented control.
  const alertRollupQ = trpc.federation.alertRollup.useQuery(scopeInput, {
    refetchInterval: 30_000,
  });
  const categoryRollupQ = trpc.federation.categoryRollup.useQuery(
    { category, ...(scopeInput ?? {}) },
    { refetchInterval: 30_000 },
  );

  // U5 — drill panel: siteDetail for the expanded site row (factory/station/device
  // tree from retained detailRows). Only fetched when a row is expanded.
  const siteDetailQ = trpc.federation.siteDetail.useQuery(
    { siteCode: drillSiteCode ?? "" },
    { enabled: drillSiteCode != null },
  );

  const rollupsBase = rollupsQ.data ?? [];
  const summary = summaryQ.data;

  // ── U5 LIVE — subscribe `sites:global` for `site:update` (freshness + headline
  // KPIs + alert counts). When the aggregator/socket is off we simply never
  // receive events and fall back to the existing 30s poll below. The overlay is
  // keyed by siteCode and merged onto the polled rows so we never fabricate a
  // site we didn't poll.
  const [liveBySite, setLiveBySite] = useState<Record<string, SiteUpdateEvent>>({});
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    const socket = getSharedSocket();
    const join = () => socket.emit("subscribe", { sitesGlobal: true });
    const onConnect = () => {
      setLiveConnected(true);
      join();
    };
    const onDisconnect = () => setLiveConnected(false);
    const onSiteUpdate = (evt: SiteUpdateEvent) => {
      if (!evt?.siteCode) return;
      setLiveBySite((prev) => ({ ...prev, [evt.siteCode]: evt }));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("site:update", onSiteUpdate);
    if (socket.connected) {
      setLiveConnected(true);
      join();
    }

    return () => {
      socket.emit("unsubscribe", { sitesGlobal: true });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("site:update", onSiteUpdate);
      releaseSharedSocket();
    };
  }, []);

  // Any live event received in this session → we are LIVE (aggregator emitting).
  // Until then we are POLLING (the honest default) even if the socket is up.
  const hasLive = Object.keys(liveBySite).length > 0;

  // Merge the compact live projection onto the polled roll-up rows (live wins for
  // freshness state + headline KPIs + alert counts; everything else stays polled).
  const rollups = useMemo(() => {
    if (!hasLive) return rollupsBase;
    return rollupsBase.map((r) => {
      const live = liveBySite[r.site.code];
      if (!live) return r;
      return {
        ...r,
        freshness: live.freshness
          ? { state: live.freshness, ageSec: 0 }
          : r.freshness,
        kpi: r.kpi
          ? {
              ...r.kpi,
              yieldRate: live.kpi?.yieldRate ?? r.kpi.yieldRate,
              ngRate: live.kpi?.ngRate ?? r.kpi.ngRate,
              throughput: live.kpi?.throughput ?? r.kpi.throughput,
              oee: live.kpi?.oee ?? r.kpi.oee,
              alertRollup:
                live.alerts != null
                  ? {
                      ...(r.kpi.alertRollup ?? { open: 0, critical: 0 }),
                      open: live.alerts.open,
                      critical: live.alerts.critical,
                    }
                  : r.kpi.alertRollup,
            }
          : r.kpi,
      };
    });
  }, [rollupsBase, liveBySite, hasLive]);

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
        <PageContainer>
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<Globe className="h-6 w-6" />}
          title={t("federation.dashboard", "Federation Dashboard")}
          description={t(
            "federation.dashboardDescription",
            "Read-only cross-site roll-up. The core aggregates each site's KPIs — it never controls a site.",
          )}
          actions={
            <>
              {/* Cross-links back to the corporate roll-up world (org hierarchy) and
                  the F0 site registry — same admin/admin_system gate as this page. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/corporate-dashboard")}
                title={t("nav.corporateDashboardDesc", "Multi-factory corporate roll-up")}
              >
                <Building2 className="h-4 w-4 mr-2" />
                {t("nav.corporateDashboard", "Corporate Dashboard")}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/sites")}
                title={t("nav.sitesDesc", "Site registry")}
              >
                <Network className="h-4 w-4 mr-2" />
                {t("nav.sites", "Sites Federation")}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              {/* U5 — honest LIVE (aggregator emitting site:update) vs POLLING (30s) */}
              {hasLive ? (
                <Badge
                  className="border-transparent bg-success/15 text-success"
                  title={t(
                    "federation.liveHint",
                    "Aggregator is pushing site:update — site cards update in real time.",
                  )}
                >
                  <Radio className="h-3 w-3" />
                  {t("federation.live", "LIVE")}
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="text-muted-foreground"
                  title={
                    liveConnected
                      ? t(
                          "federation.pollingConnectedHint",
                          "Socket connected; no aggregator push yet — polling every 30s.",
                        )
                      : t("federation.pollingHint", "Live layer off — polling every 30s.")
                  }
                >
                  <Clock className="h-3 w-3" />
                  {t("federation.polling", "POLLING")}
                </Badge>
              )}
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
                  void alertRollupQ.refetch();
                  void categoryRollupQ.refetch();
                  if (drillSiteCode) void siteDetailQ.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("federation.refresh", "Refresh")}
              </Button>
            </>
          }
        />

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
          <SectionCard
            icon={<Globe className="h-4 w-4 text-primary" />}
            title={t("federation.fleetOverview", "Fleet overview")}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                icon={<Network className="h-4 w-4" />}
                label={t("federation.totalSites", "Sites")}
                value={summary?.sitesTotal ?? rollups.length}
              />
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label={t("federation.reporting", "Reporting")}
                value={reporting}
                tone="success"
              />
              <MetricCard
                icon={<Clock className="h-4 w-4" />}
                label={t("federation.stale", "Stale")}
                value={staleCount}
                tone={staleCount > 0 ? "warning" : "default"}
              />
              <MetricCard
                icon={<CircleSlash className="h-4 w-4" />}
                label={t("federation.down", "Down")}
                value={downCount}
                tone={downCount > 0 ? "error" : "default"}
              />
              <MetricCard
                icon={<TrendingUp className="h-4 w-4" />}
                label={t("federation.weightedYield", "Yield (units-weighted)")}
                value={fmt(summary?.overallYieldRate ?? null, "%")}
                tone="info"
              />
              <MetricCard
                icon={<Activity className="h-4 w-4" />}
                label={t("federation.totalThroughput", "Total throughput")}
                value={fmtInt(summary?.totals.totalInspections ?? null)}
              />
            </div>
          </SectionCard>
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
          <SectionCard
            icon={<Network className="h-4 w-4 text-primary" />}
            title={t("federation.siteGrid", "Per-site KPIs")}
          >
              <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
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
                  {rollups.map((r) => {
                    const expanded = drillSiteCode === r.site.code;
                    return (
                      <Fragment key={r.site.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() =>
                            setDrillSiteCode(expanded ? null : r.site.code)
                          }
                          aria-expanded={expanded}
                          title={t(
                            "federation.drillHint",
                            "Show this site's factory → station → device tree",
                          )}
                        >
                          <TableCell className="pr-0 text-muted-foreground">
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
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
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                        {expanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={10} className="p-0">
                              <SiteDrillPanel
                                loading={siteDetailQ.isLoading}
                                error={siteDetailQ.error ? mapTrpcError(siteDetailQ.error) : null}
                                detail={siteDetailQ.data ?? null}
                                deepLink={baseUrlBySite.get(r.site.id) ?? null}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
          </SectionCard>
        )}

        {/* U5 — Cross-site alert roll-up */}
        {rollups.length > 0 && (
          <SectionCard
            icon={<Bell className="h-4 w-4 text-primary" />}
            title={t("federation.alertRollupTitle", "Cross-site alert roll-up")}
            description={t(
              "federation.alertRollupDesc",
              "Open / critical / near-miss aggregated across sites that serve an alert feed. Sites without a feed are excluded honestly.",
            )}
            action={
              alertRollupQ.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : undefined
            }
          >
            {alertRollupQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("federation.loadingAlerts", "Loading alert roll-up…")}
              </div>
            ) : (
              <AlertRollupPanel data={alertRollupQ.data} />
            )}
          </SectionCard>
        )}

        {/* U5 — Per-category cross-site view (segmented control) */}
        {rollups.length > 0 && (
          <SectionCard
            icon={<Network className="h-4 w-4 text-primary" />}
            title={t("federation.categoryTitle", "Cross-site by category")}
            description={t(
              "federation.categoryDesc",
              "Per-category site grid. An old site with no feed for a category shows '—' (never a fabricated 0). Real OEE shows where available.",
            )}
            action={
              <Tabs
                value={category}
                onValueChange={(v) => setCategory(v as RollupCategoryKey)}
              >
                <TabsList>
                  {CATEGORY_TABS.map((c) => (
                    <TabsTrigger key={c} value={c} className="capitalize">
                      {t(`federation.category.${c}`, c)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            }
          >
            {categoryRollupQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("federation.loadingCategory", "Loading category roll-up…")}
              </div>
            ) : (
              <CategoryGrid data={categoryRollupQ.data} />
            )}
          </SectionCard>
        )}

        {/* KPI trend + sync/health */}
        {rollups.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Trend (siteKpiHistory) */}
            <SectionCard
              icon={<TrendingUp className="h-4 w-4 text-primary" />}
              title={t("federation.kpiTrend", "Site KPI trend (daily)")}
              action={
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
              }
            >
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
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="day" {...chartAxisProps} />
                        <YAxis domain={[0, 100]} {...chartAxisProps} />
                        <RechartsTooltip
                          contentStyle={chartTooltipStyle}
                          labelStyle={chartTooltipLabelStyle}
                          itemStyle={chartTooltipLabelStyle}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="yield"
                          name={t("federation.yield", "Yield")}
                          stroke={chartColor(0)}
                          strokeWidth={2}
                          connectNulls
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="oee"
                          name={t("federation.oee", "OEE")}
                          stroke={chartColor(1)}
                          strokeWidth={2}
                          connectNulls
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
            </SectionCard>

            {/* Sync / health panel */}
            <SectionCard
              icon={<Activity className="h-4 w-4 text-primary" />}
              title={t("federation.syncHealth", "Aggregator sync & health")}
              contentClassName="space-y-3"
            >
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
            </SectionCard>
          </div>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
