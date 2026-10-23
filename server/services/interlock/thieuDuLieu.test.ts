/**
 * SCADA R0 Task 9 (K3, D2, D11) — interlock CHẶN khi thiếu dữ liệu + đọc giá trị SỐNG từ bộ đệm hiện tại.
 *
 * Quyết định chủ dự án D2: thiếu / xấu / không chắc / cũ / mơ hồ ⇒ CHẶN (fail-closed). Trước đây `compare()` trả false khi
 * quan sát null ⇒ cổng cho qua lệnh khi mất telemetry.
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
  interlockEvents: { __t: "interlock_events", id: { __c: "id" } },
  processResults: { __t: "process_results", measuredAt: {}, result: {}, machineId: {}, stepType: {} },
  spcRuleViolations: { __t: "spc_rule_violations", detectedAt: {}, isActive: {}, machineId: {} },
  cpkHistory: { __t: "cpk_history", cpk: {}, machineId: {}, periodEnd: {} },
  otTelemetry: { __t: "ot_telemetry", ts: {}, numValue: {}, machineId: {}, metric: {} },
}));

// ── Bộ đệm hiện tại: mock hai hàm Task 7 ────────────────────────────────────────────────────────
const cache: { bat: boolean; mau: any[]; hoi: Array<[number, string]> } = { bat: true, mau: [], hoi: [] };
vi.mock("../scada/boDemHienTai", () => ({
  SO_LICH_SU_TOI_DA: 50,
  boDemDangBat: () => cache.bat,
  timTheoMayVaTag: (machineId: number, tagKey: string) => {
    cache.hoi.push([machineId, tagKey]);
    return cache.mau;
  },
}));

// ── DB giả (đường cũ + bảng luật + sự kiện) ─────────────────────────────────────────────────────
// telemetryRows: MỚI NHẤT TRƯỚC (như ORDER BY ts DESC); mỗi hàng { v, t, quality }. limits: các LIMIT n đã được yêu cầu trên ot_telemetry.
const state: { rules: any[]; telemetryRows: any[]; insertedEvents: any[]; limits: number[] } = { rules: [], telemetryRows: [], insertedEvents: [], limits: [] };
/** n hàng telemetry tốt giá trị v (mới nhất trước). */
const hang = (n: number, v: number, quality = "good") => Array.from({ length: n }, () => ({ v: String(v), t: new Date(), quality }));

function makeBuilder(t: string): any {
  const rows = () => {
    if (t === "interlock_rules") return state.rules.filter((r) => r.enabled === true);
    if (t === "ot_telemetry") return state.telemetryRows;
    return [];
  };
  const builder: any = {
    where: () => builder,
    orderBy: () => builder,
    limit: async (n: number) => {
      if (t === "ot_telemetry") state.limits.push(n);
      return rows().slice(0, n);
    },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(rows()).then(resolve, reject),
  };
  return builder;
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: (table: any) => makeBuilder(table?.__t) }),
    insert: (table: any) => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = { id: state.insertedEvents.length + 1, ...vals };
          if (table?.__t === "interlock_events") state.insertedEvents.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => ({ rowCount: 1 }) }) }),
  })),
}));

const raiseAndon = vi.fn(async (..._a: any[]) => ({ id: 999 }));
vi.mock("../andon/andonService", () => ({ raiseAndon: (...a: any[]) => raiseAndon(...a) }));

const dispatchSpy = vi.fn(async (_i: any) => ({ ok: true, simulated: false, status: "acked", results: [], commandLogIds: [1] }));
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: (...a: any[]) => (dispatchSpy as any)(...a),
  isInterlockAutoBlockEnabled: () => true,
  isOtControlEnabled: () => true,
}));

import { evaluateInterlockGate, danhGiaLuat } from "./interlockGate";
import { evaluateRule, runOnce, __datLaiDotThieuDuLieu } from "./interlockEngine";

const ADAPTER = 10;
const MAY = 5;

function mau(over: Partial<any> = {}): any {
  return { adapterId: ADAPTER, tagKey: "nhiet_do", machineId: MAY, v: 50, q: "good", stale: false, ageMs: 100, lichSu: [50], ts: 1, ...over };
}

/** Luật chặn hợp lệ: nguồn telemetry_tag, ngưỡng gt 80, máy 5. KHÔNG khai `khiThieuDuLieu` (mô phỏng hàng mặc định → phải CHẶN). */
function luat(over: Partial<any> = {}): any {
  return {
    id: 1,
    name: "R-nhiet",
    scope: "machine",
    enabled: true,
    approvedBy: 42,
    action: "block_downstream",
    requiresHumanConfirm: false,
    targetAdapterId: ADAPTER,
    targetMachineId: MAY,
    commandTag: "cmd_block",
    commandValue: true,
    sourceType: "telemetry_tag",
    sourceKey: "nhiet_do",
    comparisonOperator: "gt",
    threshold: "80",
    windowSeconds: 300,
    windowSize: 50,
    consecutiveCount: null,
    machineId: MAY,
    lineId: null,
    stationId: null,
    cooldownSeconds: 300,
    lastFiredAt: null,
    ...over,
  };
}

const params = { adapterId: ADAPTER, machineId: MAY, tagKeys: ["cmd_start"] };

beforeEach(() => {
  cache.bat = true;
  cache.mau = [];
  cache.hoi = [];
  state.rules = [];
  state.telemetryRows = [];
  state.limits = [];
  state.insertedEvents = [];
  raiseAndon.mockClear();
  dispatchSpy.mockClear();
  __datLaiDotThieuDuLieu();
});

describe("cổng interlock — thiếu dữ liệu ⇒ CHẶN (D2)", () => {
  it("không có mẫu nào ⇒ blocked, violation lyDo=thieu_du_lieu", async () => {
    state.rules = [luat()];
    cache.mau = [];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.failClosed).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ ruleId: 1, action: "block_downstream", lyDo: "thieu_du_lieu" });
    // Đọc bộ đệm theo (máy của luật, sourceKey).
    expect(cache.hoi).toEqual([[MAY, "nhiet_do"]]);
  });

  it("mẫu q=bad ⇒ chặn", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ q: "bad", v: 10 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations[0].lyDo).toBe("thieu_du_lieu");
  });

  it("mẫu q=uncertain ⇒ chặn", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ q: "uncertain", v: 10 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations[0].lyDo).toBe("thieu_du_lieu");
  });

  it("mẫu stale ⇒ chặn (dù giá trị an toàn)", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ stale: true, ageMs: 999_999, v: 10 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations[0].lyDo).toBe("thieu_du_lieu");
  });

  it("hai adapter cùng tagKey trên máy ⇒ chặn (mơ hồ) — không chọn bừa (Review Focus 2)", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ adapterId: 10, v: 10 }), mau({ adapterId: 11, v: 10 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations[0].lyDo).toBe("thieu_du_lieu");
    const kq = await danhGiaLuat(luat());
    expect(kq).toEqual({ dung: false, thieuDuLieu: true, lyDo: "mo_ho" });
  });

  it("luật không gắn máy (machineId null) + bộ đệm bật ⇒ mơ hồ, chặn", async () => {
    state.rules = [luat({ machineId: null })];
    cache.mau = [mau({ v: 10 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(cache.hoi).toEqual([]); // không đoán máy
    expect(await danhGiaLuat(luat({ machineId: null }))).toEqual({ dung: false, thieuDuLieu: true, lyDo: "mo_ho" });
  });

  it("khiThieuDuLieu=cho_qua + không có mẫu ⇒ luật đó KHÔNG chặn", async () => {
    state.rules = [luat({ khiThieuDuLieu: "cho_qua" })];
    cache.mau = [];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  it("khiThieuDuLieu=chan khai tường minh + không có mẫu ⇒ chặn", async () => {
    state.rules = [luat({ khiThieuDuLieu: "chan" })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
  });

  it("lyDo của danhGiaLuat phân biệt: khong_co_mau / chat_luong_xau / cu", async () => {
    cache.mau = [];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
    cache.mau = [mau({ q: "bad" })];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "chat_luong_xau" });
    cache.mau = [mau({ q: "uncertain" })];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "chat_luong_xau" });
    cache.mau = [mau({ stale: true })];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "cu" });
  });
});

describe("cổng interlock — mẫu tốt đọc từ bộ đệm", () => {
  it("mẫu tốt vượt ngưỡng ⇒ chặn như cũ (không có lyDo)", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ v: 95 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].lyDo).toBeUndefined();
    expect(await danhGiaLuat(luat())).toEqual({ dung: true, thieuDuLieu: false });
  });

  it("mẫu tốt trong ngưỡng ⇒ không chặn", async () => {
    state.rules = [luat()];
    cache.mau = [mau({ v: 60 })];
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  it("consecutiveCount=3 đọc đúng 3 phần tử CUỐI của lichSu", async () => {
    // 3 cuối = 90, 91, 92 (>80) ⇒ vi phạm; phần tử đầu 10 không tính.
    cache.mau = [mau({ v: 92, lichSu: [10, 90, 91, 92] })];
    expect((await danhGiaLuat(luat({ consecutiveCount: 3 }))).dung).toBe(true);
    // 3 cuối = 10, 91, 92 ⇒ không vi phạm (phần tử cũ 95 không tính).
    cache.mau = [mau({ v: 92, lichSu: [95, 10, 91, 92] })];
    expect((await danhGiaLuat(luat({ consecutiveCount: 3 }))).dung).toBe(false);
  });

  it("consecutiveCount=3 nhưng lichSu mới có 2 mẫu ⇒ thiếu dữ liệu (không đủ để kết luận), chặn", async () => {
    cache.mau = [mau({ v: 92, lichSu: [91, 92] })];
    expect(await danhGiaLuat(luat({ consecutiveCount: 3 }))).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
  });

  it("giá trị v không phải số (null) ⇒ thiếu dữ liệu, chặn", async () => {
    cache.mau = [mau({ v: null })];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
  });
});

describe("đường DB cũ (bộ đệm TẮT) — không có hàng ⇒ thiếu dữ liệu", () => {
  it("không có hàng telemetry ⇒ thieuDuLieu khong_co_mau, gate chặn", async () => {
    cache.bat = false;
    state.rules = [luat()];
    state.telemetryRows = [];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.violations[0].lyDo).toBe("thieu_du_lieu");
    expect(cache.hoi).toEqual([]); // không chạm bộ đệm khi cờ tắt
  });

  it("hàng cuối có numValue null ⇒ thiếu dữ liệu", async () => {
    cache.bat = false;
    state.telemetryRows = [{ v: null, t: new Date(), quality: "good" }];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
  });

  it("có hàng vượt ngưỡng ⇒ vi phạm như cũ", async () => {
    cache.bat = false;
    state.telemetryRows = hang(1, 95);
    expect(await danhGiaLuat(luat())).toEqual({ dung: true, thieuDuLieu: false });
  });
});

describe("Task 9 fix round 1 — chuỗi dài hơn bộ đệm + chất lượng/máy trên đường DB", () => {
  it("consecutiveCount=60 (>50) + bộ đệm BẬT ⇒ đọc chuỗi từ DB (không chạm bộ đệm), 60 hàng tốt vượt ngưỡng ⇒ đánh giá bình thường (dung=true), KHÔNG chặn vĩnh viễn", async () => {
    cache.bat = true;
    cache.mau = [mau({ v: 95, lichSu: [95] })]; // bộ đệm chỉ giữ ≤50 — nếu bị dùng, sẽ thiếu dữ liệu
    state.telemetryRows = hang(60, 95);
    expect(await danhGiaLuat(luat({ consecutiveCount: 60 }))).toEqual({ dung: true, thieuDuLieu: false });
    expect(cache.hoi).toEqual([]);
    expect(state.limits).toContain(60);
  });

  it("consecutiveCount=60 + bộ đệm BẬT + DB chỉ có 40 hàng ⇒ vẫn FAIL-CLOSED (thiếu dữ liệu), không cho qua", async () => {
    state.telemetryRows = hang(40, 95);
    expect(await danhGiaLuat(luat({ consecutiveCount: 60 }))).toEqual({ dung: false, thieuDuLieu: true, lyDo: "khong_co_mau" });
  });

  it("consecutiveCount=50 (=giới hạn) vẫn đọc bộ đệm", async () => {
    cache.mau = [mau({ v: 95, lichSu: Array.from({ length: 50 }, () => 95) })];
    expect(await danhGiaLuat(luat({ consecutiveCount: 50 }))).toEqual({ dung: true, thieuDuLieu: false });
    expect(cache.hoi).toEqual([[MAY, "nhiet_do"]]);
  });

  it("DB path: windowSize=10, consecutiveCount=20 ⇒ LIMIT 20 (max), 20 hàng đánh giá bình thường", async () => {
    cache.bat = false;
    state.telemetryRows = hang(25, 95);
    expect(await danhGiaLuat(luat({ windowSize: 10, consecutiveCount: 20 }))).toEqual({ dung: true, thieuDuLieu: false });
    expect(state.limits).toContain(20);
    expect(state.limits).not.toContain(10);
  });

  it("DB path: hàng MỚI NHẤT chất lượng xấu ⇒ thiếu dữ liệu chat_luong_xau (không lùi về mẫu tốt cũ)", async () => {
    cache.bat = false;
    state.telemetryRows = [...hang(1, 10, "bad"), ...hang(5, 10)];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "chat_luong_xau" });
    state.telemetryRows = [...hang(1, 10, "uncertain"), ...hang(5, 10)];
    expect(await danhGiaLuat(luat())).toEqual({ dung: false, thieuDuLieu: true, lyDo: "chat_luong_xau" });
  });

  it("DB path: luật không gắn máy ⇒ mo_ho (cùng quy tắc với đường bộ đệm), kể cả khi có dữ liệu", async () => {
    cache.bat = false;
    state.telemetryRows = hang(5, 95);
    expect(await danhGiaLuat(luat({ machineId: null }))).toEqual({ dung: false, thieuDuLieu: true, lyDo: "mo_ho" });
  });
});

describe("engine — thiếu dữ liệu: không dispatch, không Andon, log MỘT lần mỗi đợt", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const dong = () => warn.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("interlock.thieu_du_lieu ruleId="));

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("thiếu dữ liệu ⇒ không dispatch, không raiseAndon, không ghi sự kiện", async () => {
    cache.mau = [];
    const ev = await evaluateRule(luat({ id: 301 }));
    expect(ev).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(raiseAndon).not.toHaveBeenCalled();
    expect(state.insertedEvents).toHaveLength(0);
  });

  it("3 lần chạy liền thiếu dữ liệu ⇒ đúng 1 dòng log; có lại dữ liệu rồi thiếu lần nữa ⇒ thêm 1 dòng", async () => {
    const l = luat({ id: 302 });
    cache.mau = [];
    await evaluateRule(l);
    await evaluateRule(l);
    await evaluateRule(l);
    expect(dong()).toEqual(["interlock.thieu_du_lieu ruleId=302 lyDo=khong_co_mau"]);

    // Có lại dữ liệu đủ (trong ngưỡng) ⇒ đợt kết thúc.
    cache.mau = [mau({ v: 10 })];
    expect(await evaluateRule(l)).toBeNull();
    expect(dong()).toHaveLength(1);

    // Thiếu lần nữa ⇒ đợt mới, lý do khác.
    cache.mau = [mau({ stale: true })];
    await evaluateRule(l);
    await evaluateRule(l);
    expect(dong()).toEqual(["interlock.thieu_du_lieu ruleId=302 lyDo=khong_co_mau", "interlock.thieu_du_lieu ruleId=302 lyDo=cu"]);
  });

  it("hai luật thiếu dữ liệu ⇒ mỗi luật 1 dòng riêng; runOnce lặp không thêm dòng", async () => {
    state.rules = [luat({ id: 311 }), luat({ id: 312 })];
    cache.mau = [];
    await runOnce();
    await runOnce();
    expect(dong().sort()).toEqual(["interlock.thieu_du_lieu ruleId=311 lyDo=khong_co_mau", "interlock.thieu_du_lieu ruleId=312 lyDo=khong_co_mau"]);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(raiseAndon).not.toHaveBeenCalled();
  });

  it("mẫu tốt vượt ngưỡng ⇒ engine vẫn phát hành động như cũ", async () => {
    cache.mau = [mau({ v: 95 })];
    const ev = await evaluateRule(luat({ id: 320, action: "alert", requiresHumanConfirm: true }));
    expect(ev?.status).toBe("alert_only");
    expect(raiseAndon).toHaveBeenCalledTimes(1);
  });
});
