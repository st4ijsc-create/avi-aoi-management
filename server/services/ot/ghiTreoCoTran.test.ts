/**
 * SCADA R1b-2b-2a Task 1 (mục 61) + fix round 1 — `ghiCoTran`: MỘT bộ đếm ghi treo + HÀNG CHỜ có trần cho mọi lượt ghi nền của đường STOP.
 *
 * Ngữ nghĩa IN-FLIGHT (kiem-dinh KD-A1): +1 lúc PHÁT, −1 lúc XONG (kể cả lượt bỏ rơi), trần 8 áp từ lượt ĐẦU; hạn 500 ms chỉ quyết định lúc trả
 * lời người gọi đang `await`. −1 trên MỌI đường thoát. Fix round 1 (điều phối DUYỆT): đầy trần ⇒ XẾP HÀNG (MỘT FIFO ≤ 256 / 10 phút, xả dưới CÙNG
 * trần, giữ giờ sự kiện); chỉ tràn / quá tuổi / quá lớn / tắt máy mới BỎ ⇒ MỘT dòng tóm tắt (không bao giờ bị bỏ; ghi hỏng ⇒ giữ lại, thử lại).
 * Đồng hồ GIẢ (setTimeout / clearTimeout / Date; setImmediate thật để Node kịp phát unhandledRejection) — tất định.
 * Đột biến bắt buộc (ghi trong báo cáo task): đếm chỉ khi quá hạn · kiểm trần sau `viec` · bỏ `giam()` · bỏ dòng tóm tắt · xả vượt trần · mất giờ
 * sự kiện · bỏ tóm tắt khi ghi hỏng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../logger";
import {
  _datGhiTomTatChoTest,
  _datLaiGhiTreoChoTest,
  demGhiBoQuaDay,
  ghiCoTran,
  HAN_GHI_TREO_MS,
  HAN_THU_LAI_TOM_TAT_MS,
  soGhiTreoStop,
  themLucSuKien,
  TRAN_BYTE_MUC_HANG_CHO,
  TRAN_GHI_TREO_STOP,
  TRAN_HANG_CHO_GHI_NEN,
  TRAN_REQUEST_ID_TOM_TAT,
  trangThaiGhiTreo,
  TUOI_TOI_DA_HANG_CHO_MS,
  xaHangChoKhiTat,
  type BoiCanhGhi,
  type TomTatBoRoi,
} from "./ghiTreoCoTran";
import { HAN_GHI_SO_STOP_HMI_MS, soGhiSoTreoStopHmi, TRAN_GHI_SO_TREO_STOP_HMI } from "../scada/lenhHmi";

const nhuong = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};
function hoan<T = void>() {
  let giai!: (v: T) => void;
  let tuChoi!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    giai = a;
    tuChoi = b;
  });
  return { p, giai, tuChoi };
}
const treoMai = () => new Promise<never>(() => undefined);

let khongXuLy: unknown[] = [];
const nghe = (e: unknown) => void khongXuLy.push(e);
let loiLog: ReturnType<typeof vi.spyOn>;
let canhLog: ReturnType<typeof vi.spyOn>;
let infoLog: ReturnType<typeof vi.spyOn>;
let tomTat: TomTatBoRoi[];
const nhan = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => c[0] as { cho?: string; err?: string; requestId?: string; noiDung?: unknown }).filter((o) => typeof o?.cho === "string");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  _datLaiGhiTreoChoTest();
  tomTat = [];
  _datGhiTomTatChoTest(async (tt) => void tomTat.push(tt));
  khongXuLy = [];
  process.on("unhandledRejection", nghe);
  loiLog = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
  canhLog = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
  infoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
});
afterEach(() => {
  process.off("unhandledRejection", nghe);
  _datLaiGhiTreoChoTest();
  _datGhiTomTatChoTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** đầy trần bằng TRAN lượt treo có thể giải tay */
function dayTran() {
  const ds = Array.from({ length: TRAN_GHI_TREO_STOP }, () => hoan());
  ds.forEach((h, i) => void ghiCoTran(() => h.p, { nhan: `day${i}`, requestId: "d" }));
  return ds;
}

describe("R1b-2b-2a T1 — hằng + một bộ đếm", () => {
  it("HAN_GHI_TREO_MS = 500, TRAN_GHI_TREO_STOP = 8; hàng chờ 256 / 10 phút / 16 KB", () => {
    expect(HAN_GHI_TREO_MS).toBe(500);
    expect(TRAN_GHI_TREO_STOP).toBe(8);
    expect(TRAN_HANG_CHO_GHI_NEN).toBe(256);
    expect(TUOI_TOI_DA_HANG_CHO_MS).toBe(600_000);
    expect(TRAN_BYTE_MUC_HANG_CHO).toBe(16_384);
  });

  it("TRAN_GHI_SO_TREO_STOP_HMI của lenhHmi CHÍNH LÀ TRAN_GHI_TREO_STOP; soGhiSoTreoStopHmi đọc CÙNG bộ đếm", async () => {
    expect(TRAN_GHI_SO_TREO_STOP_HMI).toBe(TRAN_GHI_TREO_STOP);
    expect(HAN_GHI_SO_STOP_HMI_MS).toBe(HAN_GHI_TREO_MS);
    const v = hoan();
    void ghiCoTran(() => v.p, { nhan: "x", requestId: "r" });
    expect(soGhiTreoStop()).toBe(1);
    expect(soGhiSoTreoStopHmi()).toBe(1);
    v.giai();
    await nhuong();
    expect(soGhiSoTreoStopHmi()).toBe(0);
  });
});

describe("★ KD-A1 — đếm IN-FLIGHT, trần từ lượt đầu; đầy ⇒ XẾP HÀNG (không phát, không bỏ), trả NGAY", () => {
  it("★ 8 lượt ĐANG BAY (chưa tới hạn 500 ms) ⇒ lượt 9 KHÔNG được phát ngay, XẾP HÀNG (log `_xep_hang`), trả NGAY; một lượt xong ⇒ lượt 9 được phát (daXepHang)", async () => {
    const ds = dayTran();
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    const viec9 = vi.fn((_t: BoiCanhGhi) => Promise.resolve());
    const boQua = vi.fn();
    const t0 = Date.now();
    await ghiCoTran(viec9, { nhan: "audit_hmi_stop", requestId: "r9", noiDung: { bang: "control_audit_log" }, khiBoQua: boQua });
    expect(Date.now() - t0, "trả NGAY (STOP không chờ hàng chờ)").toBe(0);
    expect(viec9).not.toHaveBeenCalled();
    expect(boQua).not.toHaveBeenCalled();
    expect(nhan(canhLog).map((o) => o.cho)).toEqual(["audit_hmi_stop_xep_hang"]);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 8, hangCho: 1, dayTu: expect.any(String) });
    ds[0].giai();
    await nhuong();
    expect(viec9).toHaveBeenCalledTimes(1);
    expect(viec9.mock.calls[0][0].daXepHang).toBe(true);
    expect(demGhiBoQuaDay().tong).toBe(0);
  });

  it("đếm +1 lúc PHÁT (trước hạn) và −1 lúc xong trong hạn — không log; lượt phát ngay nhận daXepHang = false", async () => {
    const v = hoan();
    const viec = vi.fn((_t: BoiCanhGhi) => v.p);
    const p = ghiCoTran(viec, { nhan: "x", requestId: "r1" });
    expect(viec.mock.calls[0][0].daXepHang).toBe(false);
    expect(soGhiTreoStop()).toBe(1);
    await vi.advanceTimersByTimeAsync(30);
    v.giai();
    await p;
    expect(soGhiTreoStop()).toBe(0);
    expect(nhan(loiLog)).toEqual([]);
  });

  it("hạn 500 ms chỉ quyết định lúc trả lời: trả ĐÚNG lúc 500 ms, lượt bỏ rơi VẪN tính vào trần tới khi xong", async () => {
    const v = hoan();
    const o = { xong: false, luc: -1 };
    const t0 = Date.now();
    void ghiCoTran(() => v.p, { nhan: "attempts_hmi_stop", requestId: "r" }).then(() => {
      o.xong = true;
      o.luc = Date.now() - t0;
    });
    await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS - 1);
    expect(o.xong).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(o).toEqual({ xong: true, luc: HAN_GHI_TREO_MS });
    expect(nhan(loiLog).map((x) => x.cho)).toEqual(["attempts_hmi_stop_qua_han"]);
    expect(soGhiTreoStop()).toBe(1);
    v.giai();
    await nhuong();
    expect(soGhiTreoStop()).toBe(0);
    expect(nhan(infoLog).map((x) => x.cho)).toEqual(["attempts_hmi_stop_muon_xong"]);
  });

  it("review M-5: audit (`bang` control_audit_log) quá hạn ⇒ WARN (không phải error); sổ ⇒ error", async () => {
    void ghiCoTran(treoMai, { nhan: "audit_hmi_stop", requestId: "a", noiDung: { bang: "control_audit_log" } });
    void ghiCoTran(treoMai, { nhan: "attempts_hmi_stop", requestId: "b", noiDung: { bang: "scada_command_attempts" } });
    await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS);
    expect(nhan(canhLog).map((o) => o.cho)).toEqual(["audit_hmi_stop_qua_han"]);
    expect(nhan(loiLog).map((o) => o.cho)).toEqual(["attempts_hmi_stop_qua_han"]);
  });

  it("DB nhanh không bao giờ xếp hàng: 100 lượt xong trong 10 ms (tuần tự) ⇒ đếm 0, mọi viec được gọi, 0 xếp hàng / bỏ", async () => {
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const p = ghiCoTran(
        () =>
          new Promise<void>((r) => {
            setTimeout(() => {
              n++;
              r();
            }, 10);
          }),
        { nhan: "audit_hmi_stop", requestId: `n${i}` },
      );
      await vi.advanceTimersByTimeAsync(10);
      await p;
    }
    expect(n).toBe(100);
    expect(soGhiTreoStop()).toBe(0);
    expect(nhan(loiLog)).toEqual([]);
    expect(nhan(canhLog)).toEqual([]);
    expect(demGhiBoQuaDay().tong).toBe(0);
  });
});

describe("★ fix round 1 — hàng chờ: FIFO, xả dưới CÙNG trần, giờ sự kiện", () => {
  it("★ xả FIFO và KHÔNG BAO GIỜ vượt trần: 8 treo + 200 xếp hàng, mỗi lượt xả xong ngay ⇒ đúng thứ tự, đang bay ≤ 8 ở MỌI lần phát", async () => {
    const ds = dayTran();
    const thuTu: number[] = [];
    let maxKhiPhat = 0;
    for (let i = 0; i < 200; i++) {
      void ghiCoTran(
        () => {
          maxKhiPhat = Math.max(maxKhiPhat, soGhiTreoStop());
          thuTu.push(i);
          return new Promise<void>((r) => setTimeout(r, 1 + (i % 5)));
        },
        { nhan: "fifo", requestId: `f${i}` },
      );
    }
    expect(trangThaiGhiTreo().hangCho).toBe(200);
    for (const h of ds) h.giai();
    for (let k = 0; k < 200; k++) await vi.advanceTimersByTimeAsync(5);
    await nhuong();
    expect(thuTu).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(maxKhiPhat, "đang bay tại lúc phát (đã tính lượt này)").toBeLessThanOrEqual(TRAN_GHI_TREO_STOP);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, dayTu: null });
  });

  it("★ lượt mới KHÔNG vượt hàng chờ (không đói): còn hàng chờ ⇒ lượt mới xếp SAU dù vừa có chỗ", async () => {
    const ds = dayTran();
    const thuTu: string[] = [];
    void ghiCoTran(async () => void thuTu.push("cu"), { nhan: "cu", requestId: "c" });
    ds[0].giai();
    void ghiCoTran(async () => void thuTu.push("moi"), { nhan: "moi", requestId: "m" });
    await nhuong();
    expect(thuTu).toEqual(["cu", "moi"]);
  });

  it("★ giờ SỰ KIỆN giữ nguyên: xếp hàng ở t=0, xả ở t=7 s ⇒ viec nhận lucSuKien = t0 (không phải giờ xả); themLucSuKien ghi nó vào after", async () => {
    const ds = dayTran();
    const t0 = Date.now();
    let nhanDuoc: BoiCanhGhi | null = null;
    void ghiCoTran(
      async (t) => {
        nhanDuoc = t;
      },
      { nhan: "audit_hmi_stop", requestId: "e" },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    ds[0].giai();
    await nhuong();
    expect(nhanDuoc).not.toBeNull();
    expect(nhanDuoc!.daXepHang).toBe(true);
    expect(nhanDuoc!.lucSuKien.getTime()).toBe(t0);
    const e = themLucSuKien({ action: "scada_hmi_stop", after: { ketCuc: "DA_GUI" } }, nhanDuoc!);
    expect(e.after).toEqual({ ketCuc: "DA_GUI", lucSuKien: new Date(t0).toISOString(), tuHangCho: true });
    expect(themLucSuKien({ action: "x", after: { a: 1 } }, { daXepHang: false, lucSuKien: new Date() }).after).toEqual({ a: 1 });
  });

  it("★ TRÀN (256) ⇒ lượt 257 BỊ BỎ: log `_bo_tran` có nội dung, khiBoQua, đếm; MỘT dòng tóm tắt khi có chỗ (đúng số, nhãn, requestIds có trần)", async () => {
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) void ghiCoTran(async () => undefined, { nhan: "cho", requestId: `q${i}` });
    const boQua = vi.fn();
    for (let i = 0; i < 40; i++) {
      await ghiCoTran(async () => undefined, { nhan: "audit_hmi_stop", requestId: `tran${i}`, noiDung: { bang: "control_audit_log", action: "scada_hmi_stop" }, khiBoQua: boQua });
    }
    expect(boQua).toHaveBeenCalledTimes(40);
    const bo = nhan(loiLog).filter((o) => o.cho === "audit_hmi_stop_bo_tran");
    expect(bo).toHaveLength(40);
    expect(bo[0].noiDung).toEqual({ bang: "control_audit_log", action: "scada_hmi_stop" });
    expect(demGhiBoQuaDay()).toMatchObject({ tong: 40, theoBang: { control_audit_log: 40 } });
    expect(trangThaiGhiTreo().tomTatCho).toBe(40);
    expect(tomTat).toEqual([]); // chưa có chỗ
    ds[0].giai();
    await nhuong(10);
    expect(tomTat).toHaveLength(1);
    expect(tomTat[0]).toMatchObject({ soLuong: 40, theoLyDo: { tran: 40 }, theoNhan: { audit_hmi_stop: 40 }, theoBang: { control_audit_log: 40 } });
    expect(tomTat[0].requestIds).toHaveLength(TRAN_REQUEST_ID_TOM_TAT);
    expect(tomTat[0].soRequestIdBoBot).toBe(40 - TRAN_REQUEST_ID_TOM_TAT);
    for (const h of ds.slice(1)) h.giai();
    await nhuong(10);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, tomTatCho: 0 });
  });

  it("QUÁ TUỔI (10 phút) ⇒ `_bo_qua_tuoi` + tóm tắt; QUÁ LỚN (> 16 KB) ⇒ `_bo_qua_lon`, không vào hàng chờ", async () => {
    const ds = dayTran();
    const gia = vi.fn(async () => undefined);
    void ghiCoTran(gia, { nhan: "gia", requestId: "g" });
    await ghiCoTran(async () => undefined, { nhan: "lon", requestId: "l", noiDung: { bang: "control_audit_log", x: "y".repeat(TRAN_BYTE_MUC_HANG_CHO + 1) } });
    const bo = () => nhan(loiLog).filter((o) => /_bo_/.test(o.cho ?? ""));
    expect(bo().map((o) => o.cho)).toEqual(["lon_bo_qua_lon"]);
    expect((bo()[0].noiDung as { x: string }).x.length).toBeLessThan(300); // nội dung CẮT trong log
    expect(trangThaiGhiTreo().hangCho).toBe(1);
    await vi.advanceTimersByTimeAsync(TUOI_TOI_DA_HANG_CHO_MS + 1);
    expect(trangThaiGhiTreo().hangCho).toBe(0);
    expect(bo().map((o) => o.cho)).toEqual(["lon_bo_qua_lon", "gia_bo_qua_tuoi"]);
    ds[0].giai();
    await nhuong(10);
    expect(gia).not.toHaveBeenCalled();
    expect(tomTat).toHaveLength(1);
    expect(tomTat[0]).toMatchObject({ soLuong: 2, theoLyDo: { qua_lon: 1, qua_tuoi: 1 } });
  });

  it("★ dòng tóm tắt KHÔNG BAO GIỜ bị bỏ: ghi hỏng ⇒ giữ lại, GỘP lượt bỏ mới, thử lại (hẹn giờ) ⇒ MỘT tóm tắt đúng tổng", async () => {
    let hong = 2;
    _datGhiTomTatChoTest(async (tt) => {
      if (hong-- > 0) throw new Error("DB hỏng");
      tomTat.push(tt);
    });
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) void ghiCoTran(async () => undefined, { nhan: "cho", requestId: `q${i}` });
    await ghiCoTran(async () => undefined, { nhan: "a", requestId: "a1" });
    ds[0].giai(); // chỗ trống ⇒ tóm tắt (1) — hỏng
    await nhuong(10);
    expect(tomTat).toEqual([]);
    expect(trangThaiGhiTreo().tomTatCho).toBe(1);
    // một lượt bỏ mới trong lúc chờ thử lại (hàng chờ lại đầy ⇒ tràn)
    const cho2: Array<ReturnType<typeof hoan>> = [];
    for (let i = 0; i < 300 && trangThaiGhiTreo().hangCho < TRAN_HANG_CHO_GHI_NEN; i++) {
      const h = hoan();
      cho2.push(h);
      void ghiCoTran(() => h.p, { nhan: "cho2", requestId: `p${i}` });
    }
    await ghiCoTran(async () => undefined, { nhan: "b", requestId: "b1" });
    expect(trangThaiGhiTreo().tomTatCho).toBe(2);
    for (const h of ds) h.giai();
    for (let k = 0; k < 5; k++) {
      await vi.advanceTimersByTimeAsync(HAN_THU_LAI_TOM_TAT_MS);
      for (const h of cho2) h.giai();
      await nhuong(10);
    }
    expect(tomTat.length).toBeGreaterThanOrEqual(1);
    expect(tomTat.reduce((s, t) => s + t.soLuong, 0)).toBe(2);
    expect(nhan(loiLog).filter((o) => o.cho === "ot_stop_ghi_nen_bo_roi_tom_tat_loi").length).toBeGreaterThanOrEqual(1);
  });

  it("dòng tóm tắt chiếm MỘT chỗ của CÙNG trần (đang bay ≤ 8 cả lúc ghi tóm tắt)", async () => {
    const giuTomTat = hoan();
    let demLucGhi = -1;
    _datGhiTomTatChoTest(() => {
      demLucGhi = soGhiTreoStop();
      return giuTomTat.p;
    });
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) void ghiCoTran(treoMai, { nhan: "cho", requestId: `q${i}` });
    await ghiCoTran(async () => undefined, { nhan: "a", requestId: "a1" });
    ds[0].giai();
    await nhuong(10);
    expect(demLucGhi).toBe(TRAN_GHI_TREO_STOP);
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    giuTomTat.giai();
  });
});

describe("★ điều phối — −1 trên MỌI đường thoát; về 0 sau khi hàng chờ xả hết (kể cả lỗi ghi)", () => {
  it("lượt bỏ rơi reject ở 800 ms ⇒ đếm về 0, khiLoi(e, true), 0 unhandledRejection", async () => {
    const v = hoan();
    const khiLoi = vi.fn();
    void ghiCoTran(() => v.p, { nhan: "audit_hmi_stop", requestId: "r", khiLoi });
    await vi.advanceTimersByTimeAsync(800);
    expect(soGhiTreoStop()).toBe(1);
    v.tuChoi(new Error("ghi muộn hỏng"));
    await nhuong(5);
    expect(soGhiTreoStop()).toBe(0);
    expect(khiLoi).toHaveBeenCalledTimes(1);
    expect(khiLoi.mock.calls[0][1]).toBe(true);
    expect(khongXuLy).toEqual([]);
  });

  it("lỗi trong hạn ⇒ khiLoi(e, false); vắng khiLoi ⇒ log mặc định nhãn gốc; không reject", async () => {
    const v = hoan();
    const khiLoi = vi.fn();
    const p = ghiCoTran(() => v.p, { nhan: "a", requestId: "r", khiLoi });
    v.tuChoi(new Error("ECONNRESET giả"));
    await expect(p).resolves.toBeUndefined();
    expect(khiLoi.mock.calls[0][1]).toBe(false);
    const v2 = hoan();
    const p2 = ghiCoTran(() => v2.p, { nhan: "b", requestId: "r2" });
    v2.tuChoi(new Error("lỗi 2"));
    await p2;
    expect(nhan(loiLog)).toEqual([expect.objectContaining({ cho: "b", err: "lỗi 2", requestId: "r2" })]);
    expect(soGhiTreoStop()).toBe(0);
  });

  it("thunk ném ĐỒNG BỘ ⇒ đếm về 0 ngay, khiLoi(e, false), không reject", async () => {
    const khiLoi = vi.fn();
    await expect(
      ghiCoTran(
        () => {
          throw new Error("ném đồng bộ");
        },
        { nhan: "y", requestId: "r3", khiLoi },
      ),
    ).resolves.toBeUndefined();
    expect(soGhiTreoStop()).toBe(0);
    expect(khiLoi).toHaveBeenCalledTimes(1);
  });

  it("callback của người gọi ném ⇒ bị nuốt; đếm vẫn về 0; không reject, 0 unhandledRejection", async () => {
    const v = hoan();
    const p = ghiCoTran(() => v.p, {
      nhan: "z",
      requestId: "r",
      khiLoi: () => {
        throw new Error("callback hỏng");
      },
    });
    v.tuChoi(new Error("db"));
    await expect(p).resolves.toBeUndefined();
    await nhuong();
    expect(soGhiTreoStop()).toBe(0);
    expect(khongXuLy).toEqual([]);
  });

  it("review M-2: logger NÉM (mọi mức) ⇒ ghiCoTran không ném (phát / xếp hàng / bỏ / quá hạn), không unhandledRejection, đếm về 0", async () => {
    for (const s of [loiLog, canhLog, infoLog])
      s.mockImplementation(() => {
        throw new Error("logger hỏng");
      });
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) expect(() => void ghiCoTran(async () => undefined, { nhan: "q", requestId: "q" })).not.toThrow();
    await expect(ghiCoTran(async () => undefined, { nhan: "tran", requestId: "t" })).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS + 1);
    for (const h of ds) h.giai();
    await nhuong(20);
    expect(khongXuLy).toEqual([]);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0 });
  });

  it("★ 100 lượt lỗi DB GIỮA CHỪNG (lô 4 song song, các lô chồng nhau, mỗi lượt reject sau 1–900 ms) ⇒ MỌI lượt được phát (xếp hàng khi đầy), đếm về ĐÚNG 0", async () => {
    let phat = 0;
    let loi = 0;
    for (let lo = 0; lo < 100 / 4; lo++) {
      for (let k = 0; k < 4; k++) {
        const i = lo * 4 + k;
        const tre = 1 + ((i * 37) % 900);
        void ghiCoTran(
          () => {
            phat++;
            return new Promise((_, b) => setTimeout(() => b(new Error(`db ${i}`)), tre));
          },
          { nhan: "attempts_hmi_stop", requestId: `l${i}`, khiLoi: () => void loi++ },
        );
      }
      expect(soGhiTreoStop()).toBeLessThanOrEqual(TRAN_GHI_TREO_STOP);
      await vi.advanceTimersByTimeAsync(450);
    }
    await vi.advanceTimersByTimeAsync(20_000);
    await nhuong();
    expect(phat).toBe(100);
    expect(loi).toBe(100);
    expect(demGhiBoQuaDay().tong).toBe(0);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0 });
    expect(khongXuLy).toEqual([]);
  });

  it("★ 100 lượt lỗi DB phát CÙNG LÚC ⇒ 8 phát + 92 xếp hàng; MỌI lượt cuối cùng được phát, đếm + hàng chờ về ĐÚNG 0", async () => {
    const viec = Array.from({ length: 100 }, (_, i) => vi.fn(() => new Promise((_, b) => setTimeout(() => b(new Error(`db ${i}`)), 50 + i * 7))));
    for (let i = 0; i < 100; i++) void ghiCoTran(viec[i], { nhan: "audit_hmi_stop", requestId: `c${i}`, noiDung: { bang: "control_audit_log" } });
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    expect(viec.filter((f) => f.mock.calls.length > 0)).toHaveLength(TRAN_GHI_TREO_STOP);
    expect(trangThaiGhiTreo().hangCho).toBe(100 - TRAN_GHI_TREO_STOP);
    await vi.advanceTimersByTimeAsync(20_000);
    await nhuong();
    expect(viec.filter((f) => f.mock.calls.length === 1)).toHaveLength(100);
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, dayTu: null });
    expect(demGhiBoQuaDay().tong).toBe(0);
    expect(khongXuLy).toEqual([]);
  });

  it("★ trộn nhanh-ok / chậm-bỏ-rơi / bị từ chối / ném đồng bộ ⇒ ≤ 8 suốt quá trình, về 0 khi mọi lượt xong", async () => {
    const cham: Array<ReturnType<typeof hoan>> = [];
    let maxDem = 0;
    for (let i = 0; i < 40; i++) {
      const loai = i % 4;
      void ghiCoTran(
        () => {
          if (loai === 0) return new Promise<void>((r) => setTimeout(r, 3));
          if (loai === 1) {
            const h = hoan();
            cham.push(h);
            return h.p;
          }
          if (loai === 2) return new Promise((_, b) => setTimeout(() => b(new Error("từ chối")), 20));
          throw new Error("ném đồng bộ");
        },
        { nhan: `tron${loai}`, requestId: `m${i}` },
      );
      maxDem = Math.max(maxDem, soGhiTreoStop());
      await vi.advanceTimersByTimeAsync(25);
      maxDem = Math.max(maxDem, soGhiTreoStop());
    }
    expect(maxDem).toBeLessThanOrEqual(TRAN_GHI_TREO_STOP);
    // giải lần lượt mọi lượt chậm (kể cả lượt được phát từ hàng chờ sau khi chỗ trống)
    for (let k = 0; k < 20; k++) {
      cham.splice(0).forEach((h, j) => (j % 2 === 0 ? h.giai() : h.tuChoi(new Error("muộn"))));
      await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS + 10);
      await nhuong(5);
    }
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0 });
    expect(khongXuLy).toEqual([]);
  });

  it("review M-1: đặt lại khi còn lượt treo ⇒ lượt cũ xong KHÔNG làm bộ đếm âm", async () => {
    const v = hoan();
    void ghiCoTran(() => v.p, { nhan: "cu", requestId: "c" });
    _datLaiGhiTreoChoTest();
    v.giai();
    await nhuong();
    expect(soGhiTreoStop()).toBe(0);
    for (let i = 0; i < TRAN_GHI_TREO_STOP; i++) void ghiCoTran(treoMai, { nhan: "moi", requestId: "m" });
    const viec9 = vi.fn(treoMai);
    await ghiCoTran(viec9, { nhan: "chin", requestId: "9" });
    expect(viec9).not.toHaveBeenCalled(); // trần vẫn là 8, không phải 9
  });
});

describe("★ tắt tiến trình — xả ≤ 2 s; còn lại ⇒ một dòng log + bỏ (tat_may) + tóm tắt", () => {
  it("hàng chờ xả được trong hạn ⇒ mọi lượt ghi, 0 bỏ", async () => {
    const ds = dayTran();
    const ghi = vi.fn(async () => undefined);
    for (let i = 0; i < 20; i++) void ghiCoTran(ghi, { nhan: "q", requestId: `q${i}` });
    const p = xaHangChoKhiTat();
    for (const h of ds) h.giai();
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(ghi).toHaveBeenCalledTimes(20);
    expect(demGhiBoQuaDay().tong).toBe(0);
  });

  it("DB treo ⇒ sau ĐÚNG 2 s: một dòng log, mọi lượt còn lại bỏ (tat_may, khiBoQua), MỘT tóm tắt được thử ghi", async () => {
    dayTran();
    const boQua = vi.fn();
    for (let i = 0; i < 30; i++) void ghiCoTran(async () => undefined, { nhan: "q", requestId: `q${i}`, khiBoQua: boQua });
    const t0 = Date.now();
    let xong = -1;
    void xaHangChoKhiTat().then(() => (xong = Date.now() - t0));
    await vi.advanceTimersByTimeAsync(1_990);
    expect(xong).toBe(-1);
    await vi.advanceTimersByTimeAsync(50);
    await nhuong(5);
    expect(xong).toBeGreaterThanOrEqual(2_000);
    expect(xong).toBeLessThan(2_100);
    expect(nhan(loiLog).filter((o) => o.cho === "ot_stop_ghi_nen_tat_may_con_lai")).toHaveLength(1);
    expect(boQua).toHaveBeenCalledTimes(30);
    expect(tomTat).toHaveLength(1);
    expect(tomTat[0]).toMatchObject({ soLuong: 30, theoLyDo: { tat_may: 30 } });
  });
});
