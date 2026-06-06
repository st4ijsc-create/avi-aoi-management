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
