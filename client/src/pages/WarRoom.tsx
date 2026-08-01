/**
 * WarRoom — "Giao ban 7h" theo ca (doc 40 Wave 4c §11 · persona quản đốc/quản lý).
 *
 * One-pager giao ban: chọn Ca + Ngày (+ Nhà máy khi >1), rồi đọc trong 1 màn:
 *   1. KPI strip gọn (StatChip): OEE nhà máy · Output/Plan · NG rate · Sự cố dừng.
 *   2. Bảng OEE theo LINE (Line × A/P/Q/OEE/Output/Plan%/NG) — thứ quản đốc hỏi #1;
 *      màu theo ngưỡng OEE (≥80 tốt · ≥60 cảnh báo · <60 kém · null = "—" trung thực).
 *   3. Top-5 máy dừng nhiều nhất (gộp topDowntime của mọi line).
 *   4. So sánh giữa các ca (shiftCompare) + Kế hoạch vs Thực tế theo line (progress).
 *
 * Dữ liệu THẬT — honest-null: mọi số chưa có nguồn hiển thị "—" (KHÔNG bịa 0/random).
 * Nguồn duy nhất: trpc.warRoom.briefing (agent A). Realtime nhẹ: refetch 60s.
 * Chế độ TV/toàn màn hình (useFullscreen) để chiếu bảng giao ban lên màn lớn.
 * Xuất PDF/Excel/HTML qua <ReportExportButton>. Theme-aware, nhãn tiếng Việt (i18n
 * fallback trực tiếp — key hoãn sang đợt i18n, theo tiền lệ Feeder/ECN/NCR).
 *
 * RBAC: route gate machine_status (App.tsx). Trang chỉ đọc — không mutation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Gauge,
  PackageCheck,
  AlertTriangle,
  Wrench,
  Maximize2,
  Minimize2,
  RefreshCw,
  CalendarDays,
  Clock,
  Factory as FactoryIcon,
  TrendingUp,
  Wifi,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import {
  useEcosystemEvents,
  type EcosystemEvent,
  type EcosystemKind,
} from "@/hooks/useEcosystemEvents";
import ReportExportButton, {
  type ReportExportConfig,
} from "@/components/ReportExportButton";
import { StatChip, StatChipRow } from "@/components/patterns";
import { useFullscreen } from "@/hooks/useFullscreen";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportMenu } from "@/components/ExportMenu";
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
import { cn } from "@/lib/utils";

// ── Kiểu theo HỢP ĐỒNG liên-agent (agent A · trpc.warRoom.briefing) ──────────
interface DowntimeEntry {
  machineCode: string;
  minutes: number;
  reason: string;
}
interface WarRoomLine {
  lineId: number;
  lineName: string;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  output: number;
  planTarget: number | null;
  ngRate: number | null;
  topDowntime: DowntimeEntry[];
}
interface ShiftCompareRow {
  shiftLabel: string;
  oee: number | null;
  output: number;
  ngRate: number | null;
}
interface PlanVsActualRow {
  lineName: string;
  expected: number;
  actual: number;
  pct: number | null;
}
interface WarRoomBriefing {
  asOf: string;
  lines: WarRoomLine[];
  shiftCompare: ShiftCompareRow[];
  planVsActual: PlanVsActualRow[];
}

// ── Kiểu tối giản cho shiftConfig / factory (đọc phòng thủ) ───────────────────
interface ShiftOption {
  id: number;
  name: string;
  code?: string | null;
}
interface FactoryOption {
  id: number;
  name: string;
}

type Tone = "default" | "success" | "warning" | "error";

/** Ngưỡng OEE → tone semantic (≥80 tốt · ≥60 cảnh báo · <60 kém · null trung tính). */
function oeeTone(v: number | null | undefined): Tone {
  if (v == null) return "default";
  if (v >= 80) return "success";
  if (v >= 60) return "warning";
  return "error";
}

const TONE_TEXT: Record<Tone, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

/** Hiển thị % trung thực: null → "—", ngược lại "NN.n%". */
function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
/** Số nguyên có phân tách nghìn; null → "—". */
function num(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("vi-VN");
}

/** Ngày hôm nay ở dạng YYYY-MM-DD (local) cho <input type="date">. */
function todayLocalISODate(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/**
 * Các loại sự kiện U1 (ecosystem:event) ẢNH HƯỞNG tới số liệu giao ban:
 * OEE, dừng máy, và cảnh báo kiểm tra/NG/năng suất/andon. Khi một trong các sự kiện
 * này tới, ta invalidate warRoom.briefing để làm mới (debounce để tránh refetch dồn).
 * Chỉ dùng các kind THẬT có trong luồng UNIFIED_STREAM_TYPES của server.
 */
const WAR_ROOM_EVENT_KINDS: ReadonlySet<EcosystemKind> = new Set<EcosystemKind>([
  "oee",
  "downtime",
  "inspection",
  "ng",
  "yield",
  "andon",
]);

export default function WarRoom() {
  const { t } = useTranslation();

  // ── Bộ lọc giao ban ──
  const [dateStr, setDateStr] = useState<string>(() => todayLocalISODate());
  const [shiftId, setShiftId] = useState<number | undefined>(undefined);
  const [factoryId, setFactoryId] = useState<number | undefined>(undefined);

  const fs = useFullscreen();

  // ── Dropdown data ──
  const shiftsQ = trpc.shiftConfig.list.useQuery(
    factoryId != null ? { factoryId } : undefined,
  ) as unknown as { data?: ShiftOption[] };
  const factoriesQ = trpc.factory.list.useQuery() as unknown as {
    data?: FactoryOption[];
  };
  const shifts = shiftsQ.data ?? [];
  const factories = factoriesQ.data ?? [];

  // ISO của ngày đã chọn (đầu ngày local). Contract nhận date?(ISO).
  const dateIso = useMemo(() => {
    const d = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }, [dateStr]);

  // ── Briefing (nguồn dữ liệu THẬT duy nhất) ──
  // Realtime: ưu tiên socket U1 (invalidate on-event, debounce ~1.5s) — xem bên dưới.
  // Poll 120s GIỮ LẠI làm backstop: nếu socket rớt, bảng vẫn tự làm mới, không đứng số.
  const briefingQ = trpc.warRoom.briefing.useQuery(
    { factoryId, date: dateIso, shiftConfigId: shiftId },
    { refetchInterval: 120_000 },
  ) as unknown as {
    data?: WarRoomBriefing;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  };
  const briefing = briefingQ.data;

  // doc 46 FE-W2 — font-safe export dataset (per-line shift briefing → server render VN/EN/ZH).
  const briefingExportData = useMemo(
    () =>
      (briefing?.lines ?? []).map((l) => ({
        line: l.lineName,
        oee: l.oee,
        availability: l.availability,
        performance: l.performance,
        quality: l.quality,
        output: l.output ?? 0,
        planTarget: l.planTarget,
        ngRate: l.ngRate,
      })),
    [briefing],
  );
  const briefingExportColumns = useMemo(
    () => [
      { key: "line", header: t("warRoom.export.line", "Chuyền"), format: "text" as const },
      { key: "oee", header: "OEE", format: "percentage" as const },
      { key: "availability", header: t("warRoom.export.availability", "Sẵn sàng"), format: "percentage" as const },
      { key: "performance", header: t("warRoom.export.performance", "Hiệu suất"), format: "percentage" as const },
      { key: "quality", header: t("warRoom.export.quality", "Chất lượng"), format: "percentage" as const },
      { key: "output", header: t("warRoom.export.output", "Sản lượng"), format: "number" as const },
      { key: "planTarget", header: t("warRoom.export.plan", "Kế hoạch"), format: "number" as const },
      { key: "ngRate", header: t("warRoom.export.ngRate", "Tỷ lệ NG"), format: "percentage" as const },
    ],
    [t],
  );

  // ── Realtime U1: socket-first + poll-fallback ──────────────────────────────
  // Nghe luồng `ecosystem:event` (dùng chung 1 socket). Khi có sự kiện liên quan
  // (OEE/dừng máy/kiểm tra/NG/năng suất/andon) → invalidate briefing với debounce
  // ~1.5s để gộp nhiều delta thành 1 lần refetch (chống bão refetch).
  const utils = trpc.useUtils();
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBriefingRefresh = useCallback(() => {
    if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    invalidateTimer.current = setTimeout(() => {
      void utils.warRoom.briefing.invalidate();
    }, 1_500);
  }, [utils]);
  const onEcoEvent = useCallback(
    (evt: EcosystemEvent) => {
      if (WAR_ROOM_EVENT_KINDS.has(evt.kind)) scheduleBriefingRefresh();
    },
    [scheduleBriefingRefresh],
  );
  const { isConnected: liveConnected } = useEcosystemEvents({ onEvent: onEcoEvent });
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );

  // ── KPI nhà máy (tổng hợp từ line — output-weighted, honest-null) ──
  const kpi = useMemo(() => {
    const lines = briefing?.lines ?? [];
    let outSum = 0;
    let planSum = 0;
    let oeeWeighted = 0;
    let oeeWeight = 0;
    let ngWeighted = 0;
    let ngWeight = 0;
    let downtimeCount = 0;
    for (const l of lines) {
      outSum += l.output ?? 0;
      if (l.planTarget != null) planSum += l.planTarget;
      if (l.oee != null) {
        const w = l.output || 1;
        oeeWeighted += l.oee * w;
        oeeWeight += w;
      }
      if (l.ngRate != null) {
        const w = l.output || 1;
        ngWeighted += l.ngRate * w;
        ngWeight += w;
      }
      downtimeCount += l.topDowntime?.length ?? 0;
    }
    return {
      oee: oeeWeight > 0 ? oeeWeighted / oeeWeight : null,
      output: outSum,
      planTarget: planSum > 0 ? planSum : null,
      ngRate: ngWeight > 0 ? ngWeighted / ngWeight : null,
      downtimeCount,
    };
  }, [briefing]);

  // ── Top-5 máy dừng (gộp topDowntime mọi line, sort giảm dần theo phút) ──
  const topDowntime = useMemo(() => {
    const all: (DowntimeEntry & { lineName: string })[] = [];
    for (const l of briefing?.lines ?? []) {
      for (const d of l.topDowntime ?? []) {
        all.push({ ...d, lineName: l.lineName });
      }
    }
    return all.sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 5);
  }, [briefing]);

  const activeShiftLabel =
    shiftId == null
      ? t("warRoom.allShifts", "Tất cả ca")
      : shifts.find((s) => s.id === shiftId)?.name ??
        t("warRoom.shift", "Ca");
  const activeFactoryLabel =
    factoryId == null
      ? t("warRoom.allFactories", "Tất cả nhà máy")
      : factories.find((f) => f.id === factoryId)?.name ?? "";

  // ── Cấu hình xuất báo cáo (PDF/Excel/HTML) ──
  const buildExportConfig = (): ReportExportConfig => {
    const lines = briefing?.lines ?? [];
    return {
      title: t("warRoom.title", "Giao ban theo ca (War-room)"),
      subtitle: `${activeFactoryLabel} · ${activeShiftLabel} · ${dateStr}`,
      filenamePrefix: "war-room-giao-ban",
      orientation: "landscape",
      scope: {
        factory: activeFactoryLabel || undefined,
        shift: activeShiftLabel,
        dateRange: dateStr,
      },
      sections: [
        {
          title: t("warRoom.kpiStrip", "Chỉ số giao ban"),
          type: "stats",
          stats: [
            { label: t("warRoom.kpiOee", "OEE nhà máy"), value: pct(kpi.oee) },
            { label: t("warRoom.kpiOutput", "Sản lượng"), value: num(kpi.output) },
            { label: t("warRoom.kpiPlan", "Kế hoạch"), value: num(kpi.planTarget) },
            { label: t("warRoom.kpiNg", "Tỷ lệ NG"), value: pct(kpi.ngRate) },
            { label: t("warRoom.kpiIssues", "Sự cố dừng"), value: String(kpi.downtimeCount) },
          ],
        },
        {
          title: t("warRoom.oeeByLine", "OEE theo Line"),
          type: "table",
          tableHeaders: [
            "Line",
            "A%",
            "P%",
            "Q%",
            "OEE%",
            t("warRoom.output", "Sản lượng"),
            "Plan%",
            "NG%",
          ],
          tableRows: lines.map((l) => [
            l.lineName,
            pct(l.availability),
            pct(l.performance),
            pct(l.quality),
            pct(l.oee),
            num(l.output),
            l.planTarget && l.planTarget > 0
              ? `${Math.round((l.output / l.planTarget) * 100)}%`
              : "—",
            pct(l.ngRate),
          ]),
        },
        {
          title: t("warRoom.topDowntime", "Top máy dừng"),
          type: "table",
          tableHeaders: [
            t("warRoom.machine", "Máy"),
            "Line",
            t("warRoom.minutes", "Phút dừng"),
            t("warRoom.reason", "Nguyên nhân"),
          ],
          tableRows: topDowntime.map((d) => [
            d.machineCode,
            d.lineName,
            String(Math.round(d.minutes)),
            d.reason,
          ]),
        },
        {
          title: t("warRoom.shiftCompare", "So sánh giữa các ca"),
          type: "table",
          tableHeaders: [
            t("warRoom.shift", "Ca"),
            "OEE%",
            t("warRoom.output", "Sản lượng"),
            "NG%",
          ],
          tableRows: (briefing?.shiftCompare ?? []).map((s) => [
            s.shiftLabel,
            pct(s.oee),
            num(s.output),
            pct(s.ngRate),
          ]),
        },
      ],
    };
  };

  // Lớp phủ toàn màn hình khi Fullscreen API bị chặn (fallback overlay).
  const fsOverlay =
    fs.isFullscreen && fs.usingFallback
      ? "fixed inset-0 z-50 overflow-auto bg-background p-4"
      : "";

  return (
    <DashboardLayout
      title={t("warRoom.title", "Giao ban theo ca (War-room)")}
      navItems={navItems}
      currentPath="/war-room"
    >
      <div ref={fs.ref} className={cn("flex flex-col gap-3", fsOverlay)}>
        {/* ── Thanh điều khiển: Ca · Ngày · Nhà máy · TV · Xuất · Làm mới ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Select
              value={shiftId == null ? "all" : String(shiftId)}
              onValueChange={(v) => setShiftId(v === "all" ? undefined : Number(v))}
            >
              <SelectTrigger className="h-8 w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("warRoom.allShifts", "Tất cả ca")}</SelectItem>
                {shifts.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              max={todayLocalISODate()}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              aria-label={t("warRoom.date", "Ngày giao ban")}
            />
          </div>

          {factories.length > 1 && (
            <div className="flex items-center gap-1.5">
              <FactoryIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Select
                value={factoryId == null ? "all" : String(factoryId)}
                onValueChange={(v) => {
                  setFactoryId(v === "all" ? undefined : Number(v));
                  setShiftId(undefined); // ca phụ thuộc nhà máy → reset
                }}
              >
                <SelectTrigger className="h-8 w-[12rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("warRoom.allFactories", "Tất cả nhà máy")}</SelectItem>
                  {factories.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* doc 46 FE-W2 — font-safe multi-language export of the shift briefing. */}
            <ExportMenu
              type="war_room_briefing"
              title={t("warRoom.title", "Giao ban theo ca (War-room)")}
              subtitle={briefing?.asOf ? new Date(briefing.asOf).toLocaleString("vi-VN") : undefined}
              columns={briefingExportColumns}
              data={briefingExportData}
              fileName="war-room-briefing"
              disabled={briefingQ.isLoading || briefingExportData.length === 0}
            />
            {liveConnected && (
              <span
                className="hidden items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success sm:inline-flex"
                title={t("warRoom.liveHint", "Cập nhật trực tiếp qua socket (poll 120s dự phòng)")}
              >
                <Wifi className="h-3 w-3" aria-hidden="true" />
                {t("warRoom.live", "TRỰC TIẾP")}
              </span>
            )}
            {briefing?.asOf && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t("warRoom.asOf", "Cập nhật")}:{" "}
                {new Date(briefing.asOf).toLocaleTimeString("vi-VN")}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => briefingQ.refetch()}
              aria-label={t("warRoom.refresh", "Làm mới")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("warRoom.refresh", "Làm mới")}</span>
            </Button>
            <ReportExportButton getConfig={buildExportConfig} />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={fs.toggle}
              aria-label={t("warRoom.tvMode", "Chế độ TV")}
            >
              {fs.isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{t("warRoom.tvMode", "Chế độ TV")}</span>
            </Button>
          </div>
        </div>

        {/* ── KPI strip (content-first, StatChip 1 dòng) ── */}
        <StatChipRow>
          <StatChip
            icon={<Gauge />}
            label={t("warRoom.kpiOee", "OEE nhà máy")}
            value={pct(kpi.oee)}
            tone={oeeTone(kpi.oee)}
          />
          <StatChip
            icon={<PackageCheck />}
            label={t("warRoom.kpiOutputVsPlan", "Sản lượng / KH")}
            value={
              kpi.planTarget != null
                ? `${num(kpi.output)} / ${num(kpi.planTarget)}`
                : num(kpi.output)
            }
            tone="default"
          />
          <StatChip
            icon={<AlertTriangle />}
            label={t("warRoom.kpiNg", "Tỷ lệ NG")}
            value={pct(kpi.ngRate)}
            tone={
              kpi.ngRate == null ? "default" : kpi.ngRate <= 2 ? "success" : kpi.ngRate <= 5 ? "warning" : "error"
            }
          />
          <StatChip
            icon={<Wrench />}
            label={t("warRoom.kpiIssues", "Sự cố dừng")}
            value={String(kpi.downtimeCount)}
            tone={kpi.downtimeCount > 0 ? "warning" : "default"}
          />
        </StatChipRow>

        {/* ── Bảng OEE theo LINE (thứ quản đốc hỏi #1) ── */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" />
              {t("warRoom.oeeByLine", "OEE theo Line")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AsyncBoundary
              isLoading={briefingQ.isLoading}
              isError={briefingQ.isError}
              error={briefingQ.error}
              isEmpty={(briefing?.lines?.length ?? 0) === 0}
              onRetry={briefingQ.refetch}
              preset="table"
              errorTitle={t("warRoom.loadError", "Không tải được dữ liệu giao ban")}
              retryLabel={t("warRoom.refresh", "Làm mới")}
              emptyState={
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("warRoom.noLineData", "Chưa có dữ liệu OEE cho ca/ngày đã chọn")}
                </div>
              }
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">A%</TableHead>
                      <TableHead className="text-right">P%</TableHead>
                      <TableHead className="text-right">Q%</TableHead>
                      <TableHead className="text-right">OEE%</TableHead>
                      <TableHead className="text-right">{t("warRoom.output", "Sản lượng")}</TableHead>
                      <TableHead className="text-right">Plan%</TableHead>
                      <TableHead className="text-right">NG%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(briefing?.lines ?? []).map((l) => {
                      const planPct =
                        l.planTarget && l.planTarget > 0
                          ? Math.round((l.output / l.planTarget) * 100)
                          : null;
                      return (
                        <TableRow key={l.lineId}>
                          <TableCell className="font-medium">{l.lineName}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(l.availability)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(l.performance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(l.quality)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-semibold tabular-nums",
                              TONE_TEXT[oeeTone(l.oee)],
                            )}
                          >
                            {pct(l.oee)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{num(l.output)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              planPct == null
                                ? "text-muted-foreground"
                                : planPct >= 100
                                  ? "text-success"
                                  : planPct >= 80
                                    ? "text-warning"
                                    : "text-destructive",
                            )}
                          >
                            {planPct == null ? "—" : `${planPct}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{pct(l.ngRate)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </AsyncBoundary>
          </CardContent>
        </Card>

        {/* ── Lưới 2 cột: Top-5 dừng máy · So sánh ca ── */}
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Top-5 máy dừng */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {t("warRoom.topDowntimeTitle", "Top 5 máy dừng nhiều nhất")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {topDowntime.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {briefingQ.isLoading
                    ? t("warRoom.loading", "Đang tải…")
                    : t("warRoom.noDowntime", "Không có sự cố dừng máy trong ca")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("warRoom.machine", "Máy")}</TableHead>
                        <TableHead>Line</TableHead>
                        <TableHead className="text-right">{t("warRoom.minutes", "Phút dừng")}</TableHead>
                        <TableHead>{t("warRoom.reason", "Nguyên nhân")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topDowntime.map((d, i) => (
                        <TableRow key={`${d.machineCode}-${i}`}>
                          <TableCell className="font-medium">{d.machineCode}</TableCell>
                          <TableCell className="text-muted-foreground">{d.lineName}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-destructive">
                            {Math.round(d.minutes)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{d.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* So sánh giữa các ca */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-info" />
                {t("warRoom.shiftCompare", "So sánh giữa các ca")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(briefing?.shiftCompare?.length ?? 0) === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {briefingQ.isLoading
                    ? t("warRoom.loading", "Đang tải…")
                    : t("warRoom.noShiftCompare", "Chưa có dữ liệu so sánh ca")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("warRoom.shift", "Ca")}</TableHead>
                        <TableHead className="text-right">OEE%</TableHead>
                        <TableHead className="text-right">{t("warRoom.output", "Sản lượng")}</TableHead>
                        <TableHead className="text-right">NG%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(briefing?.shiftCompare ?? []).map((s, i) => (
                        <TableRow key={`${s.shiftLabel}-${i}`}>
                          <TableCell className="font-medium">{s.shiftLabel}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-semibold tabular-nums",
                              TONE_TEXT[oeeTone(s.oee)],
                            )}
                          >
                            {pct(s.oee)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{num(s.output)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(s.ngRate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Kế hoạch vs Thực tế theo Line (progress bar) ── */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4 text-primary" />
              {t("warRoom.planVsActual", "Kế hoạch vs Thực tế theo Line")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(briefing?.planVsActual?.length ?? 0) === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {briefingQ.isLoading
                  ? t("warRoom.loading", "Đang tải…")
                  : t("warRoom.noPlan", "Chưa có kế hoạch cho ca/ngày đã chọn")}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {(briefing?.planVsActual ?? []).map((row, i) => {
                  const p = row.pct;
                  const clamped = p == null ? 0 : Math.max(0, Math.min(100, p));
                  const barTone =
                    p == null
                      ? "bg-muted-foreground/40"
                      : p >= 100
                        ? "bg-success"
                        : p >= 80
                          ? "bg-warning"
                          : "bg-destructive";
                  return (
                    <div key={`${row.lineName}-${i}`} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{row.lineName}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {num(row.actual)} / {num(row.expected)}
                          {p != null && (
                            <span
                              className={cn(
                                "ml-2 font-semibold",
                                p >= 100
                                  ? "text-success"
                                  : p >= 80
                                    ? "text-warning"
                                    : "text-destructive",
                              )}
                            >
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
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
