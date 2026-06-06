// Digital Twin Service (Giai đoạn 3 — G10)
// Pure-compute helpers cho twin realtime: ánh xạ trạng thái → màu, gom heatmap defect,
// và mô phỏng what-if năng suất chuyền. Không ghi DB, an toàn gọi từ tRPC.

/** Bảng màu twin theo operationStatus (đồng bộ với Factory3DScene). */
export const TWIN_STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",      // green
  warming_up: "#84cc16",   // lime
  changeover: "#3b82f6",   // blue
  starved: "#f59e0b",      // amber
  blocked: "#f97316",      // orange
  stopped: "#9ca3af",      // gray
  maintenance: "#a855f7",  // purple
  error: "#ef4444",        // red
};

export function colorForStatus(status: string | null | undefined): string {
  return TWIN_STATUS_COLORS[status ?? "stopped"] ?? TWIN_STATUS_COLORS.stopped;
}

/**
 * Pha trộn màu theo healthScore (0-100): điểm thấp kéo về đỏ để cảnh báo trực quan.
 * Trả về hex; nếu không có healthScore, dùng màu trạng thái nguyên bản.
 */
export function colorForTwin(status: string | null | undefined, healthScore: number | null | undefined): string {
  const base = colorForStatus(status);
  if (healthScore == null || healthScore >= 70) return base;
  // Health thấp: nội suy về đỏ #ef4444
  const t = Math.max(0, Math.min(1, (70 - healthScore) / 70));
  return lerpHex(base, "#ef4444", t);
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ---------------------------------------------------------------
// What-if simulation (mô phỏng năng suất chuyền)
// ---------------------------------------------------------------

export interface StationSpec {
  stationId: number;
  name?: string | null;
  cycleTimeSec: number;     // thời gian chu kỳ hiện tại (giây/đơn vị)
  availability?: number;    // 0-1, mặc định 1
  yield?: number;           // 0-1, mặc định 1
}

export interface WhatIfInput {
  stations: StationSpec[];
  horizonHours: number;     // khung thời gian mô phỏng
  cycleTimeMultiplier?: number; // điều chỉnh giả định (vd. 0.9 = nhanh hơn 10%)
}

export interface WhatIfResult {
  bottleneckStationId: number | null;
  bottleneckCycleSec: number;
  theoreticalUnits: number;     // không tính availability/yield
  effectiveUnits: number;       // có tính availability & yield
  lineBalanceRatePct: number;   // 0-100 (tổng cycle / (n * bottleneck))
  perStation: Array<{ stationId: number; effectiveCycleSec: number; utilizationPct: number }>;
}

/**
 * Mô phỏng năng suất: bottleneck = trạm có effective cycle lớn nhất.
 * effectiveCycle = cycle / (availability * yield). Throughput chuyền = 1 / bottleneck.
 * Pure function — dễ kiểm thử, không phụ thuộc DB.
 */
export function simulateWhatIf(input: WhatIfInput): WhatIfResult {
  const mult = input.cycleTimeMultiplier ?? 1;
  const horizonSec = Math.max(0, input.horizonHours) * 3600;

  const perStation = input.stations.map((s) => {
    const avail = s.availability ?? 1;
    const yld = s.yield ?? 1;
    const denom = Math.max(0.0001, avail * yld);
    const effectiveCycleSec = (s.cycleTimeSec * mult) / denom;
    return { stationId: s.stationId, effectiveCycleSec, utilizationPct: 0 };
  });

  if (perStation.length === 0) {
    return {
      bottleneckStationId: null,
      bottleneckCycleSec: 0,
      theoreticalUnits: 0,
      effectiveUnits: 0,
      lineBalanceRatePct: 0,
      perStation: [],
    };
  }

  const bottleneck = perStation.reduce((m, s) => (s.effectiveCycleSec > m.effectiveCycleSec ? s : m), perStation[0]);
  const bottleneckCycleSec = bottleneck.effectiveCycleSec;

  // Utilization tương đối so với bottleneck
  for (const s of perStation) {
    s.utilizationPct = bottleneckCycleSec > 0 ? Math.round((s.effectiveCycleSec / bottleneckCycleSec) * 1000) / 10 : 0;
  }

  const effectiveUnits = bottleneckCycleSec > 0 ? Math.floor(horizonSec / bottleneckCycleSec) : 0;

  // Theoretical: dùng cycle thô nhỏ nhất là không đúng; dùng tổng cycle thô / n như nhịp lý tưởng
  const rawCycles = input.stations.map((s) => s.cycleTimeSec * mult);
  const maxRaw = Math.max(...rawCycles);
  const theoreticalUnits = maxRaw > 0 ? Math.floor(horizonSec / maxRaw) : 0;

  const sumEff = perStation.reduce((a, s) => a + s.effectiveCycleSec, 0);
  const lineBalanceRatePct = bottleneckCycleSec > 0
    ? Math.round((sumEff / (perStation.length * bottleneckCycleSec)) * 1000) / 10
    : 0;

  return {
    bottleneckStationId: bottleneck.stationId,
    bottleneckCycleSec: Math.round(bottleneckCycleSec * 100) / 100,
    theoreticalUnits,
    effectiveUnits,
    lineBalanceRatePct,
    perStation,
  };
}

// ===============================================================
// G2.7 — WIP flow + station-load heatmap + prediction overlay
// PURE helpers (no DB, no machine-write). Color is computed HERE
// (single source TWIN_STATUS_COLORS) and the FE renders it verbatim.
// ===============================================================

/** A single in-process WIP row (subset of wipTracking columns we read). */
export interface WipRow {
  currentStationId: number | null;
  serialNumber: string | null;
  exitedAt: Date | string | null;
}

export interface WipStationAgg {
  count: number;
  serials: string[];
}

export interface WipFlowAggregate {
  byStation: Map<number, WipStationAgg>;
  totalWip: number;
  stationCount: number;
}

/**
 * Gom WIP đang trong chuyền theo station. WIP đã rời chuyền (exitedAt != null)
 * KHÔNG được tính. Pure — không phụ thuộc DB.
 */
export function aggregateWipFlow(rows: WipRow[]): WipFlowAggregate {
  const byStation = new Map<number, WipStationAgg>();
  let totalWip = 0;
  for (const r of rows) {
    if (r.exitedAt != null) continue;          // đã rời chuyền → bỏ qua
    if (r.currentStationId == null) continue;
    const sid = r.currentStationId;
    const cur = byStation.get(sid) ?? { count: 0, serials: [] };
    cur.count += 1;
    if (r.serialNumber) cur.serials.push(r.serialNumber);
    byStation.set(sid, cur);
    totalWip += 1;
  }
  return { byStation, totalWip, stationCount: byStation.size };
}

export type DominantState = "starved" | "blocked" | "processing" | "idle";

/** Đầu vào heatmap: dwell-agg theo station (avg ms) + utilization tùy chọn. */
export interface StationLoadInput {
  stationId: number;
  avgDwellMs?: number;
  avgStarvedMs?: number;
  avgBlockedMs?: number;
  /** 0-100 nếu có (vd. từ lineBalanceMetrics.utilizationPct); nếu thiếu suy ra từ dwell. */
  utilizationPct?: number | null;
  samples?: number;
}

export interface StationLoadCell {
  stationId: number;
  loadPct: number;            // 0-100
  dominantState: DominantState;
  color: string;              // hex từ service (single source)
}

/**
 * Tính heatmap tải trạm. dominantState:
 *  - starved  → amber  (TWIN_STATUS_COLORS.starved) khi starved chiếm ưu thế
 *  - blocked  → orange (TWIN_STATUS_COLORS.blocked) khi blocked chiếm ưu thế
 *  - processing → lerp green→red theo loadPct (xanh nhẹ tải → đỏ quá tải)
 *  - idle     → gray (TWIN_STATUS_COLORS.stopped) khi không có tải/sample
 * Pure — màu lấy từ TWIN_STATUS_COLORS / lerpHex.
 */
export function stationLoadHeatmap(inputs: StationLoadInput[]): StationLoadCell[] {
  return inputs.map((s) => {
    const dwell = Math.max(0, s.avgDwellMs ?? 0);
    const starved = Math.max(0, s.avgStarvedMs ?? 0);
    const blocked = Math.max(0, s.avgBlockedMs ?? 0);
    const samples = s.samples ?? 0;

    // loadPct: ưu tiên utilization rõ ràng; nếu không, suy ra từ tỷ lệ processing/dwell.
    let loadPct: number;
    if (s.utilizationPct != null) {
      loadPct = clampPct(s.utilizationPct);
    } else if (dwell > 0) {
      const processingMs = Math.max(0, dwell - starved - blocked);
      loadPct = clampPct((processingMs / dwell) * 100);
    } else {
      loadPct = 0;
    }

    let dominantState: DominantState;
    let color: string;

    if (samples === 0 && dwell === 0) {
      dominantState = "idle";
      color = colorForStatus("stopped");
    } else if (starved > blocked && starved > 0) {
      dominantState = "starved";
      color = colorForStatus("starved");   // amber
    } else if (blocked >= starved && blocked > 0) {
      dominantState = "blocked";
      color = colorForStatus("blocked");    // orange
    } else if (loadPct <= 0) {
      dominantState = "idle";
      color = colorForStatus("stopped");
    } else {
      dominantState = "processing";
      // green (#22c55e) → red (#ef4444) theo loadPct
      color = lerpHex("#22c55e", "#ef4444", clampPct(loadPct) / 100);
    }

    return { stationId: s.stationId, loadPct: Math.round(loadPct * 10) / 10, dominantState, color };
  });
}

export type CongestionRisk = "low" | "medium" | "high";

/** Forecast WIP cho 1 station (giá trị dự báo + station id). */
export interface StationForecast {
  stationId: number;
  predictedWipNext1h: number;
}

export interface PredictionOverlayCell {
  stationId: number;
  predictedWipNext1h: number;
  congestionRisk: CongestionRisk;
  color: string;          // gray/amber/red — overlay text+màu, KHÔNG hành động
  messageKey: string;     // i18n key (FE render text)
}

/**
 * Overlay dự báo tắc nghẽn: so predictedWipNext1h với ngưỡng.
 *  >= threshold      → high   (red,    digitalTwin.prediction.high)
 *  >= threshold*0.6  → medium (amber,  digitalTwin.prediction.medium)
 *  còn lại           → low    (gray,   digitalTwin.prediction.low)
 * Pure — chỉ tạo text + màu, không thực hiện hành động nào.
 */
export function buildPredictionOverlay(
  forecasts: StationForecast[],
  threshold: number,
): PredictionOverlayCell[] {
  const thr = Math.max(0, threshold);
  const medThr = thr * 0.6;
  return forecasts.map((f) => {
    const wip = Math.max(0, f.predictedWipNext1h);
    let congestionRisk: CongestionRisk;
    let color: string;
    let messageKey: string;
    if (wip >= thr && thr > 0) {
      congestionRisk = "high";
      color = colorForStatus("error");      // red
      messageKey = "digitalTwin.prediction.high";
    } else if (wip >= medThr && thr > 0) {
      congestionRisk = "medium";
      color = colorForStatus("starved");    // amber
      messageKey = "digitalTwin.prediction.medium";
    } else {
      congestionRisk = "low";
      color = colorForStatus("stopped");    // gray
      messageKey = "digitalTwin.prediction.low";
    }
    return {
      stationId: f.stationId,
      predictedWipNext1h: Math.round(wip * 10) / 10,
      congestionRisk,
      color,
      messageKey,
    };
  });
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
