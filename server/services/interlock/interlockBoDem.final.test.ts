/**
 * SCADA R0 final review — cổng interlock × BỘ ĐỆM THẬT (không mock boDemHienTai), DB giả.
 *
 *   I2: bộ đệm chỉ nuôi bởi đường OT trong tiến trình ⇒ luật `telemetry_tag` của nguồn KHÁC (MQTT, edge, /api/v1, simulator…) phải đọc DB,
 *       không được chặn vĩnh viễn với `khong_co_mau`. Chỉ (máy, tag) do adapter OT trung tâm đã đăng ký KHAI mới đọc bộ đệm.
 *   I3 (c): đường bộ đệm áp `windowSeconds` của luật trên giờ NHẬN (`lichSuRx`) — khớp `ts >= since` của đường DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ op: "and", a }),
  eq: (col: any, val: any) => ({ op: "eq", col, val }),
  gte: (col: any, val: any) => ({ op: "gte", col, val }),
  desc: (col: any) => ({ op: "desc", col }),
  sql: Object.assign((..._a: any[]) => ({ op: "sql" }), {}),
}));

vi.mock("../../../drizzle/schema", () => ({
  interlockRules: { __t: "interlock_rules", id: {}, enabled: { __c: "enabled" } },
  processResults: { __t: "process_results", measuredAt: {}, result: {}, machineId: {}, stepType: {} },
  spcRuleViolations: { __t: "spc_rule_violations", detectedAt: {}, isActive: {}, machineId: {} },
  cpkHistory: { __t: "cpk_history", cpk: {}, machineId: {}, periodEnd: {} },
  otTelemetry: { __t: "ot_telemetry", ts: {}, numValue: {}, machineId: {}, metric: {} },
}));

/** Hàng ot_telemetry MỚI NHẤT TRƯỚC (như ORDER BY ts DESC). `soLanDocDb` đếm truy vấn ot_telemetry (bằng chứng đường DB). */
const db: { rows: any[]; soLanDocDb: number } = { rows: [], soLanDocDb: 0 };
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (table: any) => {
        const b: any = {
          where: () => b,
          orderBy: () => b,
          limit: async (n: number) => {
            if (table?.__t === "ot_telemetry") {
              db.soLanDocDb++;
              return db.rows.slice(0, n);
            }
            return [];
          },
        };
        return b;
      },
    }),
  })),
}));

import { danhGiaLuat } from "./interlockGate";
import { __datLaiBoDemHienTai, datThongTinAdapter, napTuOt } from "../scada/boDemHienTai";
import type { OtSample } from "../ot/otDriver";

const MAY = 5;
const TAG = "nhiet_do";

function luat(over: Partial<any> = {}): any {
  return {
    id: 1,
    name: "R",
    enabled: true,
    approvedBy: 1,
    action: "block_downstream",
    sourceType: "telemetry_tag",
    sourceKey: TAG,
    comparisonOperator: "gt",
    threshold: "80",
    windowSeconds: 300,
    windowSize: 50,
    consecutiveCount: null,
    machineId: MAY,
    ...over,
  };
}

/** n hàng good giá trị v từ nguồn MQTT (deviceId không phải adapter OT nào), mới nhất trước, tuổi `tuoiMs`. */
function hangMqtt(n: number, v: number, tuoiMs = 1000): any[] {
  const t = new Date(Date.now() - tuoiMs);
  return Array.from({ length: n }, () => ({ v: String(v), t, ingestedAt: t, quality: "good", deviceId: "mqtt-may5" }));
}

const mauTot = (v: number, ts: number): OtSample => ({ tagKey: TAG, raw: v, value: v, quality: "good", timestamp: new Date(ts) });

beforeEach(() => {
  __datLaiBoDemHienTai();
  db.rows = [];
  db.soLanDocDb = 0;
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
});
afterEach(() => {
  delete process.env.SCADA_LIVE_CACHE_ENABLED;
  __datLaiBoDemHienTai();
});

describe("final I2 — bộ đệm bật: chỉ (máy, tag) do adapter OT trung tâm khai mới đọc bộ đệm", () => {
  it("máy nuôi bằng MQTT (không adapter OT trung tâm nào khai tag) + hàng DB còn tươi ⇒ đánh giá qua ĐƯỜNG DB, không phải khong_co_mau", async () => {
    db.rows = hangMqtt(3, 95);
    expect(await danhGiaLuat(luat())).toEqual({ dung: true, thieuDuLieu: false });
    expect(db.soLanDocDb).toBe(1);
    db.rows = hangMqtt(3, 20);
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: false });
  });

  it("adapter OT trung tâm của máy 5 KHAI tag khác ⇒ tag này vẫn đọc DB", async () => {
    datThongTinAdapter(70, { pollMs: 1000, coDeadband: false, machineId: MAY, code: "OT-70", tagKeys: ["ap_suat"] });
    db.rows = hangMqtt(3, 95);
    expect(await danhGiaLuat(luat())).toEqual({ dung: true, thieuDuLieu: false });
    expect(db.soLanDocDb).toBe(1);
  });

  it("adapter OT trung tâm KHAI tag ⇒ đường BỘ ĐỆM (không truy vấn DB): giá trị sống được dùng dù DB nói khác", async () => {
    datThongTinAdapter(70, { pollMs: 1000, coDeadband: false, machineId: MAY, code: "OT-70", tagKeys: [TAG] });
    const now = Date.now();
    napTuOt({ adapterId: 70, machineId: MAY }, [mauTot(95, now)], now);
    db.rows = hangMqtt(3, 20); // DB nói an toàn — không được đọc
    expect(await danhGiaLuat(luat(), now)).toEqual({ dung: true, thieuDuLieu: false });
    expect(db.soLanDocDb).toBe(0);
  });

  it("adapter OT trung tâm KHAI tag nhưng chưa có mẫu ⇒ bộ đệm ⇒ khong_co_mau (fail-closed, không lùi về DB)", async () => {
    datThongTinAdapter(70, { pollMs: 1000, coDeadband: false, machineId: MAY, code: "OT-70", tagKeys: [TAG] });
    db.rows = hangMqtt(3, 20);
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
    expect(db.soLanDocDb).toBe(0);
  });

  it("đường DB giữ fail-closed: MQTT im lặng 30 s (> sàn 15 s) ⇒ cu", async () => {
    db.rows = hangMqtt(3, 20, 30_000);
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "cu" });
  });
});

describe("final I3 (c) — đường bộ đệm áp windowSeconds trên giờ nhận", () => {
  it("20 mẫu > 80 mỗi 1 s, windowSeconds=10, consecutiveCount=15 ⇒ chỉ ~11 điểm trong cửa sổ ⇒ khong_co_mau; windowSeconds=30 ⇒ vi phạm", async () => {
    datThongTinAdapter(70, { pollMs: 1000, coDeadband: false, machineId: MAY, code: "OT-70", tagKeys: [TAG] });
    const t0 = Date.now() - 19_000;
    for (let i = 0; i < 20; i++) napTuOt({ adapterId: 70, machineId: MAY }, [mauTot(95, t0 + i * 1000)], t0 + i * 1000);
    const now = t0 + 19_000;
    expect(await danhGiaLuat(luat({ consecutiveCount: 15, windowSeconds: 10 }), now)).toEqual({
      dung: false,
      thieuDuLieu: true,
      lyDo: "khong_co_mau",
    });
    expect(await danhGiaLuat(luat({ consecutiveCount: 15, windowSeconds: 30 }), now)).toEqual({ dung: true, thieuDuLieu: false });
    expect(db.soLanDocDb).toBe(0);
  });

  it("điểm cũ ngoài cửa sổ không được đếm vào 'N điểm liên tiếp' (3 cũ > 80 rồi 2 mới > 80, cửa sổ chỉ chứa 2 ⇒ chưa đủ 3)", async () => {
    datThongTinAdapter(70, { pollMs: 5000, coDeadband: false, machineId: MAY, code: "OT-70", tagKeys: [TAG] });
    const now = Date.now();
    const rx = [now - 14_000, now - 12_000, now - 10_000, now - 2_000, now - 1_000]; // khoảng ≤ 8 s < ngưỡng stale 15 s ⇒ một chuỗi
    for (const r of rx) napTuOt({ adapterId: 70, machineId: MAY }, [mauTot(95, r)], r);
    expect(await danhGiaLuat(luat({ consecutiveCount: 3, windowSeconds: 5 }), now)).toEqual({
      dung: false,
      thieuDuLieu: true,
      lyDo: "khong_co_mau",
    });
    expect(await danhGiaLuat(luat({ consecutiveCount: 3, windowSeconds: 20 }), now)).toEqual({ dung: true, thieuDuLieu: false });
  });
});
