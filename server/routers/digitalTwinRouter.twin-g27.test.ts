/**
 * Sprint G2.7 — digitalTwinRouter tests (G2.7 endpoints).
 *
 * Covers: wipFlowState / stationLoadHeatmap / predictionOverlay shapes; the
 * forecast-with-<3-points path returns available:false (no throw); db-degrade
 * ([] from db layer) yields empty-but-valid shapes. db layer is mocked so no
 * real connection is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── db-layer mocks (read-only helpers) ─────────────────────────
const getWipByStationMock = vi.fn(async () => [
  { currentStationId: 1, count: 3, serials: ["A", "B", "C"] },
  { currentStationId: 2, count: 1, serials: ["D"] },
]);
const getWipCountSeriesMock = vi.fn(async () => [
  { bucketStart: new Date(Date.now() - 3 * 36e5).toISOString(), wipCount: 4 },
  { bucketStart: new Date(Date.now() - 2 * 36e5).toISOString(), wipCount: 6 },
  { bucketStart: new Date(Date.now() - 1 * 36e5).toISOString(), wipCount: 8 },
]);
vi.mock("../db/twin", () => ({
  getWipByStation: (...a: any[]) => getWipByStationMock(...a),
  getWipCountSeries: (...a: any[]) => getWipCountSeriesMock(...a),
}));

const getStationDwellAggMock = vi.fn(async () => [
  { stationId: 1, avgDwellMs: 1000, avgStarvedMs: 700, avgBlockedMs: 100, samples: 5 },
  { stationId: 2, avgDwellMs: 1000, avgStarvedMs: 0, avgBlockedMs: 0, samples: 5 },
]);
const getLatestLineBalanceMock = vi.fn(async () => ({
  bottleneckStationId: 1,
  utilizationPct: 80,
} as any));
vi.mock("../db/lineBalance", () => ({
  getStationDwellAgg: (...a: any[]) => getStationDwellAggMock(...a),
  getLatestLineBalance: (...a: any[]) => getLatestLineBalanceMock(...a),
}));

vi.mock("../db/layout", () => ({
  getMachinePositionsByLayout: vi.fn(async () => []),
}));

// getDb: null ⇒ twinState/defectHeatmap degrade to []. The G2.7 endpoints below
// read through the mocked db helpers above, so they do not need a connection.
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => null),
}));

import { digitalTwinRouter } from "./digitalTwinRouter";

/**
 * ★ ĐỢT 14 LÔ Q1 — vai **admin**, và đó là một lựa chọn có lý do, không phải một
 * bước dọn cho test xanh.
 *
 * Tệp này đo **HÌNH DẠNG ĐÁP ỨNG** của ba thủ tục G2.7 (wipFlowState /
 * stationLoadHeatmap / predictionOverlay) — nó không đo tenancy. Sau lô Q1 mọi
 * thủ tục đều hỏi `idsTrongPhamVi`, mà hàm ấy cần một kết nối DB thật; với
 * `getDb → null` một vai bị-thu-hẹp cho phạm vi RỖNG và mọi đáp ứng thành rỗng
 * hợp lệ — tức tệp này sẽ đo "cổng phạm vi chặn đúng" thay vì đo hình dạng, và
 * ba ô của nó sẽ xanh-vì-lý-do-sai nếu ai đó lỡ nới chúng thành `toEqual([])`.
 *
 * `admin` ⇒ `phamViCua` cho phạm vi `null` ⇒ KHÔNG thêm mệnh đề nào ⇒ hình dạng
 * đáp ứng lộ ra nguyên vẹn, đúng thứ tệp này sinh ra để canh.
 *
 * ⚠ Điều này KHÔNG chứng minh gì về quyền (admin BYPASS mọi cổng — đo bằng admin
 *   chứng minh SỐ 0). Hàng rào tenant được nghiệm thu ở chỗ khác, bằng vai
 *   KHÔNG-admin trên DB thật: `digitalTwinPhamVi.db.test.ts` (hai chiều) và
 *   `phamViTwinCanh.unit.test.ts` (phân đôi toàn tập).
 */
const ctx = { user: { id: 1, role: "admin", name: "Adm" } } as any;
const caller = digitalTwinRouter.createCaller(ctx);

beforeEach(() => {
  getWipByStationMock.mockClear();
  getWipCountSeriesMock.mockClear();
});

describe("wipFlowState", () => {
  it("returns per-station WIP counts + serials", async () => {
    const res = await caller.wipFlowState({ lineId: 1 });
    expect(res.totalWip).toBe(4);
    expect(res.stationCount).toBe(2);
    const s1 = res.stations.find((s) => s.stationId === 1)!;
    expect(s1.wipCount).toBe(3);
    expect(s1.serials).toEqual(["A", "B", "C"]);
    expect(typeof res.ts).toBe("number");
  });

  it("db-degrade: empty rows → empty-but-valid shape", async () => {
    getWipByStationMock.mockResolvedValueOnce([] as any);
    const res = await caller.wipFlowState({});
    expect(res.stations).toEqual([]);
    expect(res.totalWip).toBe(0);
  });
});

describe("stationLoadHeatmap", () => {
  it("returns load cells + bottleneck", async () => {
    const res = await caller.stationLoadHeatmap({ lineId: 1, hours: 24 });
    expect(res.cells).toHaveLength(2);
    expect(res.bottleneckStationId).toBe(1);
    const c1 = res.cells.find((c) => c.stationId === 1)!;
    expect(c1.dominantState).toBe("starved");
    expect(c1.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("predictionOverlay", () => {
  it("returns available overlay when >=3 points", async () => {
    const res = await caller.predictionOverlay({ lineId: 1, horizonHours: 1 });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.cells.length).toBe(1);
      expect(["low", "medium", "high"]).toContain(res.cells[0].congestionRisk);
    }
  });

  it("forecast < 3 points → available:false (no throw)", async () => {
    getWipCountSeriesMock.mockResolvedValueOnce([
      { bucketStart: new Date().toISOString(), wipCount: 1 },
    ] as any);
    const res = await caller.predictionOverlay({ lineId: 1 });
    expect(res.available).toBe(false);
    expect(res.cells).toEqual([]);
  });
});
