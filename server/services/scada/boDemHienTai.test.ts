/**
 * SCADA R0 Task 7 — bộ đệm giá trị hiện tại (adapterId, tagKey) → giá trị + chất lượng + tuổi.
 * Thuần RAM; đọc DB được mock. Nuôi bằng `napTuOt` (đường OT trong tiến trình), KHÔNG bằng tap/meta.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OtSample } from "../ot/otDriver";

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
  napTuOt,
  thongTinAdapter,
  timTheoMayVaTag,
} from "./boDemHienTai";

const T0 = 1_800_000_000_000;

function mau(over: Partial<OtSample> = {}): OtSample {
  return { tagKey: "t", raw: 1, value: 1, quality: "good", timestamp: new Date(T0), ...over };
}
/** Nạp qua đường tin cậy: adapter 7 (không gắn máy) trừ khi nói khác. */
function nap(samples: OtSample[], now: number = T0, adapterId = 7, machineId: number | null = null): string[] {
  return napTuOt({ adapterId, machineId }, samples, now);
}

beforeEach(() => {
  __datLaiBoDemHienTai();
  layMoiNhat.mockReset();
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
});
afterEach(() => {
  delete process.env.SCADA_LIVE_CACHE_ENABLED;
});

describe("napTuOt / layGiaTri", () => {
  it("lưu giá trị, chất lượng của một mẫu số; rx = now", () => {
    expect(nap([mau({ value: 3.5 })])).toEqual(["7:t"]);
    const g = layGiaTri(7, "t", T0);
    expect(g?.v).toBe(3.5);
    expect(g?.q).toBe("good");
    expect(g?.adapterId).toBe(7);
    expect(g?.ts).toBe(T0);
    expect(g?.rx).toBe(T0);
    expect(g?.ageMs).toBe(0);
  });

  it("cờ SCADA_LIVE_CACHE_ENABLED tắt ⇒ no-op, không nạp gì", () => {
    delete process.env.SCADA_LIVE_CACHE_ENABLED;
    expect(nap([mau()])).toEqual([]);
    expect(layGiaTri(7, "t", T0)).toBeNull();
    process.env.SCADA_LIVE_CACHE_ENABLED = "false";
    expect(nap([mau()])).toEqual([]);
    expect(layGiaTri(7, "t", T0)).toBeNull();
  });

  it("layGiaTri trả null khi chưa có", () => {
    expect(layGiaTri(1, "x")).toBeNull();
  });

  it("giá trị chữ / logic; mã trạng thái + lý do của mẫu xấu", () => {
    nap([
      mau({ tagKey: "s", value: "RUN" }),
      mau({ tagKey: "b", value: false }),
      mau({ tagKey: "x", value: null, quality: "bad", statusCode: "BadNodeIdUnknown", reason: "comm_lost" }),
    ]);
    expect(layGiaTri(7, "s", T0)?.v).toBe("RUN");
    expect(layGiaTri(7, "b", T0)?.v).toBe(false);
    const x = layGiaTri(7, "x", T0)!;
    expect(x.v).toBeNull();
    expect(x.q).toBe("bad");
    expect(x.statusCode).toBe("BadNodeIdUnknown");
    expect(x.reason).toBe("comm_lost");
  });

  it("lý do lạ bị bỏ (null) thay vì lọt vào bộ đệm", () => {
    nap([mau({ quality: "uncertain", reason: "tuy_tien" as never })]);
    expect(layGiaTri(7, "t", T0)?.reason).toBeNull();
  });

  it("uncertain không có giá trị ⇒ giữ giá trị cuối; bad ⇒ giữ v của mẫu (null)", () => {
    nap([mau({ value: 9 })]);
    nap([mau({ value: null, quality: "uncertain", timestamp: new Date(T0 + 1000) })], T0 + 1000);
    expect(layGiaTri(7, "t", T0 + 1000)).toMatchObject({ v: 9, q: "uncertain" });
    nap([mau({ value: null, quality: "bad", timestamp: new Date(T0 + 2000) })], T0 + 2000);
    expect(layGiaTri(7, "t", T0 + 2000)).toMatchObject({ v: null, q: "bad" });
  });

  it("mẫu hỏng (không tagKey) hoặc mang tsReject bị bỏ, không ném", () => {
    expect(() => nap([mau({ tagKey: "" }), mau({ tsReject: "ts_no_timezone" }), null as never])).not.toThrow();
    expect(nap([mau({ tsReject: "ts_no_timezone" })])).toEqual([]);
    expect(layGiaTri(7, "t", T0)).toBeNull();
  });

  it("tsSource lấy từ mẫu OT, thiếu ⇒ null", () => {
    nap([mau()]);
    expect(layGiaTri(7, "t", T0)?.tsSource).toBeNull();
    nap([mau({ tsSource: "server", timestamp: new Date(T0 + 1) })], T0 + 1);
    expect(layGiaTri(7, "t", T0 + 1)?.tsSource).toBe("server");
  });
});

describe("mới nhất theo ts", () => {
  it("mới (ts=100) rồi cũ (ts=50) ⇒ giữ mới, danh sách khoá đổi rỗng, rx/lichSu không đổi", () => {
    expect(nap([mau({ value: 10, timestamp: new Date(100) })])).toEqual(["7:t"]);
    const cb = vi.fn();
    dangKyThayDoi(cb);
    expect(nap([mau({ value: 5, timestamp: new Date(50) })], T0 + 5000)).toEqual([]);
    expect(cb).not.toHaveBeenCalled();
    expect(layGiaTri(7, "t", T0 + 5000)).toMatchObject({ v: 10, ts: 100, rx: T0, lichSu: [10] });
  });

  it("ts bằng nhau ⇒ thay thế", () => {
    nap([mau({ value: 1, timestamp: new Date(100) })]);
    expect(nap([mau({ value: 2, timestamp: new Date(100) })], T0 + 1)).toEqual(["7:t"]);
    expect(layGiaTri(7, "t", T0 + 1)).toMatchObject({ v: 2, lichSu: [1, 2] });
  });

  it("lô lẫn cũ + mới: chỉ khoá có mẫu mới hơn được báo đổi", () => {
    nap([mau({ tagKey: "a", timestamp: new Date(100) }), mau({ tagKey: "b", timestamp: new Date(100) })]);
    const keys = nap([mau({ tagKey: "a", timestamp: new Date(10) }), mau({ tagKey: "b", timestamp: new Date(200) })]);
    expect(keys).toEqual(["7:b"]);
  });
});

describe("lichSu", () => {
  it("60 mẫu số liên tiếp ⇒ đúng 50, cuối là mới nhất, cũ → mới", () => {
    for (let i = 1; i <= 60; i++) nap([mau({ value: i, timestamp: new Date(T0 + i) })], T0 + i);
    const g = layGiaTri(7, "t", T0 + 60)!;
    expect(g.lichSu).toHaveLength(50);
    expect(g.lichSu[49]).toBe(60);
    expect(g.lichSu[0]).toBe(11);
  });

  it("trả bản sao: sửa kết quả không làm hỏng bộ đệm", () => {
    nap([mau({ value: 1 })]);
    const g = layGiaTri(7, "t", T0)!;
    g.lichSu.push(999);
    expect(layGiaTri(7, "t", T0)!.lichSu).toEqual([1]);
  });

  it("mẫu xấu / không phải số không thêm vào lịch sử", () => {
    nap([mau({ value: 1 })]);
    nap([mau({ value: null, quality: "bad", timestamp: new Date(T0 + 1) })], T0 + 1);
    nap([mau({ value: "a", timestamp: new Date(T0 + 2) })], T0 + 2);
    expect(layGiaTri(7, "t", T0 + 2)!.lichSu).toEqual([1]);
  });
});

describe("stale", () => {
  it("pollMs 1000, không deadband: 2999 tươi, 3001 cũ", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: null, code: "A" });
    nap([mau()]);
    expect(layGiaTri(7, "t", T0 + 2999)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 3000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 3001)?.stale).toBe(true);
  });

  it("có deadband: còn tươi ở 60 s, cũ ở 70,001 s", () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: true, machineId: null, code: "A" });
    nap([mau()]);
    expect(layGiaTri(7, "t", T0 + 60_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 70_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 70_001)?.stale).toBe(true);
  });

  it("adapter chưa có thông tin ⇒ pollMs 5000, không deadband (ngưỡng 15 s)", () => {
    nap([mau()]);
    expect(layGiaTri(7, "t", T0 + 15_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 15_001)?.stale).toBe(true);
  });

  it("poll chậm hơn deadband: ngưỡng = 3·poll", () => {
    datThongTinAdapter(7, { pollMs: 30_000, coDeadband: true, machineId: null, code: "A" });
    nap([mau()]);
    expect(layGiaTri(7, "t", T0 + 90_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 90_001)?.stale).toBe(true);
  });
});

describe("timTheoMayVaTag / thongTinAdapter", () => {
  it("hai adapter cùng máy cùng tagKey ⇒ 2 phần tử; máy khác không lẫn", () => {
    nap([mau()], T0, 7, 5);
    nap([mau()], T0, 8, 5);
    nap([mau()], T0, 9, 6);
    const kq = timTheoMayVaTag(5, "t", T0);
    expect(kq).toHaveLength(2);
    expect(kq.map((g) => g.adapterId).sort()).toEqual([7, 8]);
    expect(timTheoMayVaTag(5, "khac", T0)).toEqual([]);
  });

  it("adapter không gắn máy ⇒ machineId null, không lọt vào máy nào", () => {
    nap([mau()], T0, 7, null);
    expect(layGiaTri(7, "t", T0)?.machineId).toBeNull();
    expect(timTheoMayVaTag(5, "t", T0)).toEqual([]);
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
    nap([mau({ tagKey: "a" })], T0, 7);
    nap([mau({ tagKey: "b" })], T0, 8);
    nap([mau({ tagKey: "c" }), mau({ tagKey: "d" })], T0, 9);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb.mock.calls[0][0]).toEqual(["7:a"]);
    expect(cb.mock.calls[2][0].sort()).toEqual(["9:c", "9:d"]);
    huy();
    nap([mau({ tagKey: "a", timestamp: new Date(T0 + 1) })], T0 + 1);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("không gọi khi không có gì đổi; người nghe ném lỗi không làm hỏng người sau", () => {
    const sau = vi.fn();
    dangKyThayDoi(() => {
      throw new Error("boom");
    });
    dangKyThayDoi(sau);
    nap([mau({ tagKey: "" })]);
    expect(sau).not.toHaveBeenCalled();
    expect(() => nap([mau()])).not.toThrow();
    expect(sau).toHaveBeenCalledTimes(1);
  });
});

describe("khoiDongBoDemHienTai (nạp DB)", () => {
  const hangDb = (over: Record<string, unknown> = {}) => ({
    deviceId: "ADP-A",
    metric: "t",
    numValue: 12,
    textValue: null,
    boolValue: null,
    quality: "good",
    ts: new Date(Date.now() - 10 * 60_000),
    ingestedAt: new Date(Date.now() - 10 * 60_000),
    meta: null,
    ...over,
  });

  it("Review Focus 5: nạp DB mang tuổi thật ⇒ stale ngay sau khởi động", async () => {
    const bay = Date.now();
    const muoiPhutTruoc = new Date(bay - 10 * 60_000);
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockResolvedValue([hangDb({ ts: muoiPhutTruoc, ingestedAt: muoiPhutTruoc })]);
    await khoiDongBoDemHienTai();
    expect(layMoiNhat).toHaveBeenCalledWith(["ADP-A"], 24 * 3600_000);
    const g = layGiaTri(7, "t", bay)!;
    expect(g.v).toBe(12);
    expect(g.rx).toBe(muoiPhutTruoc.getTime());
    expect(g.machineId).toBe(5);
    expect(g.ageMs).toBeGreaterThanOrEqual(10 * 60_000);
    expect(g.stale).toBe(true);
  });

  it("khoá lấy từ sổ đăng ký (code → adapterId, metric → tagKey), KHÔNG từ meta giả", async () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    datThongTinAdapter(8, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-B" });
    layMoiNhat.mockResolvedValue([hangDb({ meta: { adapterId: 8, tagKey: "gia" } })]);
    await khoiDongBoDemHienTai();
    expect(layGiaTri(7, "t")?.v).toBe(12);
    expect(layGiaTri(8, "gia")).toBeNull();
    expect(layGiaTri(8, "t")).toBeNull();
  });

  it("bootstrap bỏ hàng có deviceId không khớp code của adapter nào đã đăng ký", async () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockResolvedValue([
      hangDb({ deviceId: "KE-LA", meta: { adapterId: 7, tagKey: "t" } }),
      hangDb({ deviceId: "ADP-A", metric: "ok" }),
    ]);
    await khoiDongBoDemHienTai();
    expect(layGiaTri(7, "t")).toBeNull();
    expect(layGiaTri(7, "ok")?.v).toBe(12);
  });

  it("giá trị sống đến trước khi nạp DB xong không bị DB ghi đè", async () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockImplementation(async () => {
      napTuOt({ adapterId: 7, machineId: 5 }, [mau({ value: 99, timestamp: new Date() })]);
      return [hangDb({ numValue: 1 })];
    });
    await khoiDongBoDemHienTai();
    expect(layGiaTri(7, "t")?.v).toBe(99);
  });

  it("idempotent: gọi hai lần chỉ truy vấn DB một lần", async () => {
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockResolvedValue([]);
    await khoiDongBoDemHienTai();
    await khoiDongBoDemHienTai();
    expect(layMoiNhat).toHaveBeenCalledTimes(1);
  });

  it("không có adapter nào ⇒ không truy vấn DB; lỗi DB không ném", async () => {
    await khoiDongBoDemHienTai();
    expect(layMoiNhat).not.toHaveBeenCalled();
    __datLaiBoDemHienTai();
    datThongTinAdapter(7, { pollMs: 1000, coDeadband: false, machineId: 5, code: "ADP-A" });
    layMoiNhat.mockRejectedValue(new Error("db down"));
    await expect(khoiDongBoDemHienTai()).resolves.toBeUndefined();
  });

  it("__datLaiBoDemHienTai xoá dữ liệu + thông tin + người nghe", () => {
    nap([mau()]);
    datThongTinAdapter(7, { pollMs: 1, coDeadband: false, machineId: null, code: "A" });
    __datLaiBoDemHienTai();
    expect(layGiaTri(7, "t")).toBeNull();
    expect(thongTinAdapter(7)).toBeNull();
  });
});
