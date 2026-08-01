/**
 * Control Tower — panel components (doc 46 FE-W3.1).
 *
 * Each panel is a compact, self-contained live card that reuses the SAME tRPC
 * routers as the specialised command screens (no data recomputed here) and links
 * out to the full view. All numbers are REAL — honest "—" / empty states only.
 *
 * Panel → router → full view:
 *   corporate     → dashboard.getStats + mqttClient.getAllOEE + drillDown.corporateStats → /corporate-dashboard
 *   execSummary   → executiveReport.latest                                               → /management-insight
 *   topRisks      → aiInsight.list                                                        → /management-insight
 *   alarmHealth   → alarmKpi.summary                                                      → /alarm-kpi
 *   lineOee       → warRoom.briefing (lines)                                              → /war-room
 *   planVsActual  → warRoom.briefing (planVsActual)                                       → /war-room
 *   shiftCompare  → warRoom.briefing (shiftCompare)                                       → /war-room
 *   topDowntime   → warRoom.briefing (lines[].topDowntime)                                → /war-room
 *   andonRail     → dashboard.getAndonBoard                                               → /ops-console
 *   liveAlarms    → commandCenter.recentAlerts                                            → /command-center
 */
import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2, FileText, Sparkles, BellRing, Gauge, PackageCheck, TrendingUp,
  Wrench, Radio, AlertTriangle, ShieldAlert, Lightbulb,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  PanelShell, pct, num, int, oeeTone, TONE_TEXT, relTimeShort, type Tone,
} from "./PanelShell";
import type { PanelKey } from "./personas";

// Shared poll cadences (socket invalidation from the page keeps these fresh; the
// interval is only a fallback when the live stream is unavailable).
const POLL_FAST = 30_000;
const POLL_SLOW = 120_000;

const VALUE_TONE: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  info: "text-info",
  accent: "text-primary",
};

/** Compact stat tile (label + value) — no nested card chrome. */
function Stat({
  label, value, tone = "default", hint,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2" title={hint}>
      <div className={cn("text-lg font-semibold tabular-nums", VALUE_TONE[tone])}>{value}</div>
      <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** Severity/state → dot colour (shared by alarm, insight + andon panels). */
function dotClass(kind: string): string {
  switch (kind) {
    case "critical":
    case "error":
    case "red":
      return "bg-destructive";
    case "high":
    case "warning":
    case "call":
      return "bg-warning";
    case "medium":
    case "yellow":
      return "bg-warning/70";
    case "low":
    case "info":
      return "bg-info";
    default:
      return "bg-muted-foreground/50";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EXECUTIVE PANELS
// ═════════════════════════════════════════════════════════════════════════════

/** Corporate yield + live mean OEE + top corporates by yield. */
function CorporatePanel(): React.JSX.Element {
  const { t } = useTranslation();
  const statsQ = trpc.dashboard.getStats.useQuery({}, { refetchInterval: POLL_SLOW, staleTime: 15_000 });
  const oeeQ = trpc.mqttClient.getAllOEE.useQuery(undefined, { refetchInterval: POLL_FAST, staleTime: 15_000 });
  const corpQ = trpc.drillDown.corporateStats.useQuery(undefined, { refetchInterval: POLL_SLOW, staleTime: 30_000 });

  const meanOee = useMemo<number | null>(() => {
    const rows = (oeeQ.data ?? []).filter((m) => typeof m.oee === "number" && !Number.isNaN(m.oee));
    if (rows.length === 0) return null;
    return rows.reduce((a, m) => a + m.oee, 0) / rows.length;
  }, [oeeQ.data]);

  const topCorps = useMemo(
    () => [...(corpQ.data ?? [])].sort((a, b) => b.yieldRate - a.yieldRate).slice(0, 4),
    [corpQ.data],
  );

  const s = statsQ.data;
  const isLoading = statsQ.isLoading;
  return (
    <PanelShell
      icon={<Building2 className="h-4 w-4 text-primary" />}
      title={t("controlTower.corporate.title", "Corporate yield & OEE")}
      description={t("controlTower.corporate.desc", "Estate-wide quality and live equipment effectiveness")}
      linkHref="/corporate-dashboard"
      isLoading={isLoading}
      isError={statsQ.isError}
      error={statsQ.error}
      isEmpty={!isLoading && !s}
      onRetry={statsQ.refetch}
      preset="stats"
      emptyText={t("controlTower.corporate.empty", "No inspection data yet.")}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t("controlTower.corporate.yield", "Final yield")}
            value={pct(s?.yieldRate ?? null)}
            tone={s?.yieldRate == null ? "default" : s.yieldRate >= 95 ? "success" : s.yieldRate >= 85 ? "warning" : "error"}
          />
          <Stat label={t("controlTower.corporate.fpy", "FPY")} value={pct(s?.fpy ?? null)} />
          <Stat
            label={t("controlTower.corporate.meanOee", "Mean OEE (live)")}
            value={meanOee == null ? "—" : pct(meanOee)}
            tone={oeeTone(meanOee)}
            hint={meanOee == null ? t("controlTower.corporate.noLiveOee", "No live OEE reported yet") : undefined}
          />
          <Stat label={t("controlTower.corporate.inspected", "Inspected")} value={int(s?.total ?? null)} />
        </div>

        {topCorps.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("controlTower.corporate.topCorps", "Top corporates by yield")}
            </div>
            <div className="space-y-1.5">
              {topCorps.map((c) => (
                <div key={c.code} className="flex items-center gap-2 text-sm">
                  <span className="w-28 truncate font-medium">{c.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        c.yieldRate >= 95 ? "bg-success" : c.yieldRate >= 85 ? "bg-warning" : "bg-destructive",
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, c.yieldRate))}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{pct(c.yieldRate)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

/** Latest persisted executive summary (headline + highlights + risks). */
function ExecSummaryPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = trpc.executiveReport.latest.useQuery(undefined, { refetchInterval: POLL_SLOW, staleTime: 60_000 });
  const report = q.data ?? null;
  const summary = report?.summary ?? null;

  const highlights = Array.isArray(summary?.highlights) ? summary!.highlights.slice(0, 3) : [];
  const risks = Array.isArray(summary?.risks) ? summary!.risks.slice(0, 3) : [];

  return (
    <PanelShell
      icon={<FileText className="h-4 w-4 text-primary" />}
      title={t("controlTower.execSummary.title", "Executive summary")}
      description={report?.createdAt ? `${t("controlTower.asOf", "As of")} ${new Date(report.createdAt).toLocaleString()}` : undefined}
      linkHref="/management-insight"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && !summary}
      onRetry={q.refetch}
      preset="list"
      emptyText={t("controlTower.execSummary.empty", "No summary generated yet.")}
    >
      <div className="space-y-3 text-sm">
        {summary?.headline && <p className="font-medium leading-snug">{summary.headline}</p>}
        {highlights.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-success">
              <Sparkles className="h-3.5 w-3.5" /> {t("controlTower.execSummary.highlights", "Highlights")}
            </div>
            <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
              {highlights.map((h: string, i: number) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
        {risks.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {t("controlTower.execSummary.risks", "Risks")}
            </div>
            <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
              {risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

/** Active AI insights / top risks (advisory, read-only). */
function TopRisksPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = trpc.aiInsight.list.useQuery({ status: "new", limit: 8 }, { refetchInterval: POLL_FAST, staleTime: 15_000 });
  const rows = q.data ?? [];

  return (
    <PanelShell
      icon={<Lightbulb className="h-4 w-4 text-primary" />}
      title={t("controlTower.topRisks.title", "Top AI insights")}
      description={t("controlTower.topRisks.desc", "Advisory — newest unreviewed signals")}
      linkHref="/management-insight"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && rows.length === 0}
      onRetry={q.refetch}
      preset="list"
      emptyText={t("controlTower.topRisks.empty", "No active insights. All clear.")}
    >
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotClass(String(r.severity ?? "").toLowerCase()))} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.title}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="px-1 py-0 text-[10px] capitalize">{r.severity}</Badge>
                {r.machineCode && <span>· {r.machineCode}</span>}
                {r.createdAt && <span className="ml-auto">{relTimeShort(r.createdAt)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

/** ISA-18.2 alarm KPI health (rate, flood, standing). */
function AlarmHealthPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = trpc.alarmKpi.summary.useQuery({ windowHours: 24 }, { refetchInterval: POLL_FAST, staleTime: 20_000 });
  const d = q.data;

  const rateStatus = d?.rate.status;
  const rateTone: Tone = rateStatus === "critical" ? "error" : rateStatus === "warning" ? "warning" : "success";

  return (
    <PanelShell
      icon={<BellRing className="h-4 w-4 text-primary" />}
      title={t("controlTower.alarmHealth.title", "Alarm health (24h)")}
      description={t("controlTower.alarmHealth.desc", "ISA-18.2 alarm rate, flood and standing alarms")}
      linkHref="/alarm-kpi"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && !d}
      onRetry={q.refetch}
      preset="stats"
      emptyText={t("controlTower.alarmHealth.empty", "No alarm activity in the window.")}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("controlTower.alarmHealth.total", "Total alarms")} value={int(d?.totalAlarms ?? null)} />
        <Stat
          label={t("controlTower.alarmHealth.ratePerOp", "Alarm/h/op")}
          value={d ? d.rate.alarmsPerHourPerOperator.toFixed(1) : "—"}
          tone={rateTone}
          hint={t("controlTower.alarmHealth.rateHint", "ISA-18.2 target ≤6, ceiling ≤12")}
        />
        <Stat
          label={t("controlTower.alarmHealth.floodPeak", "Flood peak / 10m")}
          value={int(d?.flood.maxInWindow ?? null)}
          tone={d?.flood.isFlooding ? "error" : "default"}
        />
        <Stat
          label={t("controlTower.alarmHealth.standing", "Standing")}
          value={int(d?.standing.count ?? null)}
          tone={d?.standing.status === "warning" ? "warning" : "default"}
          hint={d ? t("controlTower.alarmHealth.standingHint", "Unresolved > {{h}}h", { h: d.standing.thresholdHours }) : undefined}
        />
      </div>
      {d && (d.sourceCounts.andon > 0 || d.sourceCounts.predictive > 0) && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {t("controlTower.alarmHealth.sources", "Sources: {{andon}} Andon · {{pred}} AI predictive", {
            andon: d.sourceCounts.andon,
            pred: d.sourceCounts.predictive,
          })}
        </div>
      )}
    </PanelShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUPERVISOR PANELS (shared warRoom.briefing query — deduped by react-query)
// ═════════════════════════════════════════════════════════════════════════════

function useBriefing() {
  return trpc.warRoom.briefing.useQuery({}, { refetchInterval: POLL_SLOW, staleTime: 20_000 });
}

/** Per-line OEE (A/P/Q/OEE + output) — the #1 question at shift handover. */
function LineOeePanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = useBriefing();
  const lines = q.data?.lines ?? [];
  return (
    <PanelShell
      icon={<Gauge className="h-4 w-4 text-primary" />}
      title={t("controlTower.lineOee.title", "OEE by line")}
      description={q.data?.asOf ? `${t("controlTower.asOf", "As of")} ${new Date(q.data.asOf).toLocaleTimeString()}` : undefined}
      linkHref="/war-room"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && lines.length === 0}
      onRetry={q.refetch}
      preset="table"
      emptyText={t("controlTower.lineOee.empty", "No OEE for the current shift yet.")}
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("controlTower.lineOee.line", "Line")}</TableHead>
              <TableHead className="text-right">A%</TableHead>
              <TableHead className="text-right">P%</TableHead>
              <TableHead className="text-right">Q%</TableHead>
              <TableHead className="text-right">OEE%</TableHead>
              <TableHead className="text-right">{t("controlTower.lineOee.output", "Output")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.lineId}>
                <TableCell className="font-medium">{l.lineName}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.availability)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.performance)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.quality)}</TableCell>
                <TableCell className={cn("text-right font-semibold tabular-nums", TONE_TEXT[oeeTone(l.oee)])}>
                  {pct(l.oee)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(l.output)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PanelShell>
  );
}

/** Plan vs actual by line (progress bars). */
function PlanVsActualPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = useBriefing();
  const rows = q.data?.planVsActual ?? [];
  return (
    <PanelShell
      icon={<PackageCheck className="h-4 w-4 text-primary" />}
      title={t("controlTower.planVsActual.title", "Plan vs actual")}
      linkHref="/war-room"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && rows.length === 0}
      onRetry={q.refetch}
      preset="list"
      emptyText={t("controlTower.planVsActual.empty", "No production plan for the current shift.")}
    >
      <div className="flex flex-col gap-2.5">
        {rows.map((row, i) => {
          const p = row.pct;
          const clamped = p == null ? 0 : Math.max(0, Math.min(100, p));
          const barTone = p == null ? "bg-muted-foreground/40" : p >= 100 ? "bg-success" : p >= 80 ? "bg-warning" : "bg-destructive";
          return (
            <div key={`${row.lineName}-${i}`} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{row.lineName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {num(row.actual)} / {num(row.expected)}
                  {p != null && (
                    <span className={cn("ml-2 font-semibold", p >= 100 ? "text-success" : p >= 80 ? "text-warning" : "text-destructive")}>
                      {Math.round(p)}%
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", barTone)}
                  style={{ width: `${clamped}%` }}
                  role="progressbar"
                  aria-valuenow={p == null ? undefined : Math.round(p)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

/** Shift comparison (OEE / output / NG by shift). */
function ShiftComparePanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = useBriefing();
  const rows = q.data?.shiftCompare ?? [];
  return (
    <PanelShell
      icon={<TrendingUp className="h-4 w-4 text-primary" />}
      title={t("controlTower.shiftCompare.title", "Shift comparison")}
      linkHref="/war-room"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && rows.length === 0}
      onRetry={q.refetch}
      preset="table"
      emptyText={t("controlTower.shiftCompare.empty", "No shift comparison data yet.")}
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("controlTower.shiftCompare.shift", "Shift")}</TableHead>
              <TableHead className="text-right">OEE%</TableHead>
              <TableHead className="text-right">{t("controlTower.lineOee.output", "Output")}</TableHead>
              <TableHead className="text-right">NG%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s, i) => (
              <TableRow key={`${s.shiftLabel}-${i}`}>
                <TableCell className="font-medium">{s.shiftLabel}</TableCell>
                <TableCell className={cn("text-right font-semibold tabular-nums", TONE_TEXT[oeeTone(s.oee)])}>{pct(s.oee)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(s.output)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(s.ngRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PanelShell>
  );
}

/** Top machines by downtime (aggregated across lines). */
function TopDowntimePanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = useBriefing();
  const top = useMemo(() => {
    const all: { machineCode: string; minutes: number; reason: string; lineName: string }[] = [];
    for (const l of q.data?.lines ?? []) {
      for (const d of l.topDowntime ?? []) all.push({ ...d, lineName: l.lineName });
    }
    return all.sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 6);
  }, [q.data]);
  return (
    <PanelShell
      icon={<Wrench className="h-4 w-4 text-primary" />}
      title={t("controlTower.topDowntime.title", "Top downtime")}
      linkHref="/war-room"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && top.length === 0}
      onRetry={q.refetch}
      preset="table"
      emptyText={t("controlTower.topDowntime.empty", "No machine downtime in the shift.")}
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("controlTower.topDowntime.machine", "Machine")}</TableHead>
              <TableHead>{t("controlTower.lineOee.line", "Line")}</TableHead>
              <TableHead className="text-right">{t("controlTower.topDowntime.minutes", "Min")}</TableHead>
              <TableHead>{t("controlTower.topDowntime.reason", "Reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((d, i) => (
              <TableRow key={`${d.machineCode}-${i}`}>
                <TableCell className="font-medium">{d.machineCode}</TableCell>
                <TableCell className="text-muted-foreground">{d.lineName}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-destructive">{Math.round(d.minutes)}</TableCell>
                <TableCell className="text-muted-foreground">{d.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PanelShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// OPERATIONS PANELS
// ═════════════════════════════════════════════════════════════════════════════

/** Andon board — active signals + open alerts (from dashboard.getAndonBoard). */
function AndonRailPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = trpc.dashboard.getAndonBoard.useQuery({}, { refetchInterval: POLL_FAST, staleTime: 10_000 });
  const board = q.data;
  const andons = board?.andons ?? [];
  const open = andons.filter((a) => a.status !== "resolved");

  const stateTone = (state?: string | null): Tone =>
    state === "red" ? "error" : state === "call" ? "warning" : state === "yellow" ? "warning" : "default";

  return (
    <PanelShell
      icon={<Radio className="h-4 w-4 text-primary" />}
      title={t("controlTower.andonRail.title", "Andon rail")}
      description={
        board
          ? t("controlTower.andonRail.counts", "{{active}} active · {{alerts}} open alerts", {
              active: board.kpis.activeAndons,
              alerts: board.kpis.openAlerts,
            })
          : undefined
      }
      linkHref="/ops-console"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && open.length === 0}
      onRetry={q.refetch}
      preset="list"
      emptyText={t("controlTower.andonRail.empty", "No active Andon signals. All clear.")}
    >
      <div className="space-y-1.5">
        {open.slice(0, 8).map((a) => (
          <div key={a.id} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotClass(a.state ?? ""))} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{a.title || a.reason || t("controlTower.andonRail.signal", "Andon signal")}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("capitalize", TONE_TEXT[stateTone(a.state)])}>{a.state}</span>
                {a.lineName && <span>· {a.lineName}</span>}
                {a.machineCode && <span>· {a.machineCode}</span>}
                {a.raisedAt && <span className="ml-auto">{relTimeShort(a.raisedAt)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

/** Live unified alarm rail (from commandCenter.recentAlerts; page invalidates on socket events). */
function LiveAlarmsPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const q = trpc.commandCenter.recentAlerts.useQuery({ limit: 30 }, { refetchInterval: POLL_FAST, staleTime: 5_000 });
  const alerts = q.data?.alerts ?? [];
  return (
    <PanelShell
      icon={<ShieldAlert className="h-4 w-4 text-primary" />}
      title={t("controlTower.liveAlarms.title", "Live alarm rail")}
      description={t("controlTower.liveAlarms.desc", "Unified alert stream across the estate")}
      linkHref="/command-center"
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      isEmpty={!q.isLoading && alerts.length === 0}
      onRetry={q.refetch}
      preset="list"
      emptyText={t("controlTower.liveAlarms.empty", "No active alarms. All clear.")}
    >
      <div className="space-y-1.5">
        {alerts.slice(0, 10).map((a) => (
          <div key={a.id} className="rounded-md border px-2.5 py-1.5 text-sm">
            <div className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(a.severity))} />
              <Badge variant="outline" className="px-1 py-0 text-[10px] capitalize">{a.kind}</Badge>
              <span className="ml-auto text-[10px] text-muted-foreground">{relTimeShort(a.ts)}</span>
            </div>
            <div className="mt-0.5 truncate font-medium leading-snug">{a.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{a.source}</div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ═════════════════════════════════════════════════════════════════════════════

/** Panel key → component. Consumed by ControlTower to render a persona's grid. */
export const PANEL_COMPONENTS: Record<PanelKey, () => React.JSX.Element> = {
  corporate: CorporatePanel,
  execSummary: ExecSummaryPanel,
  topRisks: TopRisksPanel,
  alarmHealth: AlarmHealthPanel,
  lineOee: LineOeePanel,
  planVsActual: PlanVsActualPanel,
  shiftCompare: ShiftComparePanel,
  andonRail: AndonRailPanel,
  liveAlarms: LiveAlarmsPanel,
  topDowntime: TopDowntimePanel,
};
