/**
 * moPhongLogic.unit.test.ts — lưới cho §11 #30 (what-if) + #35 (phát lại).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LƯỚI NÀY ĐƯỢC VIẾT ĐỂ **KÊU** — G5 / G32 / G10
 * ════════════════════════════════════════════════════════════════════════════
 * Sổ dự án ghi bốn luật cùng họ (G5/G6/G7/G10) đều cho **cổng xanh mà không đo
 * gì**: đo trên tập rỗng · nhánh không ai đi · đếm đầu-vào ≠ đầu-ra · chỉ báo
 * chỉ định nhầm. Nên mỗi nhóm dưới đây phải trả lời được: *bản cài đặt SAI nào
 * bị nhóm này bắt?*
 *
 * Sáu bản cài đặt sai đã TIÊM THỬ và bị lưới này bắt (xem báo cáo lô X):
 *   (a) bỏ cửa `conHieuLuc` (tin lời khai 18 ngày)   → "nhịp hết hạn phải TỪ CHỐI"
 *   (b) `avgCycleTimeMs ?? 0` thay vì honest-null    → "bản ghi NULL không được thành 0"
 *   (c) gộp mọi lý do thành một "khong_du_lieu"      → "sáu lý do phải PHÂN BIỆT được"
 *   (d) `rongPhanTram` không có sàn                  → "bước 0 ms vẫn phải thấy được"
 *   (e) `mocBuocKeTiep` = `moc + delta`              → "đứng đúng trên biên phải ĐI TIẾP"
 *   (f) `daChay: endMs < mocMs` (thiếu dấu bằng)     → "kéo tới hết ⇒ bước cuối XONG"
 */
import { describe, it, expect } from "vitest";

import {
  coThoiLuong,
  dungDauVaoWhatIf,
  datBuocPhatLai,
  mocBuocKeTiep,
  nhanTuoi,
  kep,
  HAN_KHAI_NGHEN_MS,
  HORIZON_MIN,
  HORIZON_MAX,
  HE_SO_MIN,
  HE_SO_MAX,
  type ThamSoWhatIf,
  type BuocMoPhong,
} from "./moPhongLogic";

const BAY_GIO = 1_757_000_000_000;

/** Tham số "mọi thứ đều ổn" — mỗi ca chỉ ghi đè ĐÚNG ô đang đo. */
function ok(p: Partial<ThamSoWhatIf> = {}): ThamSoWhatIf {
  return {
    lineId: 1,
    tram: [
      { stationId: 1, ten: "SIM-L1 SPI Station" },
      { stationId: 2, ten: "SIM-L1 AOI Station" },
    ],
    nhip: { avgCycleTimeMs: 9_600, mocKhai: BAY_GIO - 60_000 },
    horizonHours: 8,
    cycleTimeMultiplier: 1,
    bayGio: BAY_GIO,
    ...p,
  };
}

describe("#30 dungDauVaoWhatIf — cửa kiểm ĐỦ ĐIỀU KIỆN", () => {
  it("ca đủ điều kiện CHẠY, và đầu vào khác hẳn nhánh từ chối (G5: không đo trên tập rỗng)", () => {
    const r = dungDauVaoWhatIf(ok());
    expect(r.chay).toBe(true);
    if (!r.chay) throw new Error("unreachable");
    // 9.600 ms ⇒ 9,6 s. Nếu ai đó trả 0 hoặc trả ms thô, ô này kêu.
    expect(r.dauVao.stations).toHaveLength(2);
    expect(r.dauVao.stations[0].cycleTimeSec).toBe(9.6);
    expect(r.dauVao.stations[0].stationId).toBe(1);
    expect(r.dauVao.stations[0].name).toBe("SIM-L1 SPI Station");
    expect(r.dauVao.horizonHours).toBe(8);
    expect(r.dauVao.cycleTimeMultiplier).toBe(1);
  });

  it("★★★ (a) NHỊP HẾT HẠN phải TỪ CHỐI — lời khai cũ không bác được phép đo sống (G30)", () => {
    // Đúng con số ĐO ĐƯỢC trên CSDL này: bản ghi mới nhất của chuyền 1 là
    // 2026-08-21, tức 18 ngày trước 2026-09-08.
    const moc18ngay = BAY_GIO - 18 * 24 * 60 * 60 * 1000;
    const r = dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: 9_600, mocKhai: moc18ngay } }));
    expect(r.chay).toBe(false);
    if (r.chay) throw new Error("unreachable");
    expect(r.lyDo).toBe("nhip_het_han");
    // Tuổi PHẢI đi kèm — không có nó thì lý do không kiểm chứng được.
    expect(r.tuoiMs).toBe(18 * 24 * 60 * 60 * 1000);
  });

  it("biên 8 giờ: đúng hạn thì CHẠY, quá hạn 1 ms thì TỪ CHỐI (G32: hàm phải đổi ở biên)", () => {
    const dungHan = dungDauVaoWhatIf(
      ok({ nhip: { avgCycleTimeMs: 9_600, mocKhai: BAY_GIO - HAN_KHAI_NGHEN_MS } }),
    );
    const quaHan = dungDauVaoWhatIf(
      ok({ nhip: { avgCycleTimeMs: 9_600, mocKhai: BAY_GIO - HAN_KHAI_NGHEN_MS - 1 } }),
    );
    expect(dungHan.chay).toBe(true);
    expect(quaHan.chay).toBe(false);
  });

  it("★★★ (b) `avgCycleTimeMs` NULL KHÔNG được thành 0 — đó là lời khai sai", () => {
    // Đo được: hàng mới nhất của chuyền 1 CÓ TỒN TẠI nhưng avgCycleTimeMs NULL.
    const r = dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: null, mocKhai: BAY_GIO - 60_000 } }));
    expect(r.chay).toBe(false);
    if (r.chay) throw new Error("unreachable");
    expect(r.lyDo).toBe("ban_ghi_khong_co_nhip");
    // Bản `?? 0` sẽ ra `chay: true` với cycleTimeSec = 0 — ô trên đã chặn.
  });

  it("nhịp ≤ 0 hoặc NaN cũng TỪ CHỐI (zod `.positive()` — đừng đẩy 400 xuống server)", () => {
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: ms, mocKhai: BAY_GIO } }));
      expect(r.chay).toBe(false);
      if (r.chay) throw new Error("unreachable");
      expect(r.lyDo).toBe("ban_ghi_khong_co_nhip");
    }
  });

  it("`mocKhai` null ⇒ KHÔNG kiểm được hạn ⇒ KHÔNG tin (mặc định 'cứ tin' là chế độ hỏng)", () => {
    const r = dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: 9_600, mocKhai: null } }));
    expect(r.chay).toBe(false);
    if (r.chay) throw new Error("unreachable");
    expect(r.lyDo).toBe("nhip_het_han");
    expect(r.tuoiMs).toBeNull();
  });

  it("★★★ (c) SÁU lý do phải PHÂN BIỆT ĐƯỢC — gộp thành một là vứt đi thông tin hành động (G50)", () => {
    const cac = [
      dungDauVaoWhatIf(ok({ lineId: null })),
      dungDauVaoWhatIf(ok({ tram: [] })),
      dungDauVaoWhatIf(ok({ nhip: undefined })),
      dungDauVaoWhatIf(ok({ nhip: null })),
      dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: null, mocKhai: BAY_GIO } })),
      dungDauVaoWhatIf(ok({ nhip: { avgCycleTimeMs: 9_600, mocKhai: BAY_GIO - 9 * 3600_000 } })),
    ];
    const lyDo = cac.map((r) => (r.chay ? "CHAY" : r.lyDo));
    expect(lyDo).toEqual([
      "chua_chon_line",
      "khong_co_tram",
      "chua_do",
      "khong_co_ban_ghi",
      "ban_ghi_khong_co_nhip",
      "nhip_het_han",
    ]);
    // Sáu giá trị RỜI NHAU — một bản gộp sẽ cho một mảng toàn giá trị giống nhau.
    expect(new Set(lyDo).size).toBe(6);
  });

  it("thứ tự kiểm: chưa chọn chuyền THẮNG mọi lỗi khác (không báo 'hết hạn' cho chuyền chưa chọn)", () => {
    const r = dungDauVaoWhatIf(
      ok({ lineId: null, tram: [], nhip: { avgCycleTimeMs: null, mocKhai: null } }),
    );
    expect(r.chay).toBe(false);
    if (r.chay) throw new Error("unreachable");
    expect(r.lyDo).toBe("chua_chon_line");
  });

  it("`undefined` (chưa đo) KHÁC `null` (đã đo, 0 hàng) — hai câu khác nhau", () => {
    const chuaDo = dungDauVaoWhatIf(ok({ nhip: undefined }));
    const rong = dungDauVaoWhatIf(ok({ nhip: null }));
    expect(chuaDo.chay).toBe(false);
    expect(rong.chay).toBe(false);
    if (chuaDo.chay || rong.chay) throw new Error("unreachable");
    expect(chuaDo.lyDo).not.toBe(rong.lyDo);
  });
});

describe("kep — tham số người dùng gõ", () => {
  it("kẹp về khoảng zod, và NaN ⇒ mặc định (không đẩy NaN xuống server)", () => {
    expect(kep(5, HORIZON_MIN, HORIZON_MAX, 8)).toBe(5);
    expect(kep(0, HORIZON_MIN, HORIZON_MAX, 8)).toBe(HORIZON_MIN);
    expect(kep(9999, HORIZON_MIN, HORIZON_MAX, 8)).toBe(HORIZON_MAX);
    expect(kep(Number.NaN, HORIZON_MIN, HORIZON_MAX, 8)).toBe(8);
    expect(kep(0.05, HE_SO_MIN, HE_SO_MAX, 1)).toBe(HE_SO_MIN);
    expect(kep(50, HE_SO_MIN, HE_SO_MAX, 1)).toBe(HE_SO_MAX);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */

const BUOC: BuocMoPhong[] = [
  { stepId: "wait_state-1", stepType: "wait_state", machineId: 1, startMs: 0, endMs: 3000, status: "ok" },
  // ★ Bước 0 ms — `hitl_gate` mặc định `gateMs: 0`. Đây là ca (d).
  { stepId: "hitl_gate-1", stepType: "hitl_gate", startMs: 3000, endMs: 3000, status: "ok" },
  { stepId: "command-2", stepType: "command", machineId: 1, command: "start", startMs: 3000, endMs: 4000, status: "ok" },
];
const TONG = 4000;

describe("#35 datBuocPhatLai — đặt bước lên khung", () => {
  it("phần trăm tính đúng theo tổng thời lượng (G10: đầu ra phải KHÁC đầu vào)", () => {
    const r = datBuocPhatLai(BUOC, TONG, 0);
    expect(r).toHaveLength(3);
    expect(r[0].traiPhanTram).toBe(0);
    expect(r[0].rongPhanTram).toBe(75); // 3000/4000
    expect(r[2].traiPhanTram).toBe(75);
    expect(r[2].rongPhanTram).toBe(25); // 1000/4000
  });

  it("★★★ (d) BƯỚC 0 ms VẪN PHẢI THẤY ĐƯỢC — sàn 0,5 %", () => {
    const r = datBuocPhatLai(BUOC, TONG, 0);
    const cong = r.find((b) => b.stepId === "hitl_gate-1")!;
    // Bản không sàn cho 0 ⇒ cổng duyệt BIẾN MẤT khỏi màn hình.
    expect(cong.rongPhanTram).toBeGreaterThan(0);
    expect(cong.rongPhanTram).toBe(0.5);
  });

  it("★★★ (f) kéo tới HẾT ⇒ MỌI bước đã chạy xong (dấu bằng ở `endMs <= mocMs`)", () => {
    const r = datBuocPhatLai(BUOC, TONG, TONG);
    expect(r.every((b) => b.daChay)).toBe(true);
    expect(r.some((b) => b.dangChay)).toBe(false);
  });

  it("mốc giữa: phân biệt đã-chạy / đang-chạy / chưa-chạy (ba trạng thái, không phải hai)", () => {
    const r = datBuocPhatLai(BUOC, TONG, 3500);
    expect(r[0].daChay).toBe(true);
    expect(r[0].dangChay).toBe(false);
    expect(r[1].daChay).toBe(true); // gate 0 ms tại 3000 đã qua
    expect(r[2].daChay).toBe(false);
    expect(r[2].dangChay).toBe(true);
  });

  it("mốc 0: chưa bước nào chạy xong, bước đầu ĐANG chạy", () => {
    const r = datBuocPhatLai(BUOC, TONG, 0);
    expect(r[0].daChay).toBe(false);
    expect(r[0].dangChay).toBe(true);
    expect(r[2].daChay).toBe(false);
  });

  it("tổng = 0 hoặc không hữu hạn ⇒ chia đều, KHÔNG có NaN/Infinity rời hàm (hỏng câm)", () => {
    for (const tong of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = datBuocPhatLai(BUOC, tong, 0);
      expect(r).toHaveLength(3);
      for (const b of r) {
        expect(Number.isFinite(b.traiPhanTram)).toBe(true);
        expect(Number.isFinite(b.rongPhanTram)).toBe(true);
        expect(b.rongPhanTram).toBeGreaterThan(0);
        expect(b.traiPhanTram).toBeGreaterThanOrEqual(0);
        expect(b.traiPhanTram).toBeLessThanOrEqual(100);
      }
    }
  });

  it("mảng rỗng ⇒ mảng rỗng (và ô này KHÔNG được là bằng chứng duy nhất — G5)", () => {
    expect(datBuocPhatLai([], TONG, 0)).toEqual([]);
  });
});

describe("#35 mocBuocKeTiep — đi theo BIÊN bước, không cộng delta", () => {
  it("★★★ (e) đứng ĐÚNG trên biên vẫn phải ĐI TIẾP — nếu không thì f(x)=x (G32)", () => {
    // 3000 là biên thật (start của gate + command). Bản `>=` sẽ đứng im ở 3000.
    expect(mocBuocKeTiep(BUOC, 3000, 1, TONG)).toBe(4000);
    expect(mocBuocKeTiep(BUOC, 3000, -1, TONG)).toBe(0);
  });

  it("đi tới từng biên một, không nhảy cóc", () => {
    expect(mocBuocKeTiep(BUOC, 0, 1, TONG)).toBe(3000);
    expect(mocBuocKeTiep(BUOC, 1500, 1, TONG)).toBe(3000);
    expect(mocBuocKeTiep(BUOC, 3500, 1, TONG)).toBe(4000);
  });

  it("lùi về biên trước, và ĐÚNG các biên đó (không phải mốc tuỳ ý)", () => {
    expect(mocBuocKeTiep(BUOC, 4000, -1, TONG)).toBe(3000);
    expect(mocBuocKeTiep(BUOC, 3500, -1, TONG)).toBe(3000);
    expect(mocBuocKeTiep(BUOC, 2999, -1, TONG)).toBe(0);
  });

  it("kẹp ở hai đầu — không vượt quá tổng, không âm", () => {
    expect(mocBuocKeTiep(BUOC, 4000, 1, TONG)).toBe(4000);
    expect(mocBuocKeTiep(BUOC, 99_999, 1, TONG)).toBe(4000);
    expect(mocBuocKeTiep(BUOC, 0, -1, TONG)).toBe(0);
    expect(mocBuocKeTiep(BUOC, -50, -1, TONG)).toBe(0);
  });

  it("mảng rỗng: vẫn đi được giữa 0 và tổng (thanh trượt không được chết)", () => {
    expect(mocBuocKeTiep([], 0, 1, 4000)).toBe(4000);
    expect(mocBuocKeTiep([], 4000, -1, 4000)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ CHẾ ĐỘ THEO BƯỚC — LỖI CHỈ TRÌNH DUYỆT THẬT BẮT ĐƯỢC                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hình dạng ĐO ĐƯỢC của `qt-4-changeover-npi` trên CSDL này (2026-09-08):
 * 5 bước, TOÀN `hitl_gate`, mọi bước `0 -> 0`, `totalDurationMs = 0`.
 * 4/5 workflow thật có đúng hình dạng này.
 */
const BUOC_TOAN_CONG: BuocMoPhong[] = [
  { stepId: "qt4-changeover", stepType: "hitl_gate", startMs: 0, endMs: 0, status: "gate" },
  { stepId: "qt4-distribute-recipe", stepType: "hitl_gate", startMs: 0, endMs: 0, status: "gate" },
  { stepId: "qt4-sim-gate", stepType: "hitl_gate", startMs: 0, endMs: 0, status: "gate" },
  { stepId: "qt4-readiness", stepType: "hitl_gate", startMs: 0, endMs: 0, status: "gate" },
  { stepId: "qt4-ready", stepType: "hitl_gate", startMs: 0, endMs: 0, status: "gate" },
];

describe("★★★ coThoiLuong — 4/5 WORKFLOW THẬT KHÔNG MANG THỜI LƯỢNG", () => {
  it("workflow toàn `hitl_gate` (tổng 0) ⇒ KHÔNG có thời lượng", () => {
    expect(coThoiLuong(BUOC_TOAN_CONG, 0)).toBe(false);
  });

  it("workflow có command/wait thật (Line-a-startup, tổng 34.000) ⇒ CÓ thời lượng", () => {
    expect(coThoiLuong(BUOC, TONG)).toBe(true);
  });

  it("tổng > 0 mà MỌI bước dài 0 ⇒ vẫn KHÔNG so sánh được ⇒ false", () => {
    // Ca hiểm: tổng khác 0 nhưng không bước nào có bề dài — thanh Gantt sẽ toàn
    // sàn 0,5 % và không nói được gì. Chế độ bước đúng hơn.
    expect(coThoiLuong(BUOC_TOAN_CONG, 5_000)).toBe(false);
  });
});

describe("★★★ mocBuocKeTiep — CHẾ ĐỘ BƯỚC (lỗi G32 mà 1.694 lưới đơn vị mù)", () => {
  it("★★★ nút ►/◄ PHẢI đi được khi mọi `startMs` bằng 0 — trước bản vá nó CHẾT", () => {
    // Trình duyệt thật bắt: moc "0.0s / 0.0s" không đổi sau khi bấm Tới bước.
    // Gốc rễ: tập biên `[0, ...startMs, tongMs]` gộp về đúng `[0]` ⇒ f(x) = x.
    expect(mocBuocKeTiep(BUOC_TOAN_CONG, 0, 1, 0)).toBe(1);
    expect(mocBuocKeTiep(BUOC_TOAN_CONG, 1, 1, 0)).toBe(2);
    expect(mocBuocKeTiep(BUOC_TOAN_CONG, 4, 1, 0)).toBe(4); // kẹp ở bước cuối
    expect(mocBuocKeTiep(BUOC_TOAN_CONG, 3, -1, 0)).toBe(2);
    expect(mocBuocKeTiep(BUOC_TOAN_CONG, 0, -1, 0)).toBe(0); // kẹp ở bước đầu
  });

  it("đi hết 5 bước rồi dừng — mỗi lần bấm PHẢI tiến đúng một bước", () => {
    let m = 0;
    const duong: number[] = [m];
    for (let i = 0; i < 6; i++) {
      m = mocBuocKeTiep(BUOC_TOAN_CONG, m, 1, 0);
      duong.push(m);
    }
    expect(duong).toEqual([0, 1, 2, 3, 4, 4, 4]);
  });
});

describe("★★★ datBuocPhatLai — CHẾ ĐỘ BƯỚC", () => {
  it("mốc = CHỈ SỐ: bước 0 đang chạy, chưa bước nào xong", () => {
    const r = datBuocPhatLai(BUOC_TOAN_CONG, 0, 0);
    expect(r.map((b) => b.dangChay)).toEqual([true, false, false, false, false]);
    expect(r.every((b) => !b.daChay)).toBe(true);
  });

  it("★★★ KHÔNG được cho MỌI bước 'đã chạy' ngay tại mốc 0", () => {
    // Bản dùng `endMs <= mocMs` cho chế độ bước sẽ ra `0 <= 0` = true cho CẢ 5
    // bước ⇒ thanh xanh hết từ đầu và con trượt vô nghĩa.
    const r = datBuocPhatLai(BUOC_TOAN_CONG, 0, 0);
    expect(r.filter((b) => b.daChay)).toHaveLength(0);
  });

  it("tiến tới bước 3: ba bước đầu xong, bước 3 đang chạy, hai bước sau chưa", () => {
    const r = datBuocPhatLai(BUOC_TOAN_CONG, 0, 3);
    expect(r.map((b) => b.daChay)).toEqual([true, true, true, false, false]);
    expect(r.map((b) => b.dangChay)).toEqual([false, false, false, true, false]);
  });

  it("chia đều bề rộng và MỌI thanh > 0 px (đo được trên trình duyệt: 56,39 px × 5)", () => {
    const r = datBuocPhatLai(BUOC_TOAN_CONG, 0, 0);
    expect(r.map((b) => b.rongPhanTram)).toEqual([20, 20, 20, 20, 20]);
    expect(r.map((b) => b.traiPhanTram)).toEqual([0, 20, 40, 60, 80]);
  });

  it("★ hai hàm PHẢI cùng một chế độ — nút đi theo chỉ số thì thanh cũng vậy (G12)", () => {
    // Nếu `datBuocPhatLai` và `mocBuocKeTiep` chia chế độ theo hai luật khác
    // nhau: bấm nút thấy số đổi mà KHÔNG thanh nào sáng. Ô này buộc chúng khớp.
    const moc = mocBuocKeTiep(BUOC_TOAN_CONG, 0, 1, 0);
    const r = datBuocPhatLai(BUOC_TOAN_CONG, 0, moc);
    expect(r.filter((b) => b.dangChay)).toHaveLength(1);
    expect(r.findIndex((b) => b.dangChay)).toBe(moc);
  });

  it("★★★ CA HIỂM: tổng > 0 mà mọi bước dài 0 — hai hàm VẪN phải cùng chế độ", () => {
    /*
     * Ca này được thêm sau khi ĐỘT BIẾN (k) SỐNG SÓT: thay
     * `coThoiLuong(buoc, tongMs)` trong `datBuocPhatLai` bằng `tongMs > 0` thì
     * mọi ô cũ vẫn xanh, vì `BUOC_TOAN_CONG` đi kèm `tongMs = 0` — hai luật
     * TRÙNG kết quả ở đúng bộ dữ liệu đang đo. Đây là G10 nguyên bản: lưới
     * không phân biệt được hai bản cài đặt vì chưa từng hỏi ở chỗ chúng khác
     * nhau. Chỗ khác nhau DUY NHẤT là `tongMs > 0` + mọi bước dài 0.
     */
    const TONG_AO = 5_000;
    expect(coThoiLuong(BUOC_TOAN_CONG, TONG_AO)).toBe(false);

    const moc = mocBuocKeTiep(BUOC_TOAN_CONG, 0, 1, TONG_AO);
    expect(moc, "nút phải đi theo CHỈ SỐ, không theo mili giây").toBe(1);

    const r = datBuocPhatLai(BUOC_TOAN_CONG, TONG_AO, moc);
    // Bản dùng `tongMs > 0` sẽ chia theo `startMs` (đều bằng 0) ⇒ mọi thanh
    // chồng lên nhau ở trái 0 %, và KHÔNG bước nào `dangChay` tại mốc 1.
    expect(r.map((b) => b.traiPhanTram)).toEqual([0, 20, 40, 60, 80]);
    expect(r.filter((b) => b.dangChay), "đúng MỘT bước đang chạy").toHaveLength(1);
    expect(r.findIndex((b) => b.dangChay)).toBe(moc);
  });
});

describe("nhanTuoi — honest-null cho tuổi lời khai", () => {
  it("phút / giờ / ngày, và ĐÚNG con số đo được (18 ngày)", () => {
    expect(nhanTuoi(9 * 60_000)).toEqual({ so: 9, donVi: "phut" });
    expect(nhanTuoi(3 * 3600_000)).toEqual({ so: 3, donVi: "gio" });
    expect(nhanTuoi(18 * 24 * 3600_000)).toEqual({ so: 18, donVi: "ngay" });
  });

  it("biên 60 phút và 24 giờ đổi đơn vị (G32)", () => {
    expect(nhanTuoi(59 * 60_000)).toEqual({ so: 59, donVi: "phut" });
    expect(nhanTuoi(60 * 60_000)).toEqual({ so: 1, donVi: "gio" });
    expect(nhanTuoi(23 * 3600_000)).toEqual({ so: 23, donVi: "gio" });
    expect(nhanTuoi(24 * 3600_000)).toEqual({ so: 1, donVi: "ngay" });
  });

  it("null / NaN / âm ⇒ null, KHÔNG phải '0 phút' (lời khai sai)", () => {
    expect(nhanTuoi(null)).toBeNull();
    expect(nhanTuoi(Number.NaN)).toBeNull();
    expect(nhanTuoi(-1)).toBeNull();
  });

  it("★★★ KHÔNG trả chuỗi đã dịch — lỗi '(17 ngày ago)' mà ẢNH bắt được", () => {
    /*
     * Bản đầu trả `"17 ngày"` (tiếng Việt cứng), rồi tầng vẽ ghép vào khuôn
     * tiếng Anh `"{{tuoi}} ago"` ⇒ màn hình in "(17 ngày ago)". `tsc` xanh, 36
     * lưới xanh, 3 ca Playwright xanh — vì không ô nào hỏi *chuỗi này thuộc
     * ngôn ngữ nào*. Ô này canh đúng điều đó: đầu ra phải là DỮ LIỆU.
     */
    const r = nhanTuoi(17 * 24 * 3600_000);
    expect(typeof r).toBe("object");
    expect(r).toEqual({ so: 17, donVi: "ngay" });
    // Không một ký tự chữ nào của bất kỳ ngôn ngữ nào được rời module thuần.
    expect(JSON.stringify(r)).not.toMatch(/ngày|giờ|phút|day|hour|min|天|小时/);
  });
});
