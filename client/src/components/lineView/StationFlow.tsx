/**
 * doc 44 W3-B4 / G5.10 — Sơ đồ tuyến ngang (Line View, spec LDS-L5 Ch.4.2):
 * dải station card trái→phải theo orderIndex; mỗi card = trạm + máy (PackML
 * op-state) + chu kỳ/dwell + cờ blocked/starved; bottleneck highlight.
 *
 * ISA-101: card nền trung tính; màu (viền/badge) CHỈ cho bất thường
 * (blocked/starved/máy fault/bottleneck) — không "biển màu".
 * Click card → caller mở drawer chi tiết trạm (link /machine/:id sẵn có).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, Gauge, PackageOpen, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/patterns";
import { formatMs } from "./lineFsm";

/** Shape per-trạm từ trpc lineController.stages (mirror LineStageView server). */
export interface StationStageView {
  stationId: number;
  code: string;
  name: string;
  orderIndex: number;
  cycleTimeTargetS: number | null;
  dwell: { avgDwellMs: number; avgStarvedMs: number; avgBlockedMs: number; samples: number } | null;
  blocked: boolean;
  starved: boolean;
  machines: Array<{
    id: number;
    code: string;
    name: string;
    machineType: string;
    operationStatus: string;
    opState: string;
    presence: "online" | "offline" | "unknown";
  }>;
}

export interface StationFlowProps {
  stages: StationStageView[];
  /** Từ lineController.getState().bottleneck — null khi chưa có analytics (honest). */
  bottleneckStationId: number | null;
  bottleneckMachineId: number | null;
  onSelectStation: (stationId: number) => void;
  className?: string;
}

/** doc65 V5 — PackML token → nhãn Việt ngắn (StatusBadge mặc định in raw "STOPPED"). */
const PACKML_LABEL_VI: Record<string, string> = {
  STOPPED: "Dừng", EXECUTE: "Đang chạy", IDLE: "Chờ", READY: "Sẵn sàng",
  HELD: "Giữ", SUSPENDED: "Tạm ngưng", COMPLETE: "Hoàn tất", ABORTED: "Hủy",
  RESETTING: "Đặt lại", STARTING: "Khởi động", STOPPING: "Đang dừng", UNKNOWN: "Không rõ",
};

/** Chấm presence nhỏ cạnh tên máy (online/offline/unknown).
 * doc65 V1 (ISA-101): presence = KẾT NỐI, không phải trạng thái chạy — dùng info (xanh dương),
 * không mượn xanh lá "running" (đứng cạnh badge STOPPED sẽ thành 2 tín hiệu mâu thuẫn). */
function PresenceDot({ presence }: { presence: "online" | "offline" | "unknown" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        presence === "online" && "bg-info",
        presence === "offline" && "bg-destructive",
        presence === "unknown" && "bg-muted-foreground/50",
      )}
    />
  );
}

export function StationFlow({
  stages,
  bottleneckStationId,
  bottleneckMachineId,
  onSelectStation,
  className,
}: StationFlowProps) {
  const { t } = useTranslation();

  // Bottleneck theo trạm: khớp stationId trực tiếp, hoặc trạm chứa máy bottleneck.
  const isBottleneck = (s: StationStageView): boolean => {
    if (bottleneckStationId != null && s.stationId === bottleneckStationId) return true;
    if (bottleneckMachineId != null && s.machines.some((m) => m.id === bottleneckMachineId)) return true;
    return false;
  };

  if (stages.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        {t("lineView.flow.empty", "Tuyến chưa có trạm ACTIVE nào.")}
      </p>
    );
  }

  return (
    <div className={cn("flex items-stretch gap-1 overflow-x-auto pb-2", className)}>
      {stages.map((s, i) => {
        const bottleneck = isBottleneck(s);
        const abnormal = s.blocked || s.starved;
        return (
          <React.Fragment key={s.stationId}>
            {i > 0 && (
              <div className="flex shrink-0 items-center" aria-hidden="true">
                <ChevronRight className="size-4 text-muted-foreground/60" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onSelectStation(s.stationId)}
              className={cn(
                "min-w-[13rem] max-w-[16rem] shrink-0 rounded-lg border bg-card p-3 text-left text-card-foreground shadow-sm transition-colors",
                "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                abnormal && "border-warning/60",
                bottleneck && "ring-2 ring-destructive/50",
              )}
            >
              {/* Hàng đầu: mã + tên trạm; nhãn bottleneck khi là nút cổ chai. */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={s.name}>
                    {s.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{s.code}</p>
                </div>
                {bottleneck && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                    <TrendingDown className="size-3" aria-hidden="true" />
                    {t("lineView.flow.bottleneck", "Nút cổ chai")}
                  </span>
                )}
              </div>

              {/* Cờ blocked/starved — chỉ hiện khi CÓ (giảm nhiễu). */}
              {abnormal && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.blocked && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      {t("lineView.flow.blocked", "Nghẽn (blocked)")}
                    </span>
                  )}
                  {s.starved && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      <PackageOpen className="size-3" aria-hidden="true" />
                      {t("lineView.flow.starved", "Đói liệu (starved)")}
                    </span>
                  )}
                </div>
              )}

              {/* Nhịp: chu kỳ mục tiêu (line_stages) + dwell TB (analytics). Honest "—" khi chưa có. */}
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1" title={t("lineView.flow.cycleTarget", "Chu kỳ mục tiêu")}>
                  <Gauge className="size-3" aria-hidden="true" />
                  {s.cycleTimeTargetS != null ? `${s.cycleTimeTargetS}s` : "—"}
                </span>
                <span title={t("lineView.flow.dwellAvg", "Dwell trung bình (cửa sổ quan sát)")}>
                  {t("lineView.flow.dwellShort", "Dwell")} {s.dwell ? formatMs(s.dwell.avgDwellMs) : "—"}
                </span>
              </div>

              {/* Máy trong trạm: presence dot + mã + PackML op-state badge. */}
              <ul className="mt-2 space-y-1">
                {s.machines.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    {t("lineView.flow.noMachines", "Chưa gán máy")}
                  </li>
                )}
                {s.machines.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <PresenceDot presence={m.presence} />
                      <span className="truncate" title={`${m.name} (${m.machineType})`}>
                        {m.code}
                      </span>
                    </span>
                    <StatusBadge status={m.opState} label={PACKML_LABEL_VI[m.opState?.toUpperCase?.() ?? ""] ?? m.opState} className="px-1.5 py-0 text-[10px]" />
                  </li>
                ))}
              </ul>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default StationFlow;
