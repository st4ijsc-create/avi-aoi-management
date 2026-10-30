/**
 * SCADA R1b-2b-2a T3 fix round 1 (kiem-dinh, sau T3 S7 @1ccef4218) — ghim các mutant còn sống của bộ hẹn dự phòng ghi S7 + hạn lệnh kẹp.
 *   • s4  — chỉ errCode NGUYÊN VĂN của hết hạn ghi thư viện mới là "không rõ"; errCode khác (số, "Malformed Packet…", tiền tố) ⇒ `failed`, không hạ phiên.
 *   • s16 — bộ hẹn dự phòng hết ⇒ yêu cầu KHÁC đang bay trên CÙNG phiên reject `mat_lien_ket` NGAY (không đợi hạn riêng của nó).
 *   • s15 — phiên đã hạ không còn là phiên của driver: disconnect() / connect() sau đó KHÔNG đụng lại phiên cũ (dropConnection đúng một lần).
 *   • s17 — lời ghi THÀNH CÔNG không để lại bộ hẹn dự phòng treo.
 *   • M-2 — quyết định hạ phiên theo `loai` có kiểu của `LoiQuaHanYeuCauDriver`, không theo chữ của message.
 *   • M-4 — `OT_CONTROL_TIMEOUT_MS="Infinity"` không làm bộ hẹn dự phòng tràn `setTimeout` (⇒ 1 ms ⇒ mọi lời ghi "không rõ" + hạ phiên).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAN_DU_PHONG_GHI_DRIVER_MS, LoiQuaHanYeuCauDriver, ketCucKhongRoCua, laLoiMatLienKetKhiDangGui } from "./dangBay";
import { laQuaHanGhiS7, S7_ERRCODE_QUA_HAN_GHI } from "./s7Driver";
import { batDauDoLag } from "../../../testing/doLagBucleSuKien";
import { __datLaiCanhBaoHanMsChoTest } from "../hanLenhOt";

type GoiS7 = { timeoutError?: boolean; itemList: Array<Record<string, unknown>> };
const STOP_S7 = [{ tagKey: "stop", address: "DB1,X0.0", value: true, dataType: "bool" as const }];

/** nodes7 giả (hình thăm dò T3): `phanHoi(conn, cb)` quyết định gói + callback của mỗi writeItems; readAllItems không bao giờ gọi lại. */
function nodes7Gia(phanHoi: (conn: any, cb: (bad: boolean) => void) => void) {
  const ds: any[] = [];
  const Lib = function (this: any) {
    const c: any = {
      isoConnectionState: 4,
      writePacketArray: [] as GoiS7[],
      initiateConnection: vi.fn((_o: unknown, cb: (e?: unknown) => void) => cb()),
      setTranslationCB: vi.fn(),
      removeItems: vi.fn(),
      addItems: vi.fn(),
      readAllItems: vi.fn(() => undefined),
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        phanHoi(c, cb);
        return 0;
      }),
      dropConnection: vi.fn((cb?: () => void) => cb?.()),
      connectionCleanup: vi.fn(),
      on: vi.fn(),
    };
    ds.push(c);
    return c;
  } as unknown as new () => any;
  vi.doMock("nodes7", () => ({ default: Lib }));
  return ds;
}

async function s7VoiGia(phanHoi: (conn: any, cb: (bad: boolean) => void) => void, timeoutMs = 300) {
  const ds = nodes7Gia(phanHoi);
  const M = await import("./s7Driver");
  const d = new M.S7Driver();
  await d.connect({ endpoint: "127.0.0.1:102", timeoutMs });
  return { d, M, conn: ds[0], ds };
}

describe("T3 fix 1 — S7 (nodes7 giả): s4 / s15 / s16 / s17 / M-2", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("nodes7");
  });

  it("s4 — laQuaHanGhiS7: item valid=false với errCode SỐ / chuỗi KHÁC / chuỗi quá hạn có tiền tố-hậu tố ⇒ false; chỉ chuỗi NGUYÊN VĂN ⇒ true", () => {
    const goi = (errCode: unknown) => ({ writePacketArray: [{ timeoutError: false, itemList: [{ valid: false, errCode }] }] });
    for (const errCode of [10, 0, 255, "Malformed Packet - Less Than 1 Byte.  TDL 22 TP21 RL1", "Timeout error - zero length packet", "Invalid Response Code - 5", `x${S7_ERRCODE_QUA_HAN_GHI}`, `${S7_ERRCODE_QUA_HAN_GHI} `, ""]) {
      expect(laQuaHanGhiS7(goi(errCode)), String(errCode)).toBe(false);
    }
    expect(laQuaHanGhiS7(goi(S7_ERRCODE_QUA_HAN_GHI))).toBe(true);
  });

  it("s4 — PLC trả lời NHANH với errCode khác (Malformed Packet) ⇒ 'bad write quality' (failed), KHÔNG ketCucKhongRo, KHÔNG hạ phiên", async () => {
    const { d, conn } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: false, itemList: [{ valid: false, errCode: "Malformed Packet - Less Than 1 Byte.  TDL 22 TP21 RL1" }, { valid: false, errCode: 10 }] }];
      cb(true);
    });
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
    expect(conn.dropConnection).not.toHaveBeenCalled();
    expect(conn.connectionCleanup).not.toHaveBeenCalled();
    expect(d.isConnected()).toBe(true);
  });

  it("s16 — bộ hẹn dự phòng hết ⇒ đọc + lời ghi KHÁC đang bay trên CÙNG phiên reject 'mat_lien_ket' NGAY (cùng thời điểm ảo), không đợi hạn riêng", async () => {
    // hạn kết nối 20 s ⇒ hạn đọc riêng = 21 s; lời ghi thứ hai bắt đầu muộn 1 s ⇒ bộ hẹn dự phòng riêng của nó ở 7,5 s.
    const { d, conn } = await s7VoiGia(() => undefined, 20_000);
    vi.useFakeTimers();
    let kq1: unknown = null;
    const p1 = d.writeTags(STOP_S7).then((v) => (kq1 = v));
    await vi.advanceTimersByTimeAsync(1000);
    let loiDoc: unknown = null;
    let loiGhi2: unknown = null;
    const pDoc = d.readTags([{ tagKey: "t", address: "DB1,INT2", dataType: "int" }]).then(
      () => (loiDoc = "resolved"),
      (e) => (loiDoc = e),
    );
    const pGhi2 = d.writeTags([{ tagKey: "sp", address: "DB1,INT4", value: 3, dataType: "int" }]).then(
      () => (loiGhi2 = "resolved"),
      (e) => (loiGhi2 = e),
    );
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS - 1000 - 1);
    expect(kq1).toBeNull();
    expect(loiDoc).toBeNull();
    expect(loiGhi2).toBeNull();
    const t0 = performance.now();
    await vi.advanceTimersByTimeAsync(1); // đúng 6500 ảo: bộ hẹn dự phòng của lời ghi ĐẦU
    await Promise.all([p1, pDoc, pGhi2]);
    const thucMs = performance.now() - t0;
    expect(kq1).toMatchObject([{ tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver" }]); // chữ của message: ghim ở quaHanDriver.drivers.r1b2b2
    // hai yêu cầu kia: NGAY, cùng thời điểm ảo — không phải 7500 (dự phòng riêng của lời ghi 2) hay 21000 (hạn đọc)
    expect(laLoiMatLienKetKhiDangGui(loiDoc)).toBe(true);
    expect(ketCucKhongRoCua(loiDoc)).toBe("mat_lien_ket");
    expect(laLoiMatLienKetKhiDangGui(loiGhi2)).toBe(true);
    expect(ketCucKhongRoCua(loiGhi2)).toBe("mat_lien_ket");
    expect(vi.getTimerCount()).toBe(0); // không còn hẹn giờ nào (dự phòng lời ghi 2 + hạn đọc đã huỷ)
    expect(thucMs).toBeLessThan(1000);
    expect(conn.writeItems).toHaveBeenCalledTimes(2);
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
  });

  it("s15 — phiên đã hạ không còn là phiên của driver: disconnect() / connect() sau đó KHÔNG gọi lại dropConnection / connectionCleanup của phiên cũ", async () => {
    const { d, conn, ds } = await s7VoiGia(() => undefined);
    vi.useFakeTimers();
    const p = d.writeTags(STOP_S7);
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS);
    await p;
    vi.useRealTimers();
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
    expect(conn.connectionCleanup).toHaveBeenCalledTimes(1);
    expect(d.isConnected()).toBe(false);
    await d.disconnect();
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
    await d.connect({ endpoint: "127.0.0.1:102", timeoutMs: 300 });
    expect(ds).toHaveLength(2);
    expect(conn.dropConnection).toHaveBeenCalledTimes(1); // connect() không "hạ phiên cũ" lần nữa — phiên cũ đã không còn là this.conn
    expect(conn.connectionCleanup).toHaveBeenCalledTimes(1);
    expect(d.isConnected()).toBe(true);
  });

  it("s17 — lời ghi THÀNH CÔNG không để lại bộ hẹn dự phòng treo (getTimerCount = 0 ngay sau khi trả)", async () => {
    const { d } = await s7VoiGia((_c, cb) => cb(false));
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: true }]);
    expect(vi.getTimerCount()).toBe(0);
    // và lỗi PLC trả lời (failed) cũng vậy
    const { d: d2 } = await (async () => {
      vi.useRealTimers();
      vi.resetModules();
      return s7VoiGia((c, cb) => {
        c.writePacketArray = [{ timeoutError: false, itemList: [{ valid: false, writeResponse: 10 }] }];
        cb(true);
      });
    })();
    vi.useFakeTimers();
    expect(await d2.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("M-2 — quyết định hạ phiên theo `loai`, KHÔNG theo chữ của message: bộ hẹn dự phòng hết ⇒ qua_han_driver + hạ phiên (không kiểm chữ)", async () => {
    const { d, conn } = await s7VoiGia(() => undefined);
    vi.useFakeTimers();
    const p = d.writeTags(STOP_S7);
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS);
    const out = await p;
    vi.useRealTimers();
    expect(out).toMatchObject([{ tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver" }]);
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
    expect(conn.connectionCleanup).toHaveBeenCalledTimes(1);
    expect(d.isConnected()).toBe(false);
  });

  it("M-2 — LoiQuaHanYeuCauDriver mang `loai` có kiểu; bộ hẹn dự phòng ⇒ 'du_phong', hết hạn của thư viện ⇒ 'thu_vien'", async () => {
    expect(new LoiQuaHanYeuCauDriver("s7", "x", "du_phong").loai).toBe("du_phong");
    expect(new LoiQuaHanYeuCauDriver("s7", "x", "thu_vien").loai).toBe("thu_vien");
    // hết hạn của THƯ VIỆN (errCode thăm dò) ⇒ không hạ phiên; bộ hẹn dự phòng ⇒ hạ phiên (đã ghim ở quaHanDriver.drivers.r1b2b2.test.ts)
    const { d, conn } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: false, itemList: [{ valid: false, errCode: S7_ERRCODE_QUA_HAN_GHI }] }];
      cb(true);
    });
    const out = await d.writeTags(STOP_S7);
    expect(out[0]).toMatchObject({ ok: false, ketCucKhongRo: "qua_han_driver" });
    expect(conn.dropConnection).not.toHaveBeenCalled();
    expect(d.isConnected()).toBe(true);
  });
});

describe("T3 fix 1 — S7 (nodes7 THẬT + __s7commSim)", () => {
  const don: Array<() => unknown> = [];
  beforeEach(() => {
    vi.resetModules();
    __datLaiCanhBaoHanMsChoTest();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    while (don.length) await don.pop()!();
  });

  async function s7Sim(fault: "hangWrite" | "writeError" | "writeShort" | null, cfgTimeoutMs: number) {
    const { startS7commSim } = await import("./__s7commSim");
    const sim = await startS7commSim();
    sim.setFault(fault);
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    don.push(() => sim.close(), () => d.disconnect());
    await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: cfgTimeoutMs });
    const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;
    return { sim, d, soPduGhi };
  }

  it("M-4 — OT_CONTROL_TIMEOUT_MS='Infinity' ⇒ lời ghi S7 thành công BÌNH THƯỜNG (ok, không 'không rõ', không hạ phiên); cảnh báo một lần", async () => {
    vi.stubEnv("OT_CONTROL_TIMEOUT_MS", "Infinity");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sim, d, soPduGhi } = await s7Sim(null, 2000);
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: true }]);
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: true }]);
    expect(soPduGhi()).toBe(2);
    expect(d.isConnected()).toBe(true);
    expect(sim.stats().open).toBe(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("OT_CONTROL_TIMEOUT_MS")).length).toBe(1);
  }, 15_000);

  it("s4 (sim) — PLC trả mã lỗi 0x0A NHANH ⇒ 'bad write quality' (failed), không 'không rõ', KHÔNG hạ phiên; dưới hạn gói", async () => {
    const { sim, d } = await s7Sim("writeError", 2000);
    const lag = batDauDoLag();
    const t0 = performance.now();
    const out = await d.writeTags(STOP_S7);
    const ms = performance.now() - t0;
    expect(out).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
    expect(d.isConnected()).toBe(true);
    expect(sim.stats().open).toBe(1);
    expect(ms).toBeLessThan(500 + (await lag.dung(200)));
  }, 15_000);

  it("s4 (sim) — PLC trả lời NHANH nhưng CỤT (thiếu mã trả về của item: nodes7 đặt errCode 'Malformed Packet…', KHÁC chuỗi quá hạn) ⇒ failed, không 'không rõ', KHÔNG hạ phiên", async () => {
    const { sim, d } = await s7Sim("writeShort", 2000);
    const lag = batDauDoLag();
    const t0 = performance.now();
    // 2 item: 1 mã trả về cho item đầu, item thứ hai không có byte (1 item không dữ liệu = 21 byte < 22 ⇒ nodes7 đặt lại kết nối, không phải ca này)
    const out = await d.writeTags([...STOP_S7, { tagKey: "sp", address: "DB1,INT2", value: 7, dataType: "int" }]);
    const ms = performance.now() - t0;
    expect(out).toEqual([
      { tagKey: "stop", ok: false, error: "bad write quality" },
      { tagKey: "sp", ok: false, error: "bad write quality" },
    ]);
    expect(d.isConnected()).toBe(true);
    expect(sim.stats().open).toBe(1);
    expect(ms).toBeLessThan(500 + (await lag.dung(200)));
  }, 15_000);

  it("thăm dò thư viện thật: 'writeShort' ⇒ item valid=false + errCode bắt đầu 'Malformed Packet' (≠ S7_ERRCODE_QUA_HAN_GHI), callback(true) nhanh", async () => {
    const { createRequire } = await import("node:module");
    const require_ = createRequire(import.meta.url);
    const { startS7commSim } = await import("./__s7commSim");
    const sim = await startS7commSim();
    don.push(() => sim.close());
    sim.setFault("writeShort");
    const NodeS7 = require_("nodes7");
    const conn: any = new NodeS7({ silent: true });
    don.push(() => new Promise<void>((r) => conn.dropConnection(() => r())));
    await new Promise<void>((res, rej) => conn.initiateConnection({ port: sim.port, host: "127.0.0.1", rack: 0, slot: 1, timeout: 2000, silent: true }, (e: unknown) => (e ? rej(e) : res())));
    conn.setTranslationCB((t: string) => ({ a: "DB1,X0.0", b: "DB1,INT2" })[t]);
    const t0 = performance.now();
    const bad = await new Promise<unknown>((res) => conn.writeItems(["a", "b"], [true, 7], (b: unknown) => res(b)));
    const ms = performance.now() - t0;
    const items = (conn.writePacketArray as GoiS7[]).flatMap((g) => g.itemList);
    expect(bad).toBe(true);
    expect(ms).toBeLessThan(1000);
    expect(items[0]).toMatchObject({ writeResponse: 0xff }); // item đầu có mã trả về
    expect(items[1]).toMatchObject({ valid: false });
    expect(String(items[1]!.errCode)).toMatch(/^Malformed Packet/);
    expect(items.some((i) => i.errCode === S7_ERRCODE_QUA_HAN_GHI)).toBe(false);
    expect(sim.stats().open).toBe(1); // không đặt lại kết nối
    expect(laQuaHanGhiS7(conn)).toBe(false);
  }, 15_000);
});
