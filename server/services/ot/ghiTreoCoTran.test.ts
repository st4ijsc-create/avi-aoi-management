/**
 * SCADA R1b-2b-2a Task 1 (mục 61) — `ghiCoTran`: MỘT bộ đếm ghi treo cho mọi lượt ghi nền của đường STOP.
 *
 * Ngữ nghĩa IN-FLIGHT (kiem-dinh KD-A1, điều phối 2026-10-27): +1 lúc PHÁT, −1 lúc XONG (kể cả lượt bỏ rơi), trần 8 áp từ lượt ĐẦU; hạn 500 ms
 * chỉ quyết định lúc trả lời người gọi đang `await`. −1 trên MỌI đường thoát (xong, lỗi, quá hạn rồi xong, ném đồng bộ) — điều phối: 100 lượt lỗi
 * DB giữa chừng ⇒ đếm về ĐÚNG 0; trộn nhanh-ok / chậm-bỏ-rơi / bị từ chối ⇒ về 0 khi mọi lượt xong.
 * Đồng hồ GIẢ (chỉ setTimeout / clearTimeout / Date; setImmediate thật để Node kịp phát unhandledRejection) — tất định, không cận đồng hồ tường.
 * Đột biến bắt buộc (ghi trong báo cáo task):
 *   · "chỉ đếm khi đã quá hạn" (ngữ nghĩa T9 cũ) ⇒ ca "8 lượt đang bay CHƯA quá hạn ⇒ lượt 9 không phát" ĐỎ;
 *   · kiểm trần SAU khi gọi `viec` ⇒ ca "lượt 9 không được phát" ĐỎ;
 *   · bỏ `giam()` ở nhánh ném đồng bộ / nhánh lỗi ⇒ ca "100 lượt lỗi ⇒ 0" ĐỎ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../logger";
import {
  _datLaiGhiTreoChoTest,
  demGhiBoQuaDay,
  ghiCoTran,
  HAN_GHI_TREO_MS,
  soGhiTreoStop,
  TRAN_GHI_TREO_STOP,
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
let infoLog: ReturnType<typeof vi.spyOn>;
const nhan = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => c[0] as { cho?: string; err?: string; requestId?: string; noiDung?: unknown }).filter((o) => typeof o?.cho === "string");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  _datLaiGhiTreoChoTest();
  khongXuLy = [];
  process.on("unhandledRejection", nghe);
  loiLog = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
  infoLog = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
});
afterEach(() => {
  process.off("unhandledRejection", nghe);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("R1b-2b-2a T1 — hằng + một bộ đếm", () => {
  it("HAN_GHI_TREO_MS = 500, TRAN_GHI_TREO_STOP = 8", () => {
    expect(HAN_GHI_TREO_MS).toBe(500);
    expect(TRAN_GHI_TREO_STOP).toBe(8);
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

describe("★ KD-A1 — đếm IN-FLIGHT, trần từ lượt đầu", () => {
  it("★ 8 lượt ĐANG BAY (chưa tới hạn 500 ms) ⇒ lượt 9 KHÔNG được phát, khiBoQua 1 lần, log `_bo_qua_day` có nội dung — ngay ở t = 0", async () => {
    for (let i = 0; i < TRAN_GHI_TREO_STOP; i++) void ghiCoTran(treoMai, { nhan: `so${i}`, requestId: "r" });
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    const viec9 = vi.fn(treoMai);
    const boQua = vi.fn();
    const noiDung = { bang: "control_audit_log", action: "scada_hmi_stop", after: { ketCuc: "DA_GUI" } };
    const t0 = Date.now();
    await ghiCoTran(viec9, { nhan: "audit_hmi_stop", requestId: "r9", noiDung, khiBoQua: boQua });
    expect(Date.now() - t0, "trả NGAY (không chờ hạn)").toBe(0);
    expect(viec9).not.toHaveBeenCalled();
    expect(boQua).toHaveBeenCalledTimes(1);
    const bq = nhan(loiLog).filter((o) => o.cho === "audit_hmi_stop_bo_qua_day");
    expect(bq).toHaveLength(1);
    expect(bq[0].noiDung).toEqual(noiDung);
    expect(bq[0].requestId).toBe("r9");
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    // KD-A3 — lượt bỏ qua ĐƯỢC ĐẾM (posture), theo bảng đích
    expect(demGhiBoQuaDay()).toMatchObject({ tong: 1, theoBang: { control_audit_log: 1 } });
  });

  it("trần dùng chung (brief): 8 lượt quá 500 ms còn treo ⇒ lượt 9 KHÔNG được phát, khiBoQua 1 lần", async () => {
    for (let i = 0; i < 8; i++) void ghiCoTran(treoMai, { nhan: `so${i}`, requestId: "r" });
    await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS + 1);
    expect(soGhiTreoStop()).toBe(8);
    const viec9 = vi.fn(treoMai);
    const boQua = vi.fn();
    await ghiCoTran(viec9, { nhan: "audit_hmi_stop", requestId: "r", noiDung: { bang: "control_audit_log", action: "scada_hmi_stop" }, khiBoQua: boQua });
    expect(viec9).not.toHaveBeenCalled();
    expect(boQua).toHaveBeenCalledTimes(1);
  });

  it("đếm +1 lúc PHÁT (trước hạn) và −1 lúc xong trong hạn — không log", async () => {
    const v = hoan();
    const p = ghiCoTran(() => v.p, { nhan: "x", requestId: "r1" });
    expect(soGhiTreoStop()).toBe(1);
    await vi.advanceTimersByTimeAsync(30);
    expect(soGhiTreoStop()).toBe(1);
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

  it("DB nhanh không bao giờ bị bỏ qua: 100 lượt xong trong 10 ms (tuần tự) ⇒ đếm 0, mọi viec được gọi, 0 bỏ qua", async () => {
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
    expect(demGhiBoQuaDay().tong).toBe(0);
  });
});

describe("★ điều phối — −1 trên MỌI đường thoát", () => {
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
    expect((khiLoi.mock.calls[0][0] as Error).message).toBe("ghi muộn hỏng");
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

  it("★ 100 lượt lỗi DB GIỮA CHỪNG (lô 8 song song, mỗi lượt reject sau 1–900 ms, nửa trước nửa sau hạn) ⇒ phát + bỏ qua = 100, đếm về ĐÚNG 0", async () => {
    let phat = 0;
    let loi = 0;
    for (let lo = 0; lo < 100 / 4; lo++) {
      // 4 lượt / lô < trần ⇒ không lượt nào bị bỏ qua; các lô chồng nhau (lô sau phát khi lô trước còn bay)
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
    await vi.advanceTimersByTimeAsync(1_000);
    await nhuong();
    expect(phat + demGhiBoQuaDay().tong).toBe(100);
    expect(loi).toBe(phat);
    expect(soGhiTreoStop()).toBe(0);
    expect(khongXuLy).toEqual([]);
  });

  it("★ 100 lượt lỗi DB phát CÙNG LÚC ⇒ 8 phát + 92 bỏ qua (đếm), mọi lượt phát lỗi ⇒ đếm về ĐÚNG 0", async () => {
    const viec = Array.from({ length: 100 }, (_, i) => vi.fn(() => new Promise((_, b) => setTimeout(() => b(new Error(`db ${i}`)), 50 + i * 7))));
    for (let i = 0; i < 100; i++) void ghiCoTran(viec[i], { nhan: "audit_hmi_stop", requestId: `c${i}`, noiDung: { bang: "control_audit_log" } });
    expect(soGhiTreoStop()).toBe(TRAN_GHI_TREO_STOP);
    expect(viec.filter((f) => f.mock.calls.length > 0)).toHaveLength(TRAN_GHI_TREO_STOP);
    expect(demGhiBoQuaDay()).toMatchObject({ tong: 100 - TRAN_GHI_TREO_STOP, theoBang: { control_audit_log: 100 - TRAN_GHI_TREO_STOP } });
    await vi.advanceTimersByTimeAsync(2_000);
    await nhuong();
    expect(soGhiTreoStop()).toBe(0);
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
    // lượt chậm còn bay = đúng số đếm
    expect(soGhiTreoStop()).toBe(cham.length);
    await vi.advanceTimersByTimeAsync(HAN_GHI_TREO_MS + 10);
    cham.forEach((h, k) => (k % 2 === 0 ? h.giai() : h.tuChoi(new Error("muộn"))));
    await nhuong(5);
    expect(soGhiTreoStop()).toBe(0);
    expect(khongXuLy).toEqual([]);
  });
});
