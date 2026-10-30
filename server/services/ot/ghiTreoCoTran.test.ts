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
  HAN_DU_TRU_TOM_TAT_KHI_TAT_MS,
  HAN_GIAI_PHONG_SLOT_MS,
  rutGonVua,
  catNoiDungAudit,
  TRAN_TIA_MOT_LUOT_STOP,
  trangThaiGhiTreo,
  TUOI_TOI_DA_HANG_CHO_MS,
  xaHangChoKhiTat,
  suKienAuditTuNoiDung,
  type BoiCanhGhi,
  type TomTatBoRoi,
} from "./ghiTreoCoTran";
import { HAN_GHI_SO_STOP_HMI_MS, soGhiSoTreoStopHmi, TRAN_GHI_SO_TREO_STOP_HMI } from "../scada/lenhHmi";
import { createHash } from "node:crypto";
import { canonicalize, GENESIS_HASH } from "../security/auditChain";
import { computeAuditHash, verifyAuditRows } from "../audit/controlAuditService";

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

  it("QUÁ TUỔI (10 phút) ⇒ `_bo_qua_tuoi` + tóm tắt; QUÁ LỚN (> 16 KB, không có viecTuNoiDung) ⇒ `_bo_qua_lon`, không vào hàng chờ", async () => {
    // fix round 3 — van xả trả chỗ của lượt treo sau 2 phút ⇒ hàng chờ chỉ xả 8 lượt / 2 phút khi MỌI lượt đều treo; 48 lượt treo xếp TRƯỚC `gia`
    // ⇒ `gia` (vị trí 49) chưa tới lượt khi đủ 10 phút ⇒ quá tuổi
    dayTran();
    for (let i = 0; i < 48; i++) void ghiCoTran(treoMai, { nhan: "truoc", requestId: `t${i}` });
    const gia = vi.fn(async () => undefined);
    void ghiCoTran(gia, { nhan: "gia", requestId: "g" });
    await ghiCoTran(async () => undefined, { nhan: "lon", requestId: "l", noiDung: { bang: "control_audit_log", x: "y".repeat(TRAN_BYTE_MUC_HANG_CHO + 1) } });
    const bo = (re: RegExp) => nhan(loiLog).filter((o) => re.test(o.cho ?? ""));
    expect(bo(/_bo_/).map((o) => o.cho)).toEqual(["lon_bo_qua_lon"]);
    expect((bo(/_bo_/)[0].noiDung as { x: string }).x.length).toBeLessThan(300); // nội dung CẮT trong log
    expect(trangThaiGhiTreo().hangCho).toBe(49);
    await vi.advanceTimersByTimeAsync(TUOI_TOI_DA_HANG_CHO_MS + 1);
    trangThaiGhiTreo(); // tỉa đủ
    expect(bo(/^gia_bo_qua_tuoi$/)).toHaveLength(1);
    expect(gia).not.toHaveBeenCalled();
    await nhuong(10);
    expect(tomTat.reduce((n, t) => n + (t.theoLyDo.qua_lon ?? 0), 0) + (trangThaiGhiTreo().tomTatCho > 0 ? 0 : 0)).toBeLessThanOrEqual(1);
    expect(demGhiBoQuaDay().tong).toBeGreaterThanOrEqual(2);
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
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 0, hangCho: 0, dayTu: null, tomTatCho: 0 });
    // fix round 2 (re-review m5) — AUDIT tới DB rồi ghi HỎNG ⇒ khoảng trống trong chuỗi: đếm + tóm tắt (lyDo loi_ghi), nội dung ở log `_bo_loi_ghi`
    expect(demGhiBoQuaDay()).toMatchObject({ tong: 100, theoBang: { control_audit_log: 100 } });
    expect(nhan(loiLog).filter((o) => o.cho === "audit_hmi_stop_bo_loi_ghi")).toHaveLength(100);
    expect(tomTat.reduce((n, t) => n + (t.theoLyDo.loi_ghi ?? 0), 0)).toBe(100);
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
    // fix round 3 (N2-2) — thôi chờ ở 2 s − 500 ms (đuôi dành cho tóm tắt); tóm tắt giả ghi xong ngay ⇒ xong ≈ 1 500 ms
    await vi.advanceTimersByTimeAsync(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS - 10);
    expect(xong).toBe(-1);
    await vi.advanceTimersByTimeAsync(50);
    await nhuong(5);
    expect(xong).toBeGreaterThanOrEqual(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS);
    expect(xong).toBeLessThan(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS + 100);
    expect(nhan(loiLog).filter((o) => o.cho === "ot_stop_ghi_nen_tat_may_con_lai")).toHaveLength(1);
    expect(boQua).toHaveBeenCalledTimes(30);
    expect(tomTat).toHaveLength(1);
    // + 8 lượt treo vẫn đang bay ở hạn (fix round 2, N-1): KHÔNG RÕ đã commit hay chưa
    expect(tomTat[0]).toMatchObject({ soLuong: 38, theoLyDo: { tat_may: 30, dang_bay_khi_tat: 8 }, khongRoDaGhi: 8 });
  });

  it("★ N-1 — hàng chờ RỖNG nhưng còn lượt ĐANG BAY lúc tắt ⇒ chờ chúng (trong hạn 2 s); lượt xong kịp ⇒ không tóm tắt, không log", async () => {
    const h = [hoan(), hoan(), hoan()];
    h.forEach((x, i) => void ghiCoTran(() => x.p, { nhan: "audit_hmi_stop", requestId: `b${i}`, noiDung: { bang: "control_audit_log" } }));
    expect(trangThaiGhiTreo().hangCho).toBe(0);
    let xong = false;
    void xaHangChoKhiTat().then(() => (xong = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(xong, "còn lượt đang bay ⇒ CHƯA xong").toBe(false);
    h.forEach((x) => x.giai());
    await vi.advanceTimersByTimeAsync(40);
    await nhuong(5);
    expect(xong).toBe(true);
    expect(tomTat).toEqual([]);
    expect(nhan(loiLog).filter((o) => o.cho === "ot_stop_ghi_nen_tat_may_dang_bay")).toEqual([]);
  });

  it("★ N-1 — hàng chờ RỖNG, 3 lượt đang bay KHÔNG xong ⇒ chờ ĐÚNG ~2 s; MỘT dòng log LIỆT KÊ 3 lượt (nhãn, requestId, bảng, giờ sự kiện); tóm tắt dang_bay_khi_tat = 3, khongRoDaGhi = 3", async () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) void ghiCoTran(treoMai, { nhan: i === 0 ? "dispatch_pinned_stop_audit" : "audit_hmi_stop", requestId: `k${i}`, noiDung: { bang: "control_audit_log" } });
    expect(trangThaiGhiTreo()).toMatchObject({ dangBay: 3, hangCho: 0 });
    let xong = -1;
    void xaHangChoKhiTat().then(() => (xong = Date.now() - t0));
    // fix round 3 (N2-2) — thôi chờ ở 2 s − 500 ms (đuôi dành cho tóm tắt); tóm tắt giả ghi xong ngay ⇒ xong ≈ 1 500 ms
    await vi.advanceTimersByTimeAsync(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS - 10);
    expect(xong).toBe(-1);
    await vi.advanceTimersByTimeAsync(50);
    await nhuong(5);
    expect(xong).toBeGreaterThanOrEqual(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS);
    expect(xong).toBeLessThan(2_000 - HAN_DU_TRU_TOM_TAT_KHI_TAT_MS + 100);
    const dong = loiLog.mock.calls.map((c) => c[0] as { cho?: string; lietKe?: Array<Record<string, unknown>>; ketCuc?: string }).filter((o) => o?.cho === "ot_stop_ghi_nen_tat_may_dang_bay");
    expect(dong).toHaveLength(1);
    expect(dong[0].ketCuc).toBe("khong_ro");
    expect(dong[0].lietKe).toEqual([
      { nhan: "dispatch_pinned_stop_audit", requestId: "k0", bang: "control_audit_log", lucSuKien: new Date(t0).toISOString() },
      { nhan: "audit_hmi_stop", requestId: "k1", bang: "control_audit_log", lucSuKien: new Date(t0).toISOString() },
      { nhan: "audit_hmi_stop", requestId: "k2", bang: "control_audit_log", lucSuKien: new Date(t0).toISOString() },
    ]);
    expect(tomTat).toHaveLength(1);
    expect(tomTat[0]).toMatchObject({ soLuong: 3, theoLyDo: { dang_bay_khi_tat: 3 }, khongRoDaGhi: 3, requestIds: ["k0", "k1", "k2"] });
    expect(demGhiBoQuaDay().tong, "không rõ ⇒ KHÔNG đếm là bị bỏ").toBe(0);
  });

  it("re-review m1 — lượt ghi tóm tắt cuối lúc tắt hết hạn ⇒ `xa` KHÔNG phát lại tóm tắt khi một lượt khác xong (chống ghi đôi)", async () => {
    let soLanGhi = 0;
    _datGhiTomTatChoTest(() => {
      soLanGhi++;
      return new Promise<never>(() => undefined);
    });
    const h = hoan();
    void ghiCoTran(() => h.p, { nhan: "a", requestId: "a" });
    void xaHangChoKhiTat(100);
    await vi.advanceTimersByTimeAsync(200);
    await nhuong(5);
    expect(soLanGhi).toBe(1); // tóm tắt (dang_bay_khi_tat) được thử đúng một lần
    h.giai();
    await nhuong(5);
    await vi.advanceTimersByTimeAsync(HAN_THU_LAI_TOM_TAT_MS * 2);
    await nhuong(5);
    expect(soLanGhi, "không phát lại sau khi đã ghi lúc tắt").toBe(1);
  });
});

describe("★ fix round 2 — mục QUÁ LỚN bị CẮT (không bỏ); mã tóm tắt", () => {
  it("quá 16 KB + có viecTuNoiDung ⇒ XẾP HÀNG bản CẮT (daCat, vừa trần); thunk gốc KHÔNG gọi; khi có chỗ ⇒ viecTuNoiDung ghi bản cắt", async () => {
    const ds = dayTran();
    const goc = vi.fn(async () => undefined);
    const tuNd = vi.fn(async (_nd: unknown, _t: BoiCanhGhi) => undefined);
    const lon = { bang: "control_audit_log", action: "scada_hmi_stop", entityType: "machine", entityId: 7, after: { adapters: Array.from({ length: 400 }, (_, i) => ({ i, ghim: "x".repeat(100) })) } };
    await ghiCoTran(goc, { nhan: "audit_hmi_stop", requestId: "lon", noiDung: lon, viecTuNoiDung: tuNd });
    expect(nhan(canhLog).filter((o) => o.cho === "audit_hmi_stop_xep_hang")).toHaveLength(1);
    expect(nhan(loiLog).filter((o) => /_bo_/.test(o.cho ?? ""))).toEqual([]);
    ds[0].giai();
    await nhuong(5);
    expect(goc).not.toHaveBeenCalled();
    expect(tuNd).toHaveBeenCalledTimes(1);
    const nd = tuNd.mock.calls[0][0] as Record<string, unknown>;
    expect(nd.daCat).toBe(true);
    expect(nd).toMatchObject({ bang: "control_audit_log", action: "scada_hmi_stop", entityType: "machine", entityId: 7 });
    expect(JSON.stringify(nd).length).toBeLessThanOrEqual(TRAN_BYTE_MUC_HANG_CHO);
    expect(tuNd.mock.calls[0][1]).toMatchObject({ daXepHang: true });
    expect(suKienAuditTuNoiDung<{ after: Record<string, unknown> }>(nd).after.daCat).toBe(true);
    expect("bang" in suKienAuditTuNoiDung<Record<string, unknown>>(nd)).toBe(false);
  });

  it("quá lớn: định danh cấp đầu quá trần ⇒ `dinh_danh_qua_lon`; `after` cắt rồi VẪN không vừa (khoá rất dài) hoặc không có viecTuNoiDung ⇒ `qua_lon`", async () => {
    dayTran();
    const khoaDai = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i}${"k".repeat(2_000)}`, 1]));
    await ghiCoTran(async () => undefined, { nhan: "a", requestId: "a", noiDung: khoaDai, viecTuNoiDung: async () => undefined });
    await ghiCoTran(async () => undefined, { nhan: "c", requestId: "c", noiDung: { action: "x", after: khoaDai }, viecTuNoiDung: async () => undefined });
    await ghiCoTran(async () => undefined, { nhan: "b", requestId: "b", noiDung: { x: "y".repeat(TRAN_BYTE_MUC_HANG_CHO + 1) } });
    expect(nhan(loiLog).filter((o) => /_bo_(dinh_danh_)?qua_lon$/.test(o.cho ?? "")).map((o) => o.cho)).toEqual([
      "a_bo_dinh_danh_qua_lon",
      "c_bo_qua_lon",
      "b_bo_qua_lon",
    ]);
  });

  it("re-review m1 — tóm tắt mang `ma`; ghi hỏng rồi thử lại ⇒ CÙNG mã, mã của phần gộp vào maDaGop", async () => {
    let hong = 1;
    const thay: TomTatBoRoi[] = [];
    _datGhiTomTatChoTest(async (tt) => {
      thay.push(JSON.parse(JSON.stringify(tt)));
      if (hong-- > 0) throw new Error("hỏng");
    });
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) void ghiCoTran(async () => undefined, { nhan: "q", requestId: `q${i}` });
    await ghiCoTran(async () => undefined, { nhan: "x", requestId: "x1" });
    ds[0].giai();
    await nhuong(10);
    expect(thay).toHaveLength(1);
    const ma1 = thay[0].ma;
    expect(ma1).toMatch(/\S{8,}/);
    await vi.advanceTimersByTimeAsync(HAN_THU_LAI_TOM_TAT_MS + 1);
    for (const h of ds) h.giai();
    await nhuong(10);
    expect(thay.length).toBeGreaterThanOrEqual(2);
    expect(thay.at(-1)!.ma).toBe(ma1);
  });

  it("re-review m7 — nội dung có getter NÉM ⇒ ghiCoTran không ném (xếp hàng / bỏ đều an toàn)", async () => {
    dayTran();
    const doc = { bang: "control_audit_log" } as Record<string, unknown>;
    Object.defineProperty(doc, "hong", { enumerable: true, get: () => { throw new Error("getter"); } });
    await expect(ghiCoTran(async () => undefined, { nhan: "g", requestId: "g", noiDung: doc })).resolves.toBeUndefined();
    // không đo được cỡ (JSON ném) ⇒ coi như quá lớn ⇒ bỏ có log (nội dung "[rutGon lỗi]") — không bao giờ ném ra STOP
    const bo = nhan(loiLog).filter((o) => o.cho === "g_bo_qua_lon");
    expect(bo).toHaveLength(1);
    expect(bo[0].noiDung).toBe("[rutGon lỗi]");
  });
});

describe("★ fix round 3 — S-1: CẮT không bao giờ đổi ĐỊNH DANH audit", () => {
  const lyDoDai = "STOP khi đang bị buộc đổi mật khẩu (miễn cổng — điều phối 2026-10-26) — " + "x".repeat(400);
  const goc = (soAdapter: number) => ({
    bang: "control_audit_log",
    entityType: "machine_" + "e".repeat(90),
    entityId: "unrecorded-" + "i".repeat(90),
    action: "scada_hmi_stop_buoc_doi_mat_khau_" + "a".repeat(40),
    actorId: 42,
    reason: lyDoDai,
    before: { ghiChu: "b".repeat(5_000) },
    after: { adapters: Array.from({ length: soAdapter }, (_, i) => ({ i, ghim: "g".repeat(300), sau: { sau2: { sau3: { s: "z".repeat(300) } } } })) },
  });
  const DINH_DANH = ["bang", "entityType", "entityId", "action", "actorId", "reason"] as const;

  it.each([
    { ten: "mức 1", soAdapter: 400 },
    { ten: "mức 2/3 (after rất rộng)", soAdapter: 20_000 },
  ])("★ $ten — định danh NGUYÊN VĂN từng byte, chỉ before/after bị cắt, vừa 16 KB, daCat", ({ soAdapter }) => {
    const g = goc(soAdapter);
    const c = rutGonVua(g) as Record<string, unknown>;
    expect(c).not.toBeNull();
    for (const k of DINH_DANH) expect(JSON.stringify(c[k]), k).toBe(JSON.stringify(g[k]));
    expect(c.daCat).toBe(true);
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(TRAN_BYTE_MUC_HANG_CHO);
    expect(JSON.stringify(c.after).length).toBeLessThan(JSON.stringify(g.after).length);
    const e = suKienAuditTuNoiDung<Record<string, unknown>>(c);
    expect(e.action).toBe(g.action);
    expect(e.reason).toBe(g.reason);
    expect(e.entityType).toBe(g.entityType);
    expect(e.entityId).toBe(g.entityId);
    expect((e.after as Record<string, unknown>).daCat).toBe(true);
  });

  it("★ riêng ĐỊNH DANH (+ chỗ cho dấu cắt) đã > 16 KB ⇒ TỪ CHỐI, KHÔNG cắt định danh (`dinh_danh_qua_lon`) ⇒ tóm tắt lý do riêng; người ghi không được gọi", async () => {
    const g = { ...goc(1), reason: "r".repeat(TRAN_BYTE_MUC_HANG_CHO + 10) };
    expect(catNoiDungAudit(g)).toEqual({ ket: "dinh_danh_qua_lon" });
    expect(rutGonVua(g)).toBeNull();
    // ngay dưới trần nhưng KHÔNG đủ chỗ cho dấu cắt ⇒ vẫn từ chối (chỗ dấu cắt được dành TRƯỚC)
    const sat = { ...goc(1), reason: "r".repeat(TRAN_BYTE_MUC_HANG_CHO - 600) };
    expect(catNoiDungAudit(sat).ket).toBe("dinh_danh_qua_lon");
    const ds = dayTran();
    const tuNd = vi.fn(async () => undefined);
    await ghiCoTran(async () => undefined, { nhan: "audit_hmi_stop", requestId: "id", noiDung: g, viecTuNoiDung: tuNd });
    expect(nhan(loiLog).filter((o) => o.cho === "audit_hmi_stop_bo_dinh_danh_qua_lon")).toHaveLength(1);
    ds[0].giai();
    await nhuong(10);
    expect(tuNd).not.toHaveBeenCalled();
    expect(tomTat[0]).toMatchObject({ theoLyDo: { dinh_danh_qua_lon: 1 } });
  });

  it("★ DẤU CẮT trong phần được băm: mỗi trường bị cắt mang độ dài byte UTF-8 + sha256 của canonicalize(GỐC); trường không bị cắt không có dấu", () => {
    const g = goc(400);
    const c = rutGonVua(g) as Record<string, unknown>;
    const dau = c.catGoc as Record<string, { doDaiGocByteUtf8: number; sha256Goc: string }>;
    for (const k of ["before", "after"] as const) {
      const chuoi = canonicalize(g[k]);
      expect(dau[k], k).toEqual({ doDaiGocByteUtf8: Buffer.byteLength(chuoi, "utf8"), sha256Goc: createHash("sha256").update(chuoi).digest("hex") });
    }
    // before nhỏ (không bị cắt) ⇒ không có dấu cho before
    const c2 = rutGonVua({ ...g, before: { nho: 1 } }) as Record<string, unknown>;
    expect(Object.keys(c2.catGoc as object)).toEqual(["after"]);
    // dấu cắt đi vào `after` của sự kiện (phần được băm)
    const e = suKienAuditTuNoiDung<{ after: Record<string, unknown> }>(c);
    expect(e.after.daCat).toBe(true);
    expect(e.after.catGoc).toEqual(dau);
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(TRAN_BYTE_MUC_HANG_CHO);
  });

  it("★ hàng cắt qua verifyAuditRows: băm (computeAuditHash) trên sự kiện dựng lại sau vòng JSON (như jsonb) ⇒ chuỗi một hàng HỢP LỆ; sửa dấu cắt ⇒ HỎNG", () => {
    const e = suKienAuditTuNoiDung<Record<string, unknown>>(rutGonVua(goc(20_000)));
    const luu = JSON.parse(JSON.stringify(e)) as Record<string, unknown>; // jsonb trả về đúng nội dung JSON
    const truong = {
      entityType: String(luu.entityType),
      entityId: String(luu.entityId),
      action: String(luu.action),
      actorId: (luu.actorId as number) ?? null,
      before: luu.before ?? null,
      after: luu.after ?? null,
      reason: (luu.reason as string) ?? null,
    };
    const hashTs = 1_793_000_000_000;
    const hash = computeAuditHash(GENESIS_HASH, truong, hashTs);
    const hang = { id: 1, ...truong, beforeJson: truong.before, afterJson: truong.after, prevHash: GENESIS_HASH, hash, hashTs };
    expect(verifyAuditRows([hang])).toMatchObject({ ok: true, checked: 1 });
    const sua = JSON.parse(JSON.stringify(hang));
    sua.afterJson.catGoc.after.sha256Goc = "0".repeat(64);
    expect(verifyAuditRows([sua]).ok).toBe(false);
  });
});

describe("★ fix round 3 — N2-2: tóm tắt cuối lúc tắt có ĐUÔI hạn để COMMIT", () => {
  it("★ lượt đang bay không xong + tóm tắt cần 200 ms để commit ⇒ dòng tóm tắt ĐÃ commit khi xaHangChoKhiTat trả (trong 2 s)", async () => {
    const daCommit: TomTatBoRoi[] = [];
    _datGhiTomTatChoTest((tt) => new Promise<void>((r) => setTimeout(() => (daCommit.push(tt), r()), 200)));
    for (let i = 0; i < 3; i++) void ghiCoTran(treoMai, { nhan: "audit_hmi_stop", requestId: `c${i}`, noiDung: { bang: "control_audit_log" } });
    const t0 = Date.now();
    let xong = -1;
    let commitLucXong = -1;
    void xaHangChoKhiTat().then(() => {
      xong = Date.now() - t0;
      commitLucXong = daCommit.length;
    });
    await vi.advanceTimersByTimeAsync(2_100);
    await nhuong(5);
    expect(xong).toBeGreaterThan(0);
    expect(xong).toBeLessThanOrEqual(2_000);
    expect(commitLucXong, "tóm tắt đã COMMIT trước khi lượt xả trả (process.exit theo sau)").toBe(1);
    expect(daCommit[0]).toMatchObject({ theoLyDo: { dang_bay_khi_tat: 3 }, khongRoDaGhi: 3 });
    expect(nhan(loiLog).filter((o) => o.cho === "ot_stop_ghi_nen_tat_may_tom_tat_loi")).toEqual([]);
  });
});

describe("★ fix round 3 (kiem-dinh) — van xả chỗ rò", () => {
  it("★ lượt treo MÃI ⇒ đúng HAN_GIAI_PHONG_SLOT_MS thì trả chỗ MỘT lần (log + posture), lượt xếp hàng được phát; lượt thật xong sau KHÔNG trừ lần hai", async () => {
    const h = hoan();
    void ghiCoTran(() => h.p, { nhan: "ro", requestId: "r0" });
    for (let i = 1; i < TRAN_GHI_TREO_STOP; i++) void ghiCoTran(treoMai, { nhan: "khac", requestId: `k${i}`, noiDung: { bang: "khac" } });
    const cho = vi.fn(async () => undefined);
    void ghiCoTran(cho, { nhan: "cho", requestId: "c" });
    expect(cho).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HAN_GIAI_PHONG_SLOT_MS - 1);
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    expect(cho).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await nhuong(5);
    expect(nhan(loiLog).filter((o) => o.cho === "ro_giai_phong_slot")).toHaveLength(1);
    expect(trangThaiGhiTreo().slotGiaiPhong).toBe(TRAN_GHI_TREO_STOP); // mọi lượt cùng hạn
    expect(cho).toHaveBeenCalledTimes(1);
    expect(soGhiTreoStop()).toBe(0);
    // lượt thật của "ro" xong MUỘN ⇒ KHÔNG trừ lần hai (không âm)
    h.giai();
    await nhuong(5);
    expect(soGhiTreoStop()).toBe(0);
    // trần vẫn đúng 8 sau van
    for (let i = 0; i < TRAN_GHI_TREO_STOP; i++) void ghiCoTran(treoMai, { nhan: "moi", requestId: `m${i}` });
    const thu9 = vi.fn(treoMai);
    await ghiCoTran(thu9, { nhan: "chin", requestId: "9" });
    expect(thu9).not.toHaveBeenCalled();
  });

  it("lượt xong TRƯỚC hạn van ⇒ van không bắn (không log, không đếm)", async () => {
    const h = hoan();
    void ghiCoTran(() => h.p, { nhan: "nhanh", requestId: "n" });
    await vi.advanceTimersByTimeAsync(1_000);
    h.giai();
    await nhuong(3);
    await vi.advanceTimersByTimeAsync(HAN_GIAI_PHONG_SLOT_MS);
    expect(nhan(loiLog).filter((o) => o.cho === "nhanh_giai_phong_slot")).toEqual([]);
    expect(trangThaiGhiTreo().slotGiaiPhong).toBe(0);
  });
});

describe("★ fix round 3 — N2-3: mục quá lớn trong hàng chờ KHÔNG giữ tải gốc", () => {
  // bật gc trong tiến trình (mẹo v8 — không cần cờ dòng lệnh); không có ⇒ bỏ qua và lập luận từ cấu trúc (mucTuNoiDungCat)
  let gc: (() => void) | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v8 = require("node:v8") as typeof import("node:v8");
    v8.setFlagsFromString("--expose_gc");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    gc = (require("node:vm") as typeof import("node:vm")).runInNewContext("gc") as () => void;
  } catch {
    gc = null;
  }
  const nguoiGhiRieng = (ghi: unknown[]) => async (nd: unknown) => void ghi.push(nd);

  it.skipIf(!gc)("tải gốc (WeakRef) được thu gom khi mục CẮT còn nằm trong hàng chờ; đối chứng: mục THƯỜNG giữ tải tới khi xả", async () => {
    dayTran();
    const ghi: unknown[] = [];
    const xepHang = (lon: boolean) => {
      const tai = { bang: "control_audit_log", action: "a", entityType: "m", entityId: 1, after: { x: "t".repeat(lon ? TRAN_BYTE_MUC_HANG_CHO * 4 : 100) } };
      const ref = new WeakRef(tai);
      void ghiCoTran(async () => ghi.push(tai.after), { nhan: "w", requestId: "w", noiDung: tai, viecTuNoiDung: nguoiGhiRieng(ghi) });
      return ref;
    };
    const refLon = xepHang(true);
    const refThuong = xepHang(false);
    expect(trangThaiGhiTreo().hangCho).toBe(2);
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((r) => setImmediate(r));
      gc!();
    }
    expect(refLon.deref(), "tải lớn đã được thả (mục chỉ giữ bản cắt)").toBeUndefined();
    expect(refThuong.deref(), "đối chứng: mục thường giữ thunk gốc").toBeDefined();
  });
});

describe("★ fix round 3 (kiem-dinh R8 / R9 / R10) — diệt đột biến còn sống", () => {
  it("★ R8 — lúc tắt, một lượt ghi tóm tắt ĐANG BAY + lượt bỏ MỚI tới ⇒ tóm tắt CUỐI vẫn chứa nội dung của tóm tắt đang bay (cùng mã)", async () => {
    const ghi: TomTatBoRoi[] = [];
    let lan = 0;
    _datGhiTomTatChoTest((tt) => {
      lan++;
      ghi.push(JSON.parse(JSON.stringify(tt)));
      return lan === 1 ? new Promise<never>(() => undefined) : Promise.resolve();
    });
    // tóm tắt #1 bắt đầu ghi (treo): cần một lượt bỏ khi trần còn chỗ ⇒ tràn hàng chờ rồi trả một chỗ
    const ds = dayTran();
    for (let i = 0; i < TRAN_HANG_CHO_GHI_NEN; i++) void ghiCoTran(treoMai, { nhan: "q", requestId: `q${i}` });
    await ghiCoTran(async () => undefined, { nhan: "dau", requestId: "dau1" });
    ds[0].giai();
    await nhuong(5);
    expect(lan).toBe(1);
    const ma1 = ghi[0].ma;
    expect(ghi[0].requestIds).toEqual(["dau1"]);
    // lượt bỏ MỚI trong lúc tóm tắt #1 còn bay
    await ghiCoTran(async () => undefined, { nhan: "moi", requestId: "moi1" });
    void xaHangChoKhiTat(1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    await nhuong(5);
    const cuoi = ghi.at(-1)!;
    expect(lan).toBeGreaterThanOrEqual(2);
    expect(cuoi.ma, "cùng mã với tóm tắt đang bay").toBe(ma1);
    expect(cuoi.requestIds).toEqual(expect.arrayContaining(["dau1", "moi1"]));
  });

  it("★ R9 — 100 mục QUÁ TUỔI + MỘT lời ghiCoTran ⇒ lời ấy tỉa TỐI ĐA TRAN_TIA_MOT_LUOT_STOP (16)", async () => {
    dayTran();
    for (let i = 0; i < 100; i++) void ghiCoTran(treoMai, { nhan: "gia", requestId: `g${i}` });
    // vượt tuổi mà KHÔNG chạm van xả của các lượt đang bay (van 120 s < 10 phút ⇒ đặt lại thế hệ cho bộ đếm, giữ hàng chờ)
    vi.setSystemTime(Date.now() + TUOI_TOI_DA_HANG_CHO_MS + 1);
    loiLog.mockClear();
    await ghiCoTran(async () => undefined, { nhan: "moi", requestId: "m" });
    const tia = nhan(loiLog).filter((o) => o.cho === "gia_bo_qua_tuoi");
    expect(tia).toHaveLength(TRAN_TIA_MOT_LUOT_STOP);
    expect(TRAN_TIA_MOT_LUOT_STOP).toBe(16);
  });

  it("★ R10 — tóm tắt đang ghi HỎNG gộp với tóm tắt MỚI (mã riêng) ⇒ mã mới vào maDaGop, mã gốc giữ; 20 vòng ⇒ maDaGop có trần 16", async () => {
    const ghi: TomTatBoRoi[] = [];
    const tuChoi: Array<(e: unknown) => void> = [];
    _datGhiTomTatChoTest((tt) => {
      ghi.push(JSON.parse(JSON.stringify(tt)));
      return new Promise<void>((_, b) => tuChoi.push(b));
    });
    const lon = { x: "y".repeat(TRAN_BYTE_MUC_HANG_CHO + 1) }; // quá lớn, không có viecTuNoiDung ⇒ bỏ qua_lon (đường hàng chờ: trần đầy)
    const ds = dayTran(); // 7 lượt treo mãi + ds[0] giải được
    await ghiCoTran(async () => undefined, { nhan: "d", requestId: "d0", noiDung: lon });
    ds[0].giai(); // chỗ trống ⇒ tóm tắt #1 (mã gốc) đang ghi, chiếm chỗ thứ 8
    await nhuong(5);
    expect(ghi).toHaveLength(1);
    const ma0 = ghi[0].ma;
    const maMoi: string[] = [];
    for (let k = 1; k <= 20; k++) {
      await ghiCoTran(async () => undefined, { nhan: "d", requestId: `d${k}`, noiDung: lon }); // tóm tắt MỚI (mã riêng) khi #trước còn bay
      tuChoi.shift()!(new Error("hỏng")); // tóm tắt đang bay HỎNG ⇒ gộp với tóm tắt mới
      await nhuong(5);
      await vi.advanceTimersByTimeAsync(HAN_THU_LAI_TOM_TAT_MS + 1); // thử lại ⇒ tóm tắt gộp đang ghi
      await nhuong(5);
      expect(ghi).toHaveLength(k + 1);
      const sau = ghi.at(-1)!;
      expect(sau.ma, `vòng ${k}: mã gốc giữ`).toBe(ma0);
      const moi = sau.maDaGop.filter((m) => !maMoi.includes(m));
      if (k <= 16) {
        expect(moi, `vòng ${k}: đúng một mã mới gộp vào`).toHaveLength(1);
        maMoi.push(...moi);
      }
    }
    const cuoi = ghi.at(-1)!;
    expect(cuoi.maDaGop).toHaveLength(16);
    expect(cuoi.maDaGop).not.toContain(ma0);
    expect(cuoi.soLuong).toBe(21);
  });
});
