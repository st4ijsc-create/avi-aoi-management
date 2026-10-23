/**
 * SCADA R0 Task 7 — bộ đệm giá trị hiện tại (adapterId, tagKey) → giá trị + chất lượng + tuổi.
 * Thuần RAM; đọc DB / tap telemetryBus được mock.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { InsertOtTelemetry } from "../../../drizzle/schema";

const taps: Array<(rows: InsertOtTelemetry[]) => void> = [];
const huyTap = vi.fn();
vi.mock("../telemetryBus", () => ({
  registerTelemetryTap: vi.fn((tap: (rows: InsertOtTelemetry[]) => void) => {
    taps.push(tap);
    return () => {
      huyTap();
      const i = taps.indexOf(tap);
      if (i >= 0) taps.splice(i, 1);
    };
  }),
}));

const layMoiNhat = vi.fn();
vi.mock("../../db/otTelemetry", () => ({
  layMoiNhatTheoThietBi: (...a: unknown[]) => layMoiNhat(...a),
}));

import {
  __datLaiBoDemHienTai,
  dangKyThayDoi,
  datThongTinAdapter,
  khoiDongBoDemHienTai,
  layGiaTri,
  napTuTap,
  thongTinAdapter,
  timTheoMayVaTag,
} from "./boDemHienTai";

const T0 = 1_800_000_000_000;

function hang(over: Partial<InsertOtTelemetry> & { adapterId?: number; tagKey?: string; meta?: Record<string, unknown> | null }): InsertOtTelemetry {
  const { adapterId, tagKey, meta, ...rest } = over;
  return {
    ts: new Date(T0),
    protocol: "modbus",
    metric: tagKey ?? "t",
    numValue: 1,
    quality: "good",
    meta: meta === undefined ? { adapterId: adapterId ?? 7, tagKey: tagKey ?? "t" } : meta,
    ...rest,
  } as InsertOtTelemetry;
}

beforeEach(() => {
  __datLaiBoDemHienTai();
  taps.length = 0;
  huyTap.mockClear();
  layMoiNhat.mockReset();
});

describe("napTuTap / layGiaTri", () => {
  it("lưu giá trị, chất lượng của một hàng số", () => {
    const keys = napTuTap([hang({ numValue: 3.5 })], T0);
    expect(keys).toEqual(["7:t"]);
    const g = layGiaTri(7, "t", T0);
    expect(g?.v).toBe(3.5);
    expect(g?.q).toBe("good");
    expect(g?.adapterId).toBe(7);
    expect(g?.ts).toBe(T0);
    expect(g?.rx).toBe(T0);
    expect(g?.ageMs).toBe(0);
  });

  it("layGiaTri trả null khi chưa có", () => {
    expect(layGiaTri(1, "x")).toBeNull();
  });

  it("giá trị chữ / logic; mã trạng thái + lý do của mẫu xấu", () => {
    napTuTap(
      [
        hang({ tagKey: "s", numValue: null, textValue: "RUN" }),
        hang({ tagKey: "b", numValue: null, boolValue: false }),
        hang({
          tagKey: "x",
          numValue: null,
          quality: "bad",
          meta: { adapterId: 7, tagKey: "x", statusCode: "BadNodeIdUnknown", reason: "comm_lost" },
        }),
      ],
      T0,
    );
    expect(layGiaTri(7, "s", T0)?.v).toBe("RUN");
    expect(layGiaTri(7, "b", T0)?.v).toBe(false);
    const x = layGiaTri(7, "x", T0)!;
    expect(x.v).toBeNull();
    expect(x.q).toBe("bad");
    expect(x.statusCode).toBe("BadNodeIdUnknown");
    expect(x.reason).toBe("comm_lost");
  });

  it("lý do lạ bị bỏ (null) thay vì lọt vào bộ đệm", () => {
    napTuTap([hang({ quality: "uncertain", meta: { adapterId: 7, tagKey: "t", reason: "tuy_tien" } })], T0);
    expect(layGiaTri(7, "t", T0)?.reason).toBeNull();
  });

  it("uncertain không có giá trị ⇒ giữ giá trị cuối; bad ⇒ giữ v của hàng (null)", () => {
    napTuTap([hang({ numValue: 9 })], T0);
    napTuTap([hang({ numValue: null, quality: "uncertain", ts: new Date(T0 + 1000) })], T0 + 1000);
    expect(layGiaTri(7, "t", T0 + 1000)).toMatchObject({ v: 9, q: "uncertain" });
    napTuTap([hang({ numValue: null, quality: "bad", ts: new Date(T0 + 2000) })], T0 + 2000);
    expect(layGiaTri(7, "t", T0 + 2000)).toMatchObject({ v: null, q: "bad" });
  });

  it("hàng không có meta.adapterId bị bỏ qua, không ném", () => {
    expect(() =>
      napTuTap([hang({ meta: null }), hang({ meta: { tagKey: "t" } }), hang({ meta: { adapterId: "x", tagKey: "t" } })], T0),
    ).not.toThrow();
    expect(napTuTap([hang({ meta: null })], T0)).toEqual([]);
    expect(timTheoMayVaTag(1, "t", T0)).toEqual([]);
  });

  it("rx = ingestedAt nếu có, không thì now", () => {
    napTuTap([hang({ ingestedAt: new Date(T0 - 5000) })], T0);
    expect(layGiaTri(7, "t", T0)?.rx).toBe(T0 - 5000);
    expect(layGiaTri(7, "t", T0)?.ageMs).toBe(5000);
  });

  it("tsSource lấy từ meta nếu có, không thì null", () => {
    napTuTap([hang({})], T0);
    expect(layGiaTri(7, "t", T0)?.tsSource).toBeNull();
    napTuTap([hang({ meta: { adapterId: 7, tagKey: "t", tsSource: "server" } })], T0);
    expect(layGiaTri(7, "t", T0)?.tsSource).toBe("server");
  });
});

describe("mới nhất theo ts", () => {
  it("mới (ts=100) rồi cũ (ts=50) ⇒ giữ mới, danh sách khoá đổi rỗng, rx/lichSu không đổi", () => {
    expect(napTuTap([hang({ numValue: 10, ts: new Date(100) })], T0)).toEqual(["7:t"]);
    const cb = vi.fn();
    dangKyThayDoi(cb);
    expect(napTuTap([hang({ numValue: 5, ts: new Date(50), ingestedAt: new Date(T0 + 5000) })], T0 + 5000)).toEqual([]);
    expect(cb).not.toHaveBeenCalled();
    const g = layGiaTri(7, "t", T0 + 5000)!;
    expect(g).toMatchObject({ v: 10, ts: 100, rx: T0, lichSu: [10] });
  });

  it("ts bằng nhau ⇒ thay thế", () => {
    napTuTap([hang({ numValue: 1, ts: new Date(100) })], T0);
    expect(napTuTap([hang({ numValue: 2, ts: new Date(100) })], T0 + 1)).toEqual(["7:t"]);
    expect(layGiaTri(7, "t", T0 + 1)).toMatchObject({ v: 2, lichSu: [1, 2] });
  });

  it("lô lẫn cũ + mới: chỉ khoá có hàng mới hơn được báo đổi", () => {
    napTuTap([hang({ tagKey: "a", ts: new Date(100) }), hang({ tagKey: "b", ts: new Date(100) })], T0);
    const keys = napTuTap([hang({ tagKey: "a", ts: new Date(10) }), hang({ tagKey: "b", ts: new Date(200) })], T0);
    expect(keys).toEqual(["7:b"]);
  });
});

describe("lichSu", () => {
  it("60 hàng số liên tiếp ⇒ đúng 50, cuối là mới nhất, cũ → mới", () => {
    for (let i = 1; i <= 60; i++) napTuTap([hang({ numValue: i, ts: new Date(T0 + i) })], T0 + i);
    const g = layGiaTri(7, "t", T0 + 60)!;
    expect(g.lichSu).toHaveLength(50);
    expect(g.lichSu[49]).toBe(60);
    expect(g.lichSu[0]).toBe(11);
  });

  it("trả bản sao: sửa kết quả không làm hỏng bộ đệm", () => {
    napTuTap([hang({ numValue: 1 })], T0);
    const g = layGiaTri(7, "t", T0)!;
    g.lichSu.push(999);
    expect(layGiaTri(7, "t", T0)!.lichSu).toEqual([1]);
  });

  it("mẫu xấu / không phải số không thêm vào lịch sử", () => {
    napTuTap([hang({ numValue: 1 })], T0);
    napTuTap([hang({ numValue: null, quality: "bad" })], T0 + 1);
    napTuTap([hang({ numValue: null, textValue: "a" })], T0 + 2);
    expect(layGiaTri(7, "t", T0 + 2)!.lichSu).toEqual([1]);
  });
});

describe("stale", () => {
  it("pollMs 1000, không deadband: 2999 tươi, 3001 cũ", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: null, code: "A" });
    napTuTap([hang({})], T0);
    expect(layGiaTri(7, "t", T0 + 2999)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 3000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 3001)?.stale).toBe(true);
  });

  it("có deadband: còn tươi ở 60 s, cũ ở 70,001 s", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: true, machineId: null, code: "A" });
    napTuTap([hang({})], T0);
    expect(layGiaTri(7, "t", T0 + 60_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 70_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 70_001)?.stale).toBe(true);
  });

  it("adapter chưa có thông tin ⇒ pollMs 5000, không deadband (ngưỡng 15 s)", () => {
    napTuTap([hang({})], T0);
    expect(layGiaTri(7, "t", T0 + 15_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 15_001)?.stale).toBe(true);
  });

  it("poll chậm hơn deadband: ngưỡng = 3·poll", () => {
    datThongTinAdapter(7, { pollMs: 30_000, coDeadband: true, machineId: null, code: "A" });
    napTuTap([hang({})], T0);
    expect(layGiaTri(7, "t", T0 + 90_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 90_001)?.stale).toBe(true);
  });
});

describe("timTheoMayVaTag / thongTinAdapter", () => {
  it("hai adapter cùng máy cùng tagKey ⇒ 2 phần tử; máy khác không lẫn", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "A" });
    datThongTinAdapter(8, { pollMs: 1000, coDeadband: false, machineId: 5, code: "B" });
    datThongTinAdapter(9, { pollMs: 1000, coDeadband: false, machineId: 6, code: "C" });
    napTuTap([hang({ adapterId: 7 }), hang({ adapterId: 8 }), hang({ adapterId: 9 })], T0);
    const kq = timTheoMayVaTag(5, "t", T0);
    expect(kq).toHaveLength(2);
    expect(kq.map((g) => g.adapterId).sort()).toEqual([7, 8]);
    expect(timTheoMayVaTag(5, "khac", T0)).toEqual([]);
  });

  it("machineId của hàng ưu tiên hơn của adapter; adapter không gắn máy ⇒ null", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: null, code: "A" });
    napTuTap([hang({ adapterId: 7 }), hang({ adapterId: 8, tagKey: "u", machineId: 3 })], T0);
    expect(layGiaTri(7, "t", T0)?.machineId).toBeNull();
    expect(layGiaTri(8, "u", T0)?.machineId).toBe(3);
  });

  it("thongTinAdapter trả đúng thông tin đã đặt, null nếu chưa", () => {
    expect(thongTinAdapter(7)).toBeNull();
    datThongTinAdapter(7, { pollMs: 2000, coDeadband: true, machineId: 4, code: "A" });
    expect(thongTinAdapter(7)).toEqual({ pollMs: 2000, coDeadband: true, machineId: 4, code: "A" });
  });
});

describe("dangKyThayDoi", () => {
  it("nhận đúng khoá đã đổi; hàm huỷ gỡ được", () => {
    const cb = vi.fn();
    const huy = dangKyThayDoi(cb);
    napTuTap([hang({ adapterId: 7, tagKey: "a" }), hang({ adapterId: 8, tagKey: "b" }), hang({ meta: null })], T0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].sort()).toEqual(["7:a", "8:b"]);
    huy();
    napTuTap([hang({})], T0);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("không gọi khi không có gì đổi; người nghe ném lỗi không làm hỏng người sau", () => {
    const sau = vi.fn();
    dangKyThayDoi(() => {
      throw new Error("boom");
    });
    dangKyThayDoi(sau);
    napTuTap([hang({ meta: null })], T0);
    expect(sau).not.toHaveBeenCalled();
    expect(() => napTuTap([hang({})], T0)).not.toThrow();
    expect(sau).toHaveBeenCalledTimes(1);
  });
});

describe("khoiDongBoDemHienTai", () => {
  it("đăng ký tap một lần (idempotent) và tap đẩy vào bộ đệm", async () => {
    await khoiDongBoDemHienTai();
    await khoiDongBoDemHienTai();
    expect(taps).toHaveLength(1);
    taps[0]([hang({ numValue: 42 })]);
    expect(layGiaTri(7, "t")?.v).toBe(42);
  });

  it("Review Focus 5: nạp DB mang tuổi thật ⇒ stale ngay sau khởi động", async () => {
    const bay = Date.now();
    const muoiPhutTruoc = new Date(bay - 10 * 60_000);
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockResolvedValue([
      {
        deviceId: "ADP-A",
        metric: "t",
        numValue: 12,
        textValue: null,
        boolValue: null,
        quality: "good",
        ts: muoiPhutTruoc,
        ingestedAt: muoiPhutTruoc,
        meta: { adapterId: 7, tagKey: "t" },
      },
    ]);
    await khoiDongBoDemHienTai();
    expect(layMoiNhat).toHaveBeenCalledWith(["ADP-A"], 24 * 3600_000);
    const g = layGiaTri(7, "t", bay)!;
    expect(g.v).toBe(12);
    expect(g.rx).toBe(muoiPhutTruoc.getTime());
    expect(g.ageMs).toBeGreaterThanOrEqual(10 * 60_000);
    expect(g.stale).toBe(true);
  });

  it("hàng cũ chưa có meta.adapterId ⇒ suy từ mã thiết bị; mã lạ bị bỏ", async () => {
    const d = new Date(Date.now() - 1000);
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockResolvedValue([
      { deviceId: "ADP-A", metric: "old", numValue: 1, textValue: null, boolValue: null, quality: "good", ts: d, ingestedAt: d, meta: null },
      { deviceId: "LA", metric: "old", numValue: 1, textValue: null, boolValue: null, quality: "good", ts: d, ingestedAt: d, meta: null },
    ]);
    await khoiDongBoDemHienTai();
    expect(layGiaTri(7, "old")?.machineId).toBe(5);
    expect(timTheoMayVaTag(5, "old")).toHaveLength(1);
  });

  it("giá trị sống đến trước khi nạp DB xong không bị DB ghi đè", async () => {
    const cu = new Date(Date.now() - 60_000);
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockImplementation(async () => {
      taps[0]([hang({ numValue: 99 })]);
      return [{ deviceId: "ADP-A", metric: "t", numValue: 1, textValue: null, boolValue: null, quality: "good", ts: cu, ingestedAt: cu, meta: { adapterId: 7, tagKey: "t" } }];
    });
    await khoiDongBoDemHienTai();
    expect(layGiaTri(7, "t")?.v).toBe(99);
  });

  it("không có adapter nào ⇒ không truy vấn DB; lỗi DB không ném", async () => {
    await khoiDongBoDemHienTai();
    expect(layMoiNhat).not.toHaveBeenCalled();
    __datLaiBoDemHienTai();
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockRejectedValue(new Error("db down"));
    await expect(khoiDongBoDemHienTai()).resolves.toBeUndefined();
  });

  it("__datLaiBoDemHienTai gỡ tap + xoá dữ liệu + người nghe", async () => {
    await khoiDongBoDemHienTai();
    napTuTap([hang({})], T0);
    __datLaiBoDemHienTai();
    expect(huyTap).toHaveBeenCalledTimes(1);
    expect(layGiaTri(7, "t")).toBeNull();
    expect(thongTinAdapter(7)).toBeNull();
  });
});
