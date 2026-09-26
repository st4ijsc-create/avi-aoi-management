/**
 * doc 44 W6-1 (G5.11 phần đo) — ISA-18.2 ALARM KPI DASHBOARD (SYNAPSE LDS-L5 §7).
 *
 * Đọc trpc.alarmKpi.summary (gộp andon_events + predictive_alerts, KHÔNG sửa alert
 * router). Hiển thị KPI chuẩn ISA-18.2:
 *   • alarm/giờ/operator (mục tiêu 6, trần 12)
 *   • flood (>10 alarm / 10 phút)  • standing alarms (>24h chưa xử lý, <5)
 *   • top-10 bad actors            • phân bố ưu tiên (mục tiêu 80/15/5)
 * Cảnh báo trực quan khi vượt ngưỡng. ISA-101: nền trung tính, màu chỉ cho bất thường.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { AlarmClock, Activity, Bell, Gauge, Layers, ShieldAlert, TriangleAlert, Wifi, WifiOff } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { useEcosystemEvents } from "@/hooks/useEcosystemEvents";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { PollFreshness } from "@/components/PollFreshness";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer, PageHeader, SectionCard, StatChip, StatChipRow } from "@/components/patterns";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { pickOccurrenceLogNotice } from "./alarmKpiEmptyState";

const CURRENT_PATH = "/alarm-kpi";
const WINDOW_OPTIONS = [4, 8, 12, 24, 72] as const;

/** Tone StatChip theo status KPI ('ok'|'warning'|'critical'). */
function statusTone(s: "ok" | "warning" | "critical"): "success" | "warning" | "error" {
  return s === "critical" ? "error" : s === "warning" ? "warning" : "success";
}

export default function AlarmKpiDashboard() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const [windowHours, setWindowHours] = useState<number>(8);

  // doc 46 FE-W2 — socket drives freshness now, so the poll is lengthened to 60s and
  // kept only as a fallback backstop (was 30s).
  const polling = usePollingInterval(60_000);
  // doc 64 IA-10 S3-D — KPI alarm theo trục Chuyền/Máy (server đã nhận lineId+machineId).
  const { scope: assetScope } = useScope(["line", "machine"]);
  useScopeWired();
  const q = trpc.alarmKpi.summary.useQuery(
    { windowHours, lineId: assetScope.lineId, machineId: assetScope.machineId },
    { staleTime: 20_000, ...polling },
  );
  const data = q.data;

  // doc 46 FE-W2 — socket-first freshness. This KPI aggregates andon_events +
  // predictive_alerts, so an `andon` / `maintenance` / `anomaly` / `escalation`
  // ecosystem event invalidates the summary (short trailing debounce to collapse
  // bursts). The 60s poll above remains the fallback backstop if the socket drops.
  const utils = trpc.useUtils();
  const kpiInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleKpiInvalidate = useCallback(() => {
    if (kpiInvalidateTimer.current) clearTimeout(kpiInvalidateTimer.current);
    kpiInvalidateTimer.current = setTimeout(() => {
      utils.alarmKpi.summary.invalidate();
    }, 1500);
  }, [utils]);
  useEffect(() => () => { if (kpiInvalidateTimer.current) clearTimeout(kpiInvalidateTimer.current); }, []);
  const { isConnected: liveConnected } = useEcosystemEvents({
    alertsOnly: true,
    bufferSize: 1,
    onEvent: (evt) => {
      if (
        evt.kind === "andon" || evt.kind === "maintenance" ||
        evt.kind === "anomaly" || evt.kind === "escalation"
      ) {
        scheduleKpiInvalidate();
      }
    },
  });

  const distMax = useMemo(() => {
    if (!data) return 100;
    return Math.max(10, data.distribution.percent.low, data.distribution.percent.medium, data.distribution.percent.high);
  }, [data]);

  return (
    <DashboardLayout title={t("alarmKpi.title", "KPI Cảnh báo (ISA-18.2)")} navItems={navItems} currentPath={CURRENT_PATH}>
      <PageContainer className="space-y-6">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Bell className="h-6 w-6" />}
          title={t("alarmKpi.title", "KPI Cảnh báo (ISA-18.2)")}
          description={t(
            "alarmKpi.subtitle",
            "Đo lường hiệu năng hệ cảnh báo theo ISA-18.2: tần suất/giờ/operator, ngập báo động (flood), báo động tồn đọng, thủ phạm chính và phân bố ưu tiên.",
          )}
          actions={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  liveConnected ? "border-success/40 text-success" : "border-border text-muted-foreground",
                )}
                title={liveConnected
                  ? t("alarmKpi.liveHint", "Cập nhật trực tiếp qua socket")
                  : t("alarmKpi.pollHint", "Socket offline — đang dùng poll dự phòng")}
              >
                {liveConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {liveConnected ? t("common.live", "Live") : t("common.polling", "Polling")}
              </span>
              <PollFreshness updatedAt={q.dataUpdatedAt} isFetching={q.isFetching} />
              <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {t("alarmKpi.windowHours", "{{h}} giờ qua", { h })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {q.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!q.isLoading && data && (
          <>
            {/* ── Banner cảnh báo ISA-18.2 (chỉ hiện khi có vi phạm) ─────────────── */}
            {data.breaches.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{t("alarmKpi.breach.title", "Vượt ngưỡng ISA-18.2")}</p>
                  <ul className="mt-1 list-disc pl-5 text-destructive/90">
                    {data.breaches.includes("rate") && (
                      <li>{t("alarmKpi.breach.rate", "Tần suất báo động vượt {{max}}/giờ/operator", { max: 12 })}</li>
                    )}
                    {data.breaches.includes("flood") && (
                      <li>{t("alarmKpi.breach.flood", "Có giai đoạn ngập báo động (>10 alarm / 10 phút)")}</li>
                    )}
                    {data.breaches.includes("standing") && (
                      <li>{t("alarmKpi.breach.standing", "Quá nhiều báo động tồn đọng (≥5)")}</li>
                    )}
                    {data.breaches.includes("distribution") && (
                      <li>{t("alarmKpi.breach.distribution", "Tỉ lệ báo động mức cao vượt xa mục tiêu 5%")}</li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {/* ── KPI strip ──────────────────────────────────────────────────────── */}
            <StatChipRow>
              <StatChip
                icon={<Bell className="size-3.5" />}
                label={t("alarmKpi.kpi.total", "Tổng báo động")}
                value={data.totalAlarms}
              />
              <StatChip
                icon={<Gauge className="size-3.5" />}
                label={t("alarmKpi.kpi.ratePerOp", "Alarm/giờ/operator")}
                value={data.rate.alarmsPerHourPerOperator}
                tone={statusTone(data.rate.status)}
                title={t("alarmKpi.kpi.ratePerOpHint", "Mục tiêu ≤6, trần ≤12 (ISA-18.2)")}
              />
              <StatChip
                icon={<Activity className="size-3.5" />}
                label={t("alarmKpi.kpi.ratePerHour", "Alarm/giờ")}
                value={data.rate.alarmsPerHour}
              />
              <StatChip
                icon={<AlarmClock className="size-3.5" />}
                label={t("alarmKpi.kpi.floodPeak", "Đỉnh 10 phút")}
                value={data.flood.maxInWindow}
                tone={data.flood.isFlooding ? "error" : "default"}
                title={t("alarmKpi.kpi.floodHint", "Số alarm lớn nhất trong 1 cửa sổ 10 phút (flood khi >10)")}
              />
              <StatChip
                icon={<Layers className="size-3.5" />}
                label={t("alarmKpi.kpi.standing", "Báo động tồn đọng")}
                value={data.standing.count}
                tone={data.standing.status === "warning" ? "warning" : "default"}
                title={t("alarmKpi.kpi.standingHint", "Chưa xử lý > {{h}}h (mục tiêu <5)", { h: data.standing.thresholdHours })}
              />
              <StatChip
                icon={<ShieldAlert className="size-3.5" />}
                label={t("alarmKpi.kpi.operators", "Operator")}
                value={data.operatorCount}
              />
            </StatChipRow>

            <div className="grid gap-6 xl:grid-cols-2">
              {/* ── Phân bố ưu tiên vs mục tiêu 80/15/5 ─────────────────────────── */}
              <SectionCard
                title={t("alarmKpi.dist.title", "Phân bố ưu tiên")}
                description={t("alarmKpi.dist.desc", "Mục tiêu ISA-18.2: ~80% thấp · 15% trung bình · 5% cao")}
              >
                <div className="space-y-3">
                  {(["low", "medium", "high"] as const).map((k) => {
                    const pct = data.distribution.percent[k];
                    const target = data.distribution.target[k];
                    const tone = k === "high" ? "bg-destructive" : k === "medium" ? "bg-warning" : "bg-success";
                    return (
                      <div key={k} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">
                            {t(`alarmKpi.priority.${k}`, k)}{" "}
                            <span className="text-muted-foreground">({data.distribution.counts[k]})</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {pct}% · {t("alarmKpi.dist.target", "mục tiêu {{target}}%", { target })}
                          </span>
                        </div>
                        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full transition-all", tone)}
                            style={{ width: `${Math.min(100, (pct / distMax) * 100)}%` }}
                          />
                          {/* vạch mục tiêu */}
                          <div
                            className="absolute top-0 h-full w-0.5 bg-foreground/40"
                            style={{ left: `${Math.min(100, (target / distMax) * 100)}%` }}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("alarmKpi.sourceCounts", "Nguồn: {{andon}} Andon · {{pred}} cảnh báo AI", {
                    andon: data.sourceCounts.andon,
                    pred: data.sourceCounts.predictive,
                  })}
                </p>
                {(() => {
                  // Sprint 5 §3 — số 0 phải tự giải thích, nếu không người dùng
                  // kết luận "AI hỏng rồi" (đúng thứ Wave 3 §6 đã cảnh báo).
                  const notice = pickOccurrenceLogNotice({
                    predictiveCount: data.sourceCounts.predictive,
                    occurrenceLog: data.occurrenceLog,
                    generatedAt: data.generatedAt,
                    windowHours,
                  });
                  if (!notice) return null;
                  const text =
                    notice.kind === "table-missing"
                      ? t("alarmKpi.emptyLog.tableMissing", "Nhật ký lần-tái-diễn chưa sẵn sàng (migration chưa chạy) — phần cảnh báo AI không được tính vào KPI.")
                      : notice.kind === "log-empty"
                        ? t("alarmKpi.emptyLog.empty", "Chưa ghi lần-tái-diễn nào kể từ khi bật tính năng. Số 0 nghĩa là chưa có dữ liệu, không phải nhà máy im lặng.")
                        : t("alarmKpi.emptyLog.younger", "Nhật ký bắt đầu ghi từ {{date}} — cửa sổ {{h}} giờ này bắt đầu trước mốc đó, phần trước không tồn tại.", {
                            date: new Date(notice.firstOccurredAt).toLocaleString(),
                            h: windowHours,
                          });
                  return <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{text}</p>;
                })()}
              </SectionCard>

              {/* ── Standing alarms (tồn đọng lâu nhất) ─────────────────────────── */}
              <SectionCard
                title={t("alarmKpi.standing.title", "Báo động tồn đọng lâu nhất")}
                description={t("alarmKpi.standing.desc", "Chưa xử lý quá {{h}} giờ", { h: data.standing.thresholdHours })}
              >
                {data.standing.worst.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("alarmKpi.standing.none", "Không có báo động tồn đọng — tốt.")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.standing.worst.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium" title={s.title}>
                            {s.title}
                          </span>
                          <span className="text-xs text-muted-foreground">{s.actorLabel ?? "—"}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-warning">
                          {t("alarmKpi.standing.age", "{{h}}h", { h: Math.round(s.ageHours) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* ── Top-10 bad actors ──────────────────────────────────────────────── */}
            <SectionCard
              title={t("alarmKpi.badActors.title", "Top thủ phạm báo động (bad actors)")}
              description={t("alarmKpi.badActors.desc", "Ít nguồn thường gây phần lớn báo động — ưu tiên xử lý gốc")}
            >
              {data.badActors.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("alarmKpi.badActors.none", "Chưa có báo động trong cửa sổ.")}
                </p>
              ) : (
                <div className="space-y-2">
                  {data.badActors.map((a, i) => (
                    <div key={a.actorKey} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="w-40 shrink-0 truncate text-sm" title={a.actorLabel}>
                        {a.actorLabel}
                      </span>
                      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-info"
                          style={{ width: `${Math.min(100, a.percent)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {a.count} · {a.percent}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        )}

        {!q.isLoading && !data && (
          <EmptyState
            icon={Bell}
            title={t("alarmKpi.empty.title", "Chưa có dữ liệu cảnh báo")}
            description={t("alarmKpi.empty.desc", "Chưa ghi nhận Andon/cảnh báo AI nào trong cửa sổ đã chọn.")}
          />
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
