// Dispatching Realtime Service (Sprint S1 — B3)
// Mở rộng scheduler FIFO/Priority/EDF sang điều phối thời gian thực dựa WIP + bottleneck.
// Pure-compute (không ghi DB) → an toàn gọi từ tRPC; flag DISPATCHING_REALTIME_ENABLED chỉ
// dùng để bật/tắt việc tiêu thụ ở tầng wiring, không ảnh hưởng tính thuần khiết của hàm.

/** Cờ tính năng — mặc định tắt, code-only theo Sprint S1. */
export function isDispatchingEnabled(): boolean {
  return process.env.DISPATCHING_REALTIME_ENABLED === "true";
}

/** Một đơn vị WIP đang chờ điều phối (ánh xạ từ wip_tracking). */
export interface DispatchWipItem {
  serialNumber: string;
  lotNumber?: string | null;
  currentStationId: number | null;
  status: string;            // queued | in_process | blocked | starved | on_hold | ...
  priority?: number;         // 1-5, cao = ưu tiên (mặc định 3)
  enteredAt?: Date | null;   // thời điểm vào trạm hiện tại → tính aging
  dueDate?: Date | null;     // hạn giao → EDF tie-break
}

/** Tải/độ trễ của một trạm (ánh xạ từ station_dwell_time tổng hợp + line_balance_metrics). */
export interface StationLoad {
  stationId: number;
  avgDwellMs?: number | null;
  starvedMs?: number | null;
  blockedMs?: number | null;
  wipCount?: number | null;
  isBottleneck?: boolean;
}

export interface DispatchInput {
  items: DispatchWipItem[];
  stations?: StationLoad[];
  now?: Date;                // mặc định Date.now() — cho phép test xác định
  maxRecommendations?: number; // giới hạn số khuyến nghị trả về
}

export interface DispatchRecommendation {
  serialNumber: string;
  lotNumber?: string | null;
  stationId: number | null;
  score: number;             // điểm điều phối, cao = nên xử lý trước
  rank: number;              // thứ hạng 1..N
  reasons: string[];         // diễn giải lý do (đa ngôn ngữ hiển thị ở FE qua mã)
}

export interface DispatchResult {
  generatedAt: Date;
  bottleneckStationIds: number[];
  totalItems: number;
  recommendations: DispatchRecommendation[];
}

// Trọng số (có thể tinh chỉnh qua env, mặc định cân bằng giữa ưu tiên/aging/bottleneck).
const W_PRIORITY = Number(process.env.DISPATCH_W_PRIORITY ?? 100);
const W_AGING = Number(process.env.DISPATCH_W_AGING ?? 1); // điểm/phút chờ
const W_BLOCKED = Number(process.env.DISPATCH_W_BLOCKED ?? 500);
const W_STARVED_BOTTLENECK = Number(process.env.DISPATCH_W_STARVED_BOTTLENECK ?? 400);
const W_DUE_SOON = Number(process.env.DISPATCH_W_DUE_SOON ?? 300);
const DUE_SOON_MS = Number(process.env.DISPATCH_DUE_SOON_MS ?? 4 * 3600 * 1000); // 4h

function ageMinutes(enteredAt: Date | null | undefined, now: number): number {
  if (!enteredAt) return 0;
  const ms = now - enteredAt.getTime();
  return ms > 0 ? ms / 60000 : 0;
}

/**
 * Điều phối realtime: xếp hạng WIP nên xử lý trước.
 * Quy tắc (pure, dễ kiểm thử):
 *  1. Trạm BLOCKED phải được giải toả trước (điểm cao nhất).
 *  2. Nạp liệu cho bottleneck đang STARVED để tránh đói chuyền.
 *  3. Ưu tiên priority cao, sau đó aging (chờ lâu) — chống bỏ đói.
 *  4. Sắp đến hạn (due soon) cộng điểm — gần EDF.
 */
export function rankDispatch(input: DispatchInput): DispatchResult {
  const now = (input.now ?? new Date()).getTime();
  const stationMap = new Map<number, StationLoad>();
  for (const s of input.stations ?? []) stationMap.set(s.stationId, s);
  const bottleneckStationIds = (input.stations ?? [])
    .filter((s) => s.isBottleneck)
    .map((s) => s.stationId);
  const bottleneckSet = new Set(bottleneckStationIds);

  const scored: DispatchRecommendation[] = input.items.map((item) => {
    const reasons: string[] = [];
    let score = 0;

    const priority = item.priority ?? 3;
    score += priority * W_PRIORITY;
    if (priority >= 4) reasons.push("high_priority");

    const aging = ageMinutes(item.enteredAt, now);
    if (aging > 0) {
      score += aging * W_AGING;
      if (aging >= 60) reasons.push("aging");
    }

    if (item.status === "blocked") {
      score += W_BLOCKED;
      reasons.push("clear_blocked");
    }

    const station = item.currentStationId != null ? stationMap.get(item.currentStationId) : undefined;
    const atBottleneck = item.currentStationId != null && bottleneckSet.has(item.currentStationId);
    if (item.status === "starved" && atBottleneck) {
      score += W_STARVED_BOTTLENECK;
      reasons.push("feed_starved_bottleneck");
    } else if (atBottleneck) {
      score += W_STARVED_BOTTLENECK / 2;
      reasons.push("at_bottleneck");
    }

    if (station?.blockedMs && station.blockedMs > 0) {
      score += Math.min(W_BLOCKED, station.blockedMs / 1000);
    }

    if (item.dueDate) {
      const remaining = item.dueDate.getTime() - now;
      if (remaining <= 0) {
        score += W_DUE_SOON;
        reasons.push("overdue");
      } else if (remaining <= DUE_SOON_MS) {
        score += W_DUE_SOON * (1 - remaining / DUE_SOON_MS);
        reasons.push("due_soon");
      }
    }

    if (reasons.length === 0) reasons.push("fifo");

    return {
      serialNumber: item.serialNumber,
      lotNumber: item.lotNumber ?? null,
      stationId: item.currentStationId,
      score: Math.round(score * 100) / 100,
      rank: 0,
      reasons,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.serialNumber.localeCompare(b.serialNumber));
  scored.forEach((r, i) => (r.rank = i + 1));

  const limit = input.maxRecommendations && input.maxRecommendations > 0
    ? input.maxRecommendations
    : scored.length;

  return {
    generatedAt: new Date(now),
    bottleneckStationIds,
    totalItems: input.items.length,
    recommendations: scored.slice(0, limit),
  };
}
