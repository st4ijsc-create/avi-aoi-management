/**
 * AIToolResultCard
 *
 * Renders structured real-time tool results returned by the local AI tool
 * registry. Dispatches by `type` to a small dedicated card.
 */

import { useRef } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, HardDrive, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
// ★★★ 2026-08-23 · LÔ 3 — chip bằng chứng "byte thật từ đĩa" cho thẻ đọc tệp (xem khối docblock
// tại chỗ render); hai vị từ THUẦN sống ở `@/lib/soKhoiMa` để lưới + trang dùng chung một bản.
import { dinhDangLucNhan, laKetQuaDocTuDia } from "@/lib/soKhoiMa";

export type ToolResultPayload =
  | {
      type: "today_stats";
      title: string;
      data: {
        date: string;
        total: number;
        ok: number;
        ng: number;
        ntf: number;
        ngRate: number;
        byMachine: Array<{ machineId: number; machineName: string; total: number; ng: number; ngRate: number }>;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "lot_status";
      title: string;
      data: {
        orderCode: string;
        status: string;
        targetQuantity: number;
        completedQuantity: number;
        okQuantity: number;
        ngQuantity: number;
        ntfQuantity: number;
        progressPct: number;
        ngRate: number;
      } | null;
      textSummary: string;
      note?: string;
    }
  | {
      type: "machine_status";
      title: string;
      data: Array<{
        id: number;
        code: string;
        name: string;
        type: string;
        operationStatus: string;
        isOnline: boolean;
        lastHeartbeat: string | null;
        minutesSinceHeartbeat: number | null;
      }>;
      textSummary: string;
      note?: string;
    }
  | {
      type: "defect_trend";
      title: string;
      data: {
        days: number;
        series: Array<{ date: string; total: number; ng: number; ngRate: number }>;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "top_defects";
      title: string;
      data: Array<{
        pointCode: string;
        pointName: string;
        ngCount: number;
        totalCount: number;
        ngRate: number;
      }>;
      textSummary: string;
      note?: string;
    }
  // ── Sprint F6 line-monitoring tools (shapes mirror handlersF6.ts /
  //    insightHandlersF6.ts exactly) ─────────────────────────────────────────
  | {
      type: "process_result";
      title: string;
      data: {
        rows: Array<{
          serialNumber: string;
          machineId: number;
          stepType: string;
          result: string;
          measuredAt: string;
          metrics: Record<string, unknown> | null;
        }>;
        summary: { pass: number; fail: number; warn: number; skip: number; failRate: number };
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "process_metric_trend";
      title: string;
      data: {
        metricKey: string;
        source: "process" | "telemetry";
        bucket: "hour" | "day";
        series: Array<{ ts: number; value: number }>;
        trend: "increasing" | "decreasing" | "stable";
        mean: number;
        anomalyCount: number;
        forecastNext: number | null;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "line_balance";
      title: string;
      data: {
        lineId: number;
        periodStart: string | null;
        taktTimeMs: number | null;
        avgCycleTimeMs: number | null;
        maxCycleTimeMs: number | null;
        utilizationPct: number | null;
        balanceRatePct: number | null;
        wipCount: number;
        topStarved: { stationId: number; avgStarvedMs: number } | null;
        topBlocked: { stationId: number; avgBlockedMs: number } | null;
      } | null;
      textSummary: string;
      note?: string;
    }
  | {
      type: "throughput";
      title: string;
      data: {
        bucket: "hour" | "day";
        series: Array<{ ts: number; value: number }>;
        totalPass: number;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "palletizer_status";
      title: string;
      data: {
        machineId: number | null;
        machineCode: string | null;
        operationStatus: string | null;
        lastHeartbeat: string | null;
        latestTelemetry: Array<{ tagKey: string; value: number | string | null; unit: string | null; ts: string }>;
        latestResult: { result: string; measuredAt: string } | null;
      } | null;
      textSummary: string;
      note?: string;
    }
  | {
      type: "ot_telemetry";
      title: string;
      data: {
        rows: Array<{
          tagKey: string;
          value: number | string | null;
          unit: string | null;
          quality: string;
          ts: string;
        }>;
      };
      textSummary: string;
      note?: string;
    }
  | {
      type: "line_insight";
      title: string;
      data: {
        lineId: number;
        points: number;
        cycleTrend: "increasing" | "decreasing" | "stable";
        wipTrend: "increasing" | "decreasing" | "stable";
        latestMaxCycleMs: number | null;
        taktTimeMs: number | null;
        forecastMaxCycleMs: number | null;
        taktBreachForecast: boolean;
      } | null;
      textSummary: string;
      note?: string;
    }
  | {
      type: "correlation_insight";
      title: string;
      data: {
        upstreamStepType: string;
        downstreamStepType: string | null;
        metricKey: string;
        paired: number;
        pearson: number | null;
        failBins: Array<{ range: string; count: number; fail: number; failRate: number }>;
      } | null;
      textSummary: string;
      note?: string;
    };

/** A render-friendly row shape carried by newer tools' `data.rows`. */
interface GenericRow {
  label: string;
  value: string;
}

/**
 * Extract a render-friendly `rows: Array<{label,value}>` from an arbitrary tool
 * `data` payload (server-only types like Phase P2 read tools include it). Returns
 * null when the shape isn't present so the caller falls back to textSummary.
 */
function extractGenericRows(data: unknown): GenericRow[] | null {
  if (!data || typeof data !== "object") return null;
  const rows = (data as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ok = rows.every(
    (r) => r && typeof r === "object" && typeof (r as any).label === "string" && typeof (r as any).value === "string",
  );
  return ok ? (rows as GenericRow[]) : null;
}

// Tool result types that have a dedicated card body below. Any other type
// (server-only types) falls back to textSummary.
const KNOWN_CARD_TYPES = new Set<string>([
  "today_stats",
  "lot_status",
  "machine_status",
  "defect_trend",
  "top_defects",
  // Sprint F6 line-monitoring tools.
  "process_result",
  "process_metric_trend",
  "line_balance",
  "throughput",
  "palletizer_status",
  "ot_telemetry",
  "line_insight",
  "correlation_insight",
]);

interface Props {
  toolResult: ToolResultPayload;
  /**
   * ★ LÔ 3 — mốc-NHẬN sự kiện tool (đã định dạng bằng `dinhDangLucNhan`), do trang đóng dấu lúc
   * nhận SSE. Truyền vào để chip bằng chứng ở đây và chip đối chiếu của khối mã (`KhoiMaCoNhan`)
   * nói CÙNG một mốc. Vắng ⇒ thẻ tự đóng dấu ở lần render đầu (vẫn là mốc-nhận, xem dưới).
   */
  lucNhan?: string;
}

export function AIToolResultCard({ toolResult, lucNhan }: Props) {
  const { t } = useTranslation();
  /**
   * ★★★ 2026-08-23 · LÔ 3 — CHIP BẰNG CHỨNG "Byte thật từ đĩa · {{luc}}" cho thẻ đọc tệp.
   *
   * Vì sao: ca đo buổi đóng vai — văn xuôi model chứa khối mã CÓ guard trong khi thẻ đọc ngay dưới
   * cho thấy tệp thật CHƯA có; người xem lại cần một dấu hiệu phân ĐẲNG CẤP nguồn: thẻ này là byte
   * ĐỌC TỪ ĐĨA, văn xuôi là lời MODEL. Chip chỉ gắn khi `data` mang đúng hình dạng một lượt đọc
   * thật (`laKetQuaDocTuDia` — bản đọc một tệp có `content`, hoặc thẻ tổng `{files:[…]}` của đường
   * sinh-mã); các lượt TỪ CHỐI của hộp cát mang `data` rỗng nên tự trượt vị từ ấy.
   *
   * ⚠ `luc` là MỐC-NHẬN (client), KHÔNG phải mốc-đọc (server): payload thẻ đọc không mang
   *   timestamp và lô này cấm đổi server để cõng thêm. Không có `lucNhan` từ trang ⇒ đóng dấu Ở
   *   LẦN RENDER ĐẦU qua ref (cùng nhịp với lượt nhận sự kiện) — ghi ref trong render là khởi tạo
   *   lười idempotent, không phải side-effect lặp.
   */
  const lucTuDongRef = useRef<string | null>(null);
  if (lucTuDongRef.current === null) lucTuDongRef.current = dinhDangLucNhan(new Date());
  const lucBangChung = lucNhan ?? lucTuDongRef.current;
  return (
    <div className="rounded-xl border border-primary/20 bg-background/80 p-2.5 space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Database className="size-3.5 text-primary" />
        <span className="font-semibold text-primary">{toolResult.title}</span>
        <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px]">Real-time</Badge>
      </div>

      {laKetQuaDocTuDia(toolResult.data as unknown) && (
        <div data-chip-bang-chung className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <HardDrive className="size-3 shrink-0" />
          <span>{t("repoWs.khoi.bangChung", "Byte thật từ đĩa · {{luc}}", { luc: lucBangChung })}</span>
        </div>
      )}

      {toolResult.note === "DB_UNAVAILABLE" && (
        <div className="flex items-center gap-1.5 text-amber-600">
          <AlertTriangle className="size-3" />
          <span>{t("aiToolResult.khongCoKetNoiCsdl", "Không có kết nối CSDL.")}</span>
        </div>
      )}

      {toolResult.note === "NOT_FOUND" && (
        <div className="text-muted-foreground italic">{toolResult.textSummary}</div>
      )}

      {toolResult.type === "today_stats" && toolResult.note !== "DB_UNAVAILABLE" && (
        <TodayStatsBody data={toolResult.data} />
      )}
      {toolResult.type === "lot_status" && toolResult.data && toolResult.note !== "DB_UNAVAILABLE" && (
        <LotStatusBody data={toolResult.data} />
      )}
      {toolResult.type === "machine_status" && toolResult.note !== "DB_UNAVAILABLE" && (
        <MachineStatusBody data={toolResult.data} />
      )}
      {toolResult.type === "defect_trend" && toolResult.note !== "DB_UNAVAILABLE" && (
        <DefectTrendBody data={toolResult.data} />
      )}
      {toolResult.type === "top_defects" && toolResult.note !== "DB_UNAVAILABLE" && (
        <TopDefectsBody data={toolResult.data} />
      )}

      {/* ── Sprint F6 cards ── */}
      {toolResult.type === "process_result" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <ProcessResultBody data={toolResult.data} />}
      {toolResult.type === "process_metric_trend" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <MetricTrendBody data={toolResult.data} />}
      {toolResult.type === "line_balance" &&
        toolResult.data &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <LineBalanceBody data={toolResult.data} />}
      {toolResult.type === "throughput" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <ThroughputBody data={toolResult.data} />}
      {toolResult.type === "palletizer_status" &&
        toolResult.data &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <PalletizerStatusBody data={toolResult.data} />}
      {toolResult.type === "ot_telemetry" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && <OtTelemetryBody data={toolResult.data} />}
      {toolResult.type === "line_insight" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && (
          <InsightTextBody textSummary={toolResult.textSummary} />
        )}
      {toolResult.type === "correlation_insight" &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" && (
          <InsightTextBody textSummary={toolResult.textSummary} />
        )}

      {/* Generic fallback: for any type without a dedicated card body, render a
          render-friendly `data.rows` (array of {label,value}) as a titled list
          when present; otherwise fall back to textSummary. Newer tools (e.g.
          Phase P2 work_order_list / alert_list / spec_limits / recipe_list)
          include a `rows` shape so they display cleanly without bespoke cards. */}
      {!KNOWN_CARD_TYPES.has(toolResult.type) &&
        toolResult.note !== "DB_UNAVAILABLE" &&
        toolResult.note !== "NOT_FOUND" &&
        (extractGenericRows(toolResult.data as unknown) ? (
          <GenericRowsBody rows={extractGenericRows(toolResult.data as unknown)!} textSummary={toolResult.textSummary} />
        ) : (
          // ★★★ 2026-08-23 · `break-words` — `whitespace-pre-line` GIỮ xuống dòng nhưng **không**
          //   cho phép ngắt trong một "từ" dài. `textSummary` ở đường mã nguồn chở đường dẫn tệp và
          //   băm sha256 — chuỗi không dấu cách. Nghiệm thu live đo được thẻ này rộng 542 px trong
          //   khung 400 px (`scrollWidth 588…754` vs `clientWidth 400`) ⇒ mất 188…354 px, không có
          //   thanh cuộn ngang nào để tới. `min-w-0` để nó co được khi là con của flex/grid.
          <div className="min-w-0 break-words whitespace-pre-line text-foreground/90">{toolResult.textSummary}</div>
        ))}
    </div>
  );
}

// ---- today_stats ----
function TodayStatsBody({ data }: { data: Extract<ToolResultPayload, { type: "today_stats" }>["data"] }) {
  const { t } = useTranslation();
  const ngColor = data.ngRate >= 5 ? "text-red-600" : data.ngRate >= 2 ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label={t("aiToolResult.tong", "Tổng")} value={data.total} icon={<Gauge className="size-3" />} />
        <Stat label="OK" value={data.ok} color="text-emerald-600" icon={<CheckCircle2 className="size-3" />} />
        <Stat label="NG" value={data.ng} color="text-red-600" icon={<XCircle className="size-3" />} />
        <Stat label="NTF" value={data.ntf} color="text-amber-600" icon={<AlertTriangle className="size-3" />} />
      </div>
      <div className={cn("flex items-center gap-1.5 font-medium", ngColor)}>
        <TrendingUp className="size-3" />
        Tỉ lệ NG: {data.ngRate}%
      </div>
      {data.byMachine.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[11px]">{t("aiToolResult.topMayNg", "Top máy NG:")}</div>
          {data.byMachine.slice(0, 3).map((m) => (
            <div key={m.machineId} className="flex items-center justify-between text-[11px]">
              <span className="truncate">{m.machineName}</span>
              <span className="text-red-600">{m.ng}/{m.total} ({m.ngRate}%)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- lot_status ----
function LotStatusBody({ data }: { data: NonNullable<Extract<ToolResultPayload, { type: "lot_status" }>["data"]> }) {
  const statusColor: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    in_progress: "bg-blue-100 text-blue-700",
    pending: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{data.orderCode}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", statusColor[data.status] ?? "bg-slate-100 text-slate-700")}>
          {data.status}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-[11px] mb-0.5">
          <span>{data.completedQuantity} / {data.targetQuantity}</span>
          <span className="font-medium">{data.progressPct}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, data.progressPct)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="OK" value={data.okQuantity} color="text-emerald-600" />
        <Stat label="NG" value={data.ngQuantity} color="text-red-600" />
        <Stat label="NTF" value={data.ntfQuantity} color="text-amber-600" />
      </div>
      <div className="text-[11px] text-muted-foreground">Tỉ lệ NG: {data.ngRate}%</div>
    </div>
  );
}

// ---- machine_status ----
function MachineStatusBody({ data }: { data: Extract<ToolResultPayload, { type: "machine_status" }>["data"] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return <div className="text-muted-foreground italic text-[11px]">{t("aiToolResult.khongCoMay", "Không có máy.")}</div>;
  }
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {data.slice(0, 12).map((m) => (
        <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              m.isOnline ? "bg-emerald-500" : "bg-slate-400",
            )}
            title={m.isOnline ? "Online" : "Offline"}
          />
          <span className="font-mono font-medium">{m.code}</span>
          <span className="text-muted-foreground truncate flex-1">{m.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1 text-[9px]",
              m.operationStatus === "running" && "border-emerald-300 text-emerald-700",
              m.operationStatus === "stopped" && "border-slate-300 text-slate-700",
              m.operationStatus === "error" && "border-red-300 text-red-700",
              m.operationStatus === "maintenance" && "border-amber-300 text-amber-700",
            )}
          >
            {m.operationStatus}
          </Badge>
        </div>
      ))}
      {data.length > 12 && (
        <div className="text-[10px] text-muted-foreground italic">… +{data.length - 12} máy nữa</div>
      )}
    </div>
  );
}

// ---- defect_trend ----
function DefectTrendBody({ data }: { data: Extract<ToolResultPayload, { type: "defect_trend" }>["data"] }) {
  const max = Math.max(1, ...data.series.map((s) => s.ngRate));
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-1 h-16">
        {data.series.map((s) => {
          const h = (s.ngRate / max) * 100;
          const color = s.ngRate >= 5 ? "bg-red-500" : s.ngRate >= 2 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={s.date} className="flex-1 flex flex-col items-center justify-end" title={`${s.date}: ${s.ngRate}% (${s.ng}/${s.total})`}>
              <div className={cn("w-full rounded-sm", color)} style={{ height: `${Math.max(4, h)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data.series[0]?.date.slice(5) ?? ""}</span>
        <span>{data.series[data.series.length - 1]?.date.slice(5) ?? ""}</span>
      </div>
    </div>
  );
}

// ---- top_defects ----
function TopDefectsBody({ data }: { data: Extract<ToolResultPayload, { type: "top_defects" }>["data"] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return <div className="text-muted-foreground italic text-[11px]">{t("aiToolResult.khongCoDiemDoNao", "Không có điểm đo nào lỗi.")}</div>;
  }
  return (
    <div className="space-y-1">
      {data.map((item, i) => (
        <div key={item.pointCode} className="flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-primary w-4">{i + 1}.</span>
          <div className="flex-1 min-w-0">
            <div className="font-mono font-medium truncate">{item.pointCode}</div>
            <div className="text-muted-foreground truncate text-[10px]">{item.pointName}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-red-600 font-medium">{item.ngCount}/{item.totalCount}</div>
            <div className="text-[10px] text-muted-foreground">{item.ngRate}%</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- F6: process_result ----
function ProcessResultBody({ data }: { data: Extract<ToolResultPayload, { type: "process_result" }>["data"] }) {
  const { t } = useTranslation();
  const s = data.summary;
  const failColor = s.failRate >= 5 ? "text-red-600" : s.failRate >= 2 ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Pass" value={s.pass} color="text-emerald-600" icon={<CheckCircle2 className="size-3" />} />
        <Stat label="Fail" value={s.fail} color="text-red-600" icon={<XCircle className="size-3" />} />
        <Stat label="Warn" value={s.warn} color="text-amber-600" icon={<AlertTriangle className="size-3" />} />
        <Stat label="Skip" value={s.skip} icon={<Activity className="size-3" />} />
      </div>
      <div className={cn("flex items-center gap-1.5 font-medium", failColor)}>
        <TrendingUp className="size-3" />
        Tỉ lệ fail: {s.failRate}%
      </div>
      {data.rows.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[11px]">{t("aiToolResult.banGhiGanNhat", "Bản ghi gần nhất:")}</div>
          {data.rows.slice(0, 5).map((r, i) => (
            <div key={`${r.serialNumber}-${i}`} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono truncate flex-1">{r.serialNumber}</span>
              <span className="text-muted-foreground truncate">{r.stepType}</span>
              <Badge variant="outline" className={cn("h-4 px-1 text-[9px] shrink-0", resultColor(r.result))}>
                {r.result}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function resultColor(result: string): string {
  const r = result.toLowerCase();
  if (r === "pass") return "border-emerald-300 text-emerald-700";
  if (r === "fail") return "border-red-300 text-red-700";
  if (r === "warn") return "border-amber-300 text-amber-700";
  return "border-slate-300 text-slate-700";
}

// ---- F6: process_metric_trend (sparkline) ----
function MetricTrendBody({ data }: { data: Extract<ToolResultPayload, { type: "process_metric_trend" }>["data"] }) {
  const { t } = useTranslation();
  const trendIcon =
    data.trend === "increasing" ? (
      <TrendingUp className="size-3 text-red-600" />
    ) : data.trend === "decreasing" ? (
      <TrendingDown className="size-3 text-emerald-600" />
    ) : (
      <Activity className="size-3 text-muted-foreground" />
    );
  const trendVi = data.trend === "increasing" ? t("aIToolResultCard.tang", "Tăng") : data.trend === "decreasing" ? t("aIToolResultCard.giam", "Giảm") : t("aIToolResultCard.onDinh", "Ổn định");
  const chartData = data.series.map((p) => ({ ts: p.ts, value: p.value }));
  return (
    <div className="space-y-2">
      {chartData.length >= 2 && (
        <div className="h-16 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="TB" value={data.mean} />
        <Stat label={t("aiToolResult.batThuong", "Bất thường")} value={data.anomalyCount} color={data.anomalyCount > 0 ? "text-amber-600" : undefined} />
        <Stat label={t("aiToolResult.duBao", "Dự báo")} value={data.forecastNext ?? 0} color="text-primary" />
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        {trendIcon}
        <span className="font-medium">Xu hướng: {trendVi}</span>
        <span className="text-muted-foreground ml-auto">
          {data.metricKey} · {data.series.length} điểm/{data.bucket}
        </span>
      </div>
    </div>
  );
}

// ---- F6: line_balance ----
function LineBalanceBody({ data }: { data: NonNullable<Extract<ToolResultPayload, { type: "line_balance" }>["data"]> }) {
  const { t } = useTranslation();
  const taktBreach =
    data.taktTimeMs != null && data.maxCycleTimeMs != null && data.maxCycleTimeMs > data.taktTimeMs;
  const ms = (v: number | null) => (v == null ? "?" : `${v}ms`);
  const pctV = (v: number | null) => (v == null ? "?" : `${v}%`);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        <LBCell label="Takt" value={ms(data.taktTimeMs)} />
        <LBCell label="Cycle TB" value={ms(data.avgCycleTimeMs)} />
        <LBCell label="Cycle max" value={ms(data.maxCycleTimeMs)} highlight={taktBreach} />
        <LBCell label={t("aiToolResult.heSoCb", "Hệ số CB")} value={pctV(data.balanceRatePct)} />
        <LBCell label={t("aiToolResult.suDung", "Sử dụng")} value={pctV(data.utilizationPct)} />
        <LBCell label="WIP" value={String(data.wipCount)} />
      </div>
      {taktBreach && (
        <div className="flex items-center gap-1.5 text-red-600 font-medium">
          <AlertTriangle className="size-3" />
          Cycle max vượt takt → có nút thắt.
        </div>
      )}
      {(data.topBlocked || data.topStarved) && (
        <div className="space-y-0.5 text-[11px]">
          {data.topBlocked && data.topBlocked.avgBlockedMs > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("aiToolResult.tramBiChanNhat", "Trạm bị chặn nhất")}</span>
              <span className="text-red-600">#{data.topBlocked.stationId} ({data.topBlocked.avgBlockedMs}ms)</span>
            </div>
          )}
          {data.topStarved && data.topStarved.avgStarvedMs > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("aiToolResult.tramThieuLieuNhat", "Trạm thiếu liệu nhất")}</span>
              <span className="text-amber-600">#{data.topStarved.stationId} ({data.topStarved.avgStarvedMs}ms)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LBCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-md bg-muted/60 px-1.5 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums", highlight && "text-red-600")}>{value}</div>
    </div>
  );
}

// ---- F6: throughput (mini bar, mirrors DefectTrendBody) ----
function ThroughputBody({ data }: { data: Extract<ToolResultPayload, { type: "throughput" }>["data"] }) {
  const max = Math.max(1, ...data.series.map((s) => s.value));
  return (
    <div className="space-y-1.5">
      {data.series.length > 0 && (
        <div className="flex items-end gap-0.5 h-16">
          {data.series.map((s) => {
            const h = (s.value / max) * 100;
            return (
              <div
                key={s.ts}
                className="flex-1 flex flex-col items-center justify-end"
                title={`${new Date(s.ts).toISOString().slice(0, 16)}: ${s.value}`}
              >
                <div className="w-full rounded-sm bg-primary" style={{ height: `${Math.max(4, h)}%` }} />
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{data.series.length} {data.bucket} hoạt động</span>
        <span className="font-semibold text-emerald-600">Tổng pass: {data.totalPass}</span>
      </div>
    </div>
  );
}

// ---- F6: palletizer_status ----
function PalletizerStatusBody({
  data,
}: {
  data: NonNullable<Extract<ToolResultPayload, { type: "palletizer_status" }>["data"]>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px]">
        {data.machineCode && <span className="font-mono font-medium">{data.machineCode}</span>}
        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {data.operationStatus ?? "?"}
        </Badge>
        <span className="text-muted-foreground ml-auto">
          {data.lastHeartbeat ? data.lastHeartbeat.slice(0, 16) : t("aIToolResultCard.khongCoHeartbeat", "không có heartbeat")}
        </span>
      </div>
      {data.latestResult && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">{t("aiToolResult.ketQuaGanNhat", "Kết quả gần nhất:")}</span>
          <Badge variant="outline" className={cn("h-4 px-1 text-[9px]", resultColor(data.latestResult.result))}>
            {data.latestResult.result}
          </Badge>
          <span className="text-muted-foreground">{data.latestResult.measuredAt.slice(0, 16)}</span>
        </div>
      )}
      {data.latestTelemetry.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[11px]">Telemetry:</div>
          {data.latestTelemetry.slice(0, 6).map((t, i) => (
            <div key={`${t.tagKey}-${i}`} className="flex items-center justify-between text-[11px]">
              <span className="font-mono truncate">{t.tagKey}</span>
              <span className="tabular-nums">
                {t.value ?? "?"}
                {t.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground italic text-[11px]">{t("aiToolResult.chuaCoTelemetry", "Chưa có telemetry.")}</div>
      )}
    </div>
  );
}

// ---- F6: ot_telemetry ----
function OtTelemetryBody({ data }: { data: Extract<ToolResultPayload, { type: "ot_telemetry" }>["data"] }) {
  const { t } = useTranslation();
  if (data.rows.length === 0) {
    return <div className="text-muted-foreground italic text-[11px]">{t("aiToolResult.khongCoTelemetry", "Không có telemetry.")}</div>;
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-[10px] text-muted-foreground border-b border-border/50 pb-0.5">
        <span>Tag</span>
        <span className="text-right">{t("aiToolResult.giaTri", "Giá trị")}</span>
        <span className="text-right">Quality</span>
      </div>
      {data.rows.map((r, i) => (
        <div key={`${r.tagKey}-${i}`} className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] items-center">
          <span className="font-mono truncate">{r.tagKey}</span>
          <span className="text-right tabular-nums">
            {r.value ?? "?"}
            {r.unit ?? ""}
          </span>
          <span
            className={cn(
              "text-right text-[10px]",
              r.quality.toLowerCase() === "good" ? "text-emerald-600" : "text-amber-600",
            )}
          >
            {r.quality}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- F6: line_insight / correlation_insight (structured text narrative) ----
function InsightTextBody({ textSummary }: { textSummary: string }) {
  // The insight handlers build a multi-section Vietnamese narrative joined by
  // "\n" with [Hiện trạng]/[Dự báo]/[ĐỀ XUẤT]/[Phân bố lỗi …] markers. Render
  // each line as a block; bold the leading [marker] for readability.
  const lines = textSummary.split("\n").filter((l) => l.trim().length > 0);
  return (
    <div className="space-y-1.5 text-foreground/90">
      {lines.map((line, i) => {
        const m = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
        if (m) {
          const isAdvice = /đề xuất/i.test(m[1]);
          return (
            <div key={i} className="text-[11px] leading-relaxed">
              <span className={cn("font-semibold", isAdvice ? "text-primary" : "text-foreground")}>[{m[1]}]</span>{" "}
              <span>{m[2]}</span>
            </div>
          );
        }
        return (
          <div key={i} className="text-[11px] leading-relaxed">
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ---- generic fallback: titled label/value list (Phase P2 read tools etc.) ----
function GenericRowsBody({ rows, textSummary }: { rows: GenericRow[]; textSummary: string }) {
  return (
    // `min-w-0` ở cả hộp lẫn từng dòng: xem lý lẽ `break-words` ở nhánh textSummary phía trên.
    <div className="min-w-0 space-y-1 max-h-56 overflow-y-auto">
      {rows.slice(0, 20).map((r, i) => (
        <div key={i} className="flex min-w-0 items-start justify-between gap-2 text-[11px]">
          <span className="font-mono text-muted-foreground truncate shrink-0 max-w-[45%]">{r.label}</span>
          <span className="min-w-0 text-right text-foreground/90 break-words">{r.value}</span>
        </div>
      ))}
      {rows.length > 20 && (
        <div className="text-[10px] text-muted-foreground italic">… +{rows.length - 20} dòng nữa</div>
      )}
      {rows.length === 0 && <div className="min-w-0 break-words whitespace-pre-line text-foreground/90">{textSummary}</div>}
    </div>
  );
}

// ---- shared mini stat ----
function Stat({ label, value, color, icon }: { label: string; value: number; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/60 px-1.5 py-1 text-center">
      <div className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

export default AIToolResultCard;
