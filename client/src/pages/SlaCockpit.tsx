/**
 * doc 46 FE-W2 — SLA COCKPIT (Andon / Alert SLA health).
 *
 * A single management screen for alert/andon SLA: MTTA (mean time to acknowledge),
 * MTTR (mean time to resolve), escalation-breach count + rate and open-past-SLA
 * count, over a selectable window, broken down by severity and by line.
 *
 * HONESTY — no fabricated numbers. Two clearly-labelled data classes:
 *   • Headline MTTA / MTTR are BACKEND-AGGREGATED by the server over ALL Andon
 *     events in the window (trpc.andon.metrics → avg of the mttaSeconds/mttrSeconds
 *     columns stamped at acknowledge/resolve). Uncapped, authoritative.
 *   • Per-severity / per-line means and escalation counts are COMPUTED CLIENT-SIDE
 *     from the ≤500 most-recent Andon event rows (trpc.andon.list) filtered to the
 *     window. A cap note is shown if the window may hold more than 500 events.
 *   • The alert-channel escalation ledger (trpc.alertEscalation.recentEscalations)
 *     is a SEPARATE source (MQTT/connection alerts, not Andon) shown for context.
 *
 * "Escalation breach" = an Andon the server SLA sweep escalated (escalationLevel>0)
 * because it stayed unresolved past its per-state SLA threshold. "Open past SLA" =
 * such an Andon that is still not resolved. When nothing is available → honest empty.
 */
import { useMemo, useState } from "react";
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlarmClock,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { PollFreshness } from "@/components/PollFreshness";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer, PageHeader, SectionCard, MetricCard, StatChip, StatChipRow, StatusBadge } from "@/components/patterns";
import type { MetricTone } from "@/components/patterns";
import type { Tone } from "@/components/patterns/tokens";
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

type RouterOutputs = inferRouterOutputs<AppRouter>;
type AndonRow = RouterOutputs["andon"]["list"][number];
type EscalationRow = RouterOutputs["alertEscalation"]["recentEscalations"][number];

const CURRENT_PATH = "/sla-cockpit";
const LIST_CAP = 500;

/** Window options (hours) — 8h / 24h / 7d / 30d, matching the app window-picker pattern. */
const WINDOW_OPTIONS = [
  { hours: 8, key: "w8h", fallback: "8h" },
  { hours: 24, key: "w24h", fallback: "24h" },
  { hours: 24 * 7, key: "w7d", fallback: "7d" },
  { hours: 24 * 30, key: "w30d", fallback: "30d" },
] as const;

/** Andon state IS the severity dimension. Order most-severe first. */
const SEVERITY_ORDER = ["call", "red", "yellow", "green"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

function severityTone(sev: Severity): Exclude<Tone, "accent"> {
  switch (sev) {
    case "call":
      return "error";
    case "red":
      return "error";
    case "yellow":
      return "warning";
    default:
      return "success";
  }
}

function ms(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Seconds → compact human duration ("45s", "3m 20s", "1h 5m"). */
function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

interface SevAgg {
  sev: Severity;
  count: number;
  acked: number;
  resolved: number;
  mtta: number | null;
  mttr: number | null;
  breaches: number;
}

interface LineAgg {
  lineId: number | null;
  count: number;
  mtta: number | null;
  mttr: number | null;
  breaches: number;
}

export default function SlaCockpit() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const [windowHours, setWindowHours] = useState<number>(24);

  const polling = usePollingInterval(30_000);
  // doc 64 IA-10 S3-D/S4 — cả danh sách LẪN metrics MTTA/MTTR theo trục Chuyền/Máy
  // (andon.metrics đã nhận lineId/machineId ở S4).
  const { scope: assetScope } = useScope(["line", "machine"]);
  useScopeWired();
  const metricsQ = trpc.andon.metrics.useQuery(
    { sinceHours: windowHours, lineId: assetScope.lineId, machineId: assetScope.machineId },
    { staleTime: 20_000, ...polling },
  );
  const listQ = trpc.andon.list.useQuery(
    { limit: LIST_CAP, lineId: assetScope.lineId, machineId: assetScope.machineId },
    { staleTime: 20_000, ...polling },
  );
  const escQ = trpc.alertEscalation.recentEscalations.useQuery(
    { limit: 200 },
    { staleTime: 20_000, retry: false, ...polling },
  );

  const metrics = metricsQ.data;
  const rawRows: AndonRow[] = useMemo(() => listQ.data ?? [], [listQ.data]);
  const escRows: EscalationRow[] = useMemo(() => escQ.data ?? [], [escQ.data]);

  const computed = useMemo(() => {
    const since = Date.now() - windowHours * 3600_000;
    const rows = rawRows.filter((r) => (ms(r.raisedAt) ?? 0) >= since);

    const acked = rows.filter((r) => r.acknowledgedAt != null).length;
    const resolved = rows.filter((r) => r.status === "resolved").length;
    const active = rows.filter((r) => r.resolvedAt == null).length;
    const breaches = rows.filter((r) => (r.escalationLevel ?? 0) > 0).length;
    const openPastSla = rows.filter((r) => r.resolvedAt == null && (r.escalationLevel ?? 0) > 0).length;
    const breachRate = rows.length > 0 ? Math.round((breaches / rows.length) * 1000) / 10 : 0;

    // ── By severity (andon state) ──────────────────────────────────────────────
    const bySeverity: SevAgg[] = SEVERITY_ORDER.map((sev) => {
      const g = rows.filter((r) => r.state === sev);
      return {
        sev,
        count: g.length,
        acked: g.filter((r) => r.acknowledgedAt != null).length,
        resolved: g.filter((r) => r.status === "resolved").length,
        mtta: mean(g.map((r) => r.mttaSeconds).filter((v): v is number => v != null)),
        mttr: mean(g.map((r) => r.mttrSeconds).filter((v): v is number => v != null)),
        breaches: g.filter((r) => (r.escalationLevel ?? 0) > 0).length,
      };
    }).filter((s) => s.count > 0);

    // ── By line ────────────────────────────────────────────────────────────────
    const lineKeys = new Map<string, AndonRow[]>();
    for (const r of rows) {
      const key = r.lineId == null ? "none" : String(r.lineId);
      const arr = lineKeys.get(key) ?? [];
      arr.push(r);
      lineKeys.set(key, arr);
    }
    const byLine: LineAgg[] = [...lineKeys.entries()]
      .map(([key, g]) => ({
        lineId: key === "none" ? null : Number(key),
        count: g.length,
        mtta: mean(g.map((r) => r.mttaSeconds).filter((v): v is number => v != null)),
        mttr: mean(g.map((r) => r.mttrSeconds).filter((v): v is number => v != null)),
        breaches: g.filter((r) => (r.escalationLevel ?? 0) > 0).length,
      }))
      .sort((a, b) => b.count - a.count);

    const alertEsc = escRows.filter((r) => (ms(r.escalatedAt) ?? 0) >= since);

    return {
      windowCount: rows.length,
      acked,
      resolved,
      active,
      breaches,
      openPastSla,
      breachRate,
      bySeverity,
      byLine,
      alertEsc,
      capHit: rawRows.length >= LIST_CAP,
    };
  }, [rawRows, escRows, windowHours]);

  const isLoading = metricsQ.isLoading && listQ.isLoading;
  const backendTotal = metrics?.total ?? 0;
  // Honest empty: no Andon in the window (server-authoritative total) AND no alert escalations.
  const noData = !isLoading && backendTotal === 0 && computed.alertEsc.length === 0;

  const mttaValue = metrics && metrics.avgMttaSeconds > 0 ? fmtDuration(metrics.avgMttaSeconds) : "—";
  const mttrValue = metrics && metrics.avgMttrSeconds > 0 ? fmtDuration(metrics.avgMttrSeconds) : "—";
  const breachTone: MetricTone = computed.breaches > 0 ? "warning" : "success";
  const openTone: MetricTone = computed.openPastSla > 0 ? "error" : "success";

  return (
    <DashboardLayout
      title={t("slaCockpit.title", "SLA Cockpit")}
      navItems={navItems}
      currentPath={CURRENT_PATH}
    >
      <PageContainer className="space-y-6">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Gauge className="h-6 w-6" />}
          title={t("slaCockpit.title", "SLA Cockpit")}
          description={t(
            "slaCockpit.subtitle",
            "Andon / alert SLA health: mean time to acknowledge (MTTA), mean time to resolve (MTTR), escalation breaches and Andons still open past their SLA.",
          )}
          actions={
            <div className="flex items-center gap-2">
              <PollFreshness updatedAt={metricsQ.dataUpdatedAt} isFetching={metricsQ.isFetching || listQ.isFetching} />
              <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.hours} value={String(o.hours)}>
                      {t(`slaCockpit.window.${o.key}`, o.fallback)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && noData && (
          <EmptyState
            icon={Gauge}
            title={t("slaCockpit.empty.title", "No SLA data")}
            description={t(
              "slaCockpit.empty.desc",
              "No Andon events or alert escalations were recorded in the selected window.",
            )}
          />
        )}

        {!isLoading && !noData && (
          <>
            {/* How SLA breaches are defined — honest semantics */}
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  "slaCockpit.howItWorks",
                  "An escalation breach is an Andon the server SLA sweep escalated because it stayed unresolved past its per-state SLA (red/call urgent, yellow softer). \"Open past SLA\" counts those still unresolved. MTTA/MTTR are aggregated by the server over every Andon in the window; per-severity/line breakdowns and escalation counts are computed from the most-recent Andon events.",
                )}
              </span>
            </div>

            {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                icon={<AlarmClock className="h-5 w-5" />}
                label={t("slaCockpit.kpi.mtta", "MTTA — mean time to acknowledge")}
                value={mttaValue}
                delta={t("slaCockpit.kpi.serverAgg", "server-aggregated")}
              />
              <MetricCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                label={t("slaCockpit.kpi.mttr", "MTTR — mean time to resolve")}
                value={mttrValue}
                delta={t("slaCockpit.kpi.serverAgg", "server-aggregated")}
              />
              <MetricCard
                icon={<ArrowUpCircle className="h-5 w-5" />}
                label={t("slaCockpit.kpi.breaches", "Escalation breaches")}
                value={computed.breaches}
                tone={breachTone}
                delta={t("slaCockpit.kpi.breachRate", "{{rate}}% of Andons", { rate: computed.breachRate })}
              />
              <MetricCard
                icon={<Clock className="h-5 w-5" />}
                label={t("slaCockpit.kpi.openPastSla", "Open past SLA")}
                value={computed.openPastSla}
                tone={openTone}
                delta={t("slaCockpit.kpi.openPastSlaHint", "unresolved & escalated")}
              />
            </div>

            {/* Secondary volume chips + source honesty note */}
            <div className="space-y-2">
              <StatChipRow>
                <StatChip
                  icon={<Gauge className="size-3.5" />}
                  label={t("slaCockpit.chips.total", "Andons (window)")}
                  value={backendTotal}
                />
                <StatChip label={t("slaCockpit.chips.acked", "Acknowledged")} value={computed.acked} />
                <StatChip label={t("slaCockpit.chips.resolved", "Resolved")} value={computed.resolved} />
                <StatChip
                  label={t("slaCockpit.chips.active", "Active")}
                  value={computed.active}
                  tone={computed.active > 0 ? "warning" : "default"}
                />
                <StatChip
                  icon={<TriangleAlert className="size-3.5" />}
                  label={t("slaCockpit.chips.alertEsc", "Alert escalations")}
                  value={computed.alertEsc.length}
                  tone={computed.alertEsc.length > 0 ? "warning" : "default"}
                  title={t("slaCockpit.chips.alertEscHint", "MQTT / connection alerts the sweep escalated (separate channel)")}
                />
              </StatChipRow>
              <p className="text-xs text-muted-foreground">
                {t(
                  "slaCockpit.source.note",
                  "MTTA/MTTR: server-aggregated over all {{total}} Andon(s) in the window. Breakdowns & escalation counts: computed from the {{n}} most-recent Andon event rows.",
                  { total: backendTotal, n: computed.windowCount },
                )}
                {computed.capHit && (
                  <span className="text-warning">
                    {" "}
                    {t("slaCockpit.source.capped", "Row list is capped at {{cap}} events — breakdowns use the most-recent rows only.", {
                      cap: LIST_CAP,
                    })}
                  </span>
                )}
              </p>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              {/* ── By severity ────────────────────────────────────────────────── */}
              <SectionCard
                title={t("slaCockpit.severity.title", "SLA by severity")}
                description={t("slaCockpit.severity.desc", "MTTA / MTTR and escalation breaches per Andon state")}
              >
                {computed.bySeverity.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("slaCockpit.severity.none", "No Andon events in the window.")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("slaCockpit.severity.col.severity", "Severity")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.events", "Events")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.mtta", "MTTA")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.mttr", "MTTR")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.breaches", "Breaches")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {computed.bySeverity.map((s) => (
                        <TableRow key={s.sev}>
                          <TableCell>
                            <StatusBadge
                              status={s.sev}
                              tone={severityTone(s.sev)}
                              label={t(`slaCockpit.severity.state.${s.sev}`, s.sev)}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(s.mtta)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(s.mttr)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.breaches > 0 ? <span className="text-warning">{s.breaches}</span> : s.breaches}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>

              {/* ── By line ────────────────────────────────────────────────────── */}
              <SectionCard
                title={t("slaCockpit.byLine.title", "SLA by line")}
                description={t("slaCockpit.byLine.desc", "MTTA / MTTR and escalation breaches per production line")}
              >
                {computed.byLine.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("slaCockpit.byLine.none", "No Andon events in the window.")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("slaCockpit.byLine.col.line", "Line")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.events", "Events")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.mtta", "MTTA")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.mttr", "MTTR")}</TableHead>
                        <TableHead className="text-right">{t("slaCockpit.col.breaches", "Breaches")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {computed.byLine.map((l) => (
                        <TableRow key={l.lineId ?? "none"}>
                          <TableCell className="font-medium">
                            {l.lineId == null
                              ? t("slaCockpit.byLine.unassigned", "Unassigned")
                              : t("slaCockpit.byLine.lineName", "Line #{{id}}", { id: l.lineId })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{l.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(l.mtta)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(l.mttr)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {l.breaches > 0 ? <span className="text-warning">{l.breaches}</span> : l.breaches}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </div>

            {/* ── Alert escalation ledger (separate channel) ─────────────────────── */}
            <SectionCard
              title={t("slaCockpit.alertEsc.title", "Alert escalation ledger")}
              description={t(
                "slaCockpit.alertEsc.desc",
                "MQTT / connection alerts the sweep escalated in the window — a separate channel from Andon (each alert escalates at most once).",
              )}
            >
              {computed.alertEsc.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("slaCockpit.alertEsc.none", "No alert escalations in the window.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("slaCockpit.alertEsc.col.escalatedAt", "Escalated at")}</TableHead>
                        <TableHead>{t("slaCockpit.alertEsc.col.source", "Source")}</TableHead>
                        <TableHead>{t("slaCockpit.alertEsc.col.alert", "Alert")}</TableHead>
                        <TableHead>{t("slaCockpit.alertEsc.col.status", "Status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {computed.alertEsc.map((row) => (
                        <TableRow key={`${row.source}-${row.id}`}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {row.escalatedAt ? new Date(row.escalatedAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={row.source}
                              tone="info"
                              label={
                                row.source === "conn"
                                  ? t("slaCockpit.alertEsc.sourceConn", "connection")
                                  : t("slaCockpit.alertEsc.sourceMqtt", "mqtt rule")
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-72">
                            <span className="font-medium">{row.title}</span>
                            {row.message && <p className="truncate text-xs text-muted-foreground">{row.message}</p>}
                          </TableCell>
                          <TableCell>
                            {row.isResolved ? (
                              <StatusBadge status="resolved" tone="success" label={t("slaCockpit.alertEsc.resolved", "Resolved")} />
                            ) : row.isAcknowledged ? (
                              <StatusBadge status="acked" tone="info" label={t("slaCockpit.alertEsc.acknowledged", "Acknowledged")} />
                            ) : (
                              <StatusBadge status="open" tone="error" label={t("slaCockpit.alertEsc.open", "Still open")} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
