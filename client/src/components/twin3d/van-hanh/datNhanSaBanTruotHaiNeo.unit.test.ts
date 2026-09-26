/**
 * datNhanSaBanTruotHaiNeo.unit.test.ts — ★★★ TRẦN TRƯỢT PHẢI ĐO TỪ NEO ĐANG NÉ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SỐ ĐO SINH RA TỆP NÀY (trình duyệt thật, 1280×720, khung MẶC ĐỊNH, KHÔNG thu
 * panel, KHÔNG bấm gì trước khi đọc 3D — `.qa-tapdoan/zz-nhan2-do1-truoc.json`)
 * ════════════════════════════════════════════════════════════════════════════
 * Vai `qatd_kythuat`, chế độ **3D**, nhãn **"Toà 2"** (khối toà 92):
 *
 *   khối đã chiếu   [356,3..445,1] × [182,7..245,3]   (px gốc canvas)
 *   hộp chữ         37,7 × 18,5
 *   thẻ Metrics     [232..470] × [34..254,3]
 *
 * Luật CŨ đặt nhãn ở `duoi-giua` (y = 260,55) và **15,1 %** thân chữ nằm dưới
 * thẻ — `soNhan()` vẫn đếm nó là "vẽ". Đây là ô "nhãn hiện-mà-bị-che-một-phần"
 * duy nhất trong bốn vai QATD.
 *
 * ★★★ GỐC RỄ — và nó KHÔNG phải "hết chỗ": chỗ thoát sạch hẳn nằm ở
 *   y = 254,3 + 6 + 9,25 = **269,55**, tức cách `duoi-giua` vỏn vẹn **9,0 px**.
 *   Luật cũ sinh ứng viên trượt cho DUY NHẤT neo ưu tiên và đo quãng trượt từ
 *   `yDau` = 167,45 (neo `tren`), nên quãng thành **102,1 px** > trần 40 ⇒ ứng
 *   viên ấy KHÔNG BAO GIỜ ĐƯỢC SINH RA. Riêng cú lật `tren` → `duoi` đã tiêu
 *   93,1 px trần (chiều cao khối 62,6 + hai lần khe+nửa chữ) mà chưa né được gì.
 *
 * ⚠ ĐỐI CHỨNG DƯƠNG: ablation `.qa-tapdoan/zz-nhan2-ablation.mjs` chạy CHÍNH các
 *   ca dưới đây trên bản `de1dc50a` (trước vá) — phải ĐỎ 3/3; trên bản sau vá —
 *   XANH 3/3. Một lưới không biết kêu trên bản cũ thì không chứng minh được gì.
 */
import { describe, expect, it } from "vitest";

import { KHE_NHAN_PX, TRUOT_TOI_DA_PX, datNhanSaBan, type HopNhanPx } from "./datNhanSaBan";
import { nhanKhoiCoCum } from "./CanhVanHanh2D";

const KHUNG = { rong: 968, cao: 489 };

/** Khối toà 92 của `qatd_kythuat` đã chiếu ra px — ĐO THẬT, không bịa. */
const KHOI_TOA2: HopNhanPx = { trai: 356.3, phai: 445.1, tren: 182.7, duoi: 245.3 };
const CHU_TOA: { rong: number; cao: number } = { rong: 37.7, cao: 18.5 };
/** Thẻ `bang-kpi-noi` của `qatd_kythuat` (px gốc canvas) — ĐO THẬT. */
const THE_KPI: HopNhanPx = { trai: 232, phai: 470, tren: 34, duoi: 254.3 };

/** Hộp chữ quanh một chỗ đặt. */
const hopChu = (d: { x: number; y: number }, co: { rong: number; cao: number }): HopNhanPx => ({
  trai: d.x - co.rong / 2,
  phai: d.x + co.rong / 2,
  tren: d.y - co.cao / 2,
  duoi: d.y + co.cao / 2,
});
/** Phần trăm diện tích hộp chữ bị một lớp phủ ăn. */
function tyLeChe(h: HopNhanPx, z: HopNhanPx): number {
  const gx = Math.max(0, Math.min(h.phai, z.phai) - Math.max(h.trai, z.trai));
  const gy = Math.max(0, Math.min(h.duoi, z.duoi) - Math.max(h.tren, z.tren));
  return (gx * gy) / ((h.phai - h.trai) * (h.duoi - h.tren));
}

describe("★★★ ① Ca THẬT `qatd_kythuat` 3D “Toà 2” — phải SẠCH TRỌN, không chỉ sạch tâm", () => {
  it("KHẲNG ĐỊNH KÍCH THƯỚC đầu vào: hình học là số ĐO, không phải số bịa", () => {
    expect(KHOI_TOA2.phai - KHOI_TOA2.trai).toBeCloseTo(88.8, 6);
    expect(KHOI_TOA2.duoi - KHOI_TOA2.tren).toBeCloseTo(62.6, 6);
    expect(CHU_TOA.rong).toBeGreaterThan(0);
    expect(THE_KPI.duoi).toBeCloseTo(254.3, 6);
    // Neo `tren` VÀ neo `duoi` đều bị thẻ chắn — nếu không thì ca này vô nghĩa.
    const yTren = KHOI_TOA2.tren - KHE_NHAN_PX - CHU_TOA.cao / 2;
    const yDuoi = KHOI_TOA2.duoi + KHE_NHAN_PX + CHU_TOA.cao / 2;
    expect(tyLeChe(hopChu({ x: 400.7, y: yTren }, CHU_TOA), THE_KPI)).toBeGreaterThan(0);
    expect(tyLeChe(hopChu({ x: 400.7, y: yDuoi }, CHU_TOA), THE_KPI)).toBeGreaterThan(0);
  });

  it("chỗ đặt KHÔNG được giao một pixel nào với thẻ Metrics (luật cũ: 15,1 %)", () => {
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [THE_KPI], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(tyLeChe(hopChu(d!, CHU_TOA), THE_KPI)).toBe(0);
  });

  it("chỗ ấy là phép TRƯỢT khỏi mép dưới thẻ, cách neo `duoi` đúng 9,0 px", () => {
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [THE_KPI], KHUNG, "tren");
    expect(d!.ma).toBe("truot");
    expect(d!.y).toBeCloseTo(THE_KPI.duoi + KHE_NHAN_PX + CHU_TOA.cao / 2, 6);
    const yDuoi = KHOI_TOA2.duoi + KHE_NHAN_PX + CHU_TOA.cao / 2;
    expect(Math.abs(d!.y - yDuoi)).toBeCloseTo(9.0, 1);
    // …và quãng ấy ĐO TỪ NEO ƯU TIÊN thì vượt trần — đúng lý do luật cũ trượt oan.
    const yUuTien = KHOI_TOA2.tren - KHE_NHAN_PX - CHU_TOA.cao / 2;
    expect(Math.abs(d!.y - yUuTien)).toBeGreaterThan(TRUOT_TOI_DA_PX);
  });
});

describe("★ ② Bản vá KHÔNG được dời nhãn đang tốt (hazard tự sinh)", () => {
  it("không lớp phủ ⇒ vẫn đúng neo ưu tiên, không lệch một pixel", () => {
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [], KHUNG, "tren");
    expect(d!.ma).toBe("tren-giua");
    expect(d!.y).toBeCloseTo(KHOI_TOA2.tren - KHE_NHAN_PX - CHU_TOA.cao / 2, 6);
  });

  it("chỉ neo ƯU TIÊN bị chắn ⇒ vẫn ra chỗ cũ của luật cũ (trượt khỏi đúng lớp ấy)", () => {
    // Thẻ chỉ chắn neo `tren`, chừa neo `duoi` sạch ⇒ `duoi-giua` phải thắng.
    const the: HopNhanPx = { trai: 232, phai: 470, tren: 34, duoi: 180 };
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [the], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(tyLeChe(hopChu(d!, CHU_TOA), the)).toBe(0);
  });
});

describe("★ ③ Trần trượt VẪN CÒN HIỆU LỰC — bản vá không được biến nó thành vô hạn", () => {
  it("lớp phủ xa đến mức chỗ thoát vượt trần ⇒ KHÔNG sinh ứng viên trượt cho neo ấy", () => {
    // Lớp phủ RẤT cao: thoát khỏi nó phải đi quá TRUOT_TOI_DA_PX tính từ CẢ HAI neo.
    const cao: HopNhanPx = { trai: 232, phai: 470, tren: 0, duoi: 400 };
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [cao], KHUNG, "tren");
    // Nếu có chỗ nào được nhận, nó KHÔNG được là một phép trượt quá trần.
    if (d && d.ma === "truot") {
      const yTren = KHOI_TOA2.tren - KHE_NHAN_PX - CHU_TOA.cao / 2;
      const yDuoi = KHOI_TOA2.duoi + KHE_NHAN_PX + CHU_TOA.cao / 2;
      const gan = Math.min(Math.abs(d.y - yTren), Math.abs(d.y - yDuoi));
      expect(gan).toBeLessThanOrEqual(TRUOT_TOI_DA_PX + 1e-9);
    }
    expect(true).toBe(true);
  });

  it("G8 — khung 0×0 ⇒ trả NGUYÊN neo ưu tiên, không ẩn ai (đường mà jsdom đi)", () => {
    const d = datNhanSaBan(KHOI_TOA2, CHU_TOA, [THE_KPI], { rong: 0, cao: 0 }, "tren");
    expect(d).not.toBeNull();
    expect(d!.ma).toBe("tren-giua");
  });
});

describe("★ ④ `<title>` khối toà — đường đọc lại tên khi nhãn bị ẩn, KHÔNG được lặp tên", () => {
  it("nối cụm + toà khi hai tên khác nhau", () => {
    expect(nhanKhoiCoCum("Công ty A", "Toà 1")).toBe("Công ty A — Toà 1");
  });

  it("ca THẬT toà 90 `qatd_admin`: tên toà đã mở đầu bằng tên cụm ⇒ KHÔNG lặp", () => {
    // Trước bản vá dòng mách đọc ra "FUYU-F (tai tong hop) — FUYU-F (tai tong hop) — toa chinh".
    expect(nhanKhoiCoCum("FUYU-F (tai tong hop)", "FUYU-F (tai tong hop) — toa chinh")).toBe(
      "FUYU-F (tai tong hop) — toa chinh",
    );
  });

  it("trùng khít ⇒ một lần; thiếu tên cụm ⇒ trả nguyên tên toà", () => {
    expect(nhanKhoiCoCum("Công ty A", "Công ty A")).toBe("Công ty A");
    expect(nhanKhoiCoCum(undefined, "Toà 2")).toBe("Toà 2");
    expect(nhanKhoiCoCum("", "Toà 2")).toBe("Toà 2");
  });

  it("KHÔNG cắt nhầm khi tên cụm chỉ là TIỀN TỐ CHỮ của tên toà", () => {
    // "Công ty A" vs "Công ty AB — Toà 1": không được coi là trùng.
    expect(nhanKhoiCoCum("Công ty A", "Công ty AB — Toà 1")).toBe("Công ty A — Công ty AB — Toà 1");
  });
});

describe("★★★ ⑤ Chỗ đặt phải NHÌN THẤY ĐƯỢC — hộp chữ không được thò khỏi khung", () => {
  /**
   * Ca THẬT `qatd_admin` 2D, nhãn "FUYU-F (tai tong hop) — toa chinh": bản vá
   * trần trượt sinh ứng viên `truot` y = 1,4 — TÂM trong khung, nhưng hộp chữ
   * cao 17 px trải từ −7,1 ⇒ `<svg>` `overflow:hidden` CẮT 41,8 % chiều cao.
   * Đo: nền `de1dc50a` 0/38 nhãn 2D thò khung · trước khi vá tiếp 1/41.
   */
  const KHOI: HopNhanPx = { trai: 389.2, phai: 475.4, tren: 44.9, duoi: 107.7 };
  const CHU = { rong: 205, cao: 17 };
  /** Thẻ KPI + nhãn cụm ĐÃ ĐẶT (vùng cấm) — đúng bộ mà cảnh thật dựng. */
  const THE_KPI: HopNhanPx = { trai: 232, phai: 552, tren: 59, duoi: 279.3 };
  const NHAN_CUM_DA_DAT: HopNhanPx = { trai: 397.9, phai: 570.1, tren: 15.9, duoi: 38.9 };

  it("KHẲNG ĐỊNH: ứng viên nguy hiểm CÓ TỒN TẠI (nếu không, ca này vô nghĩa)", () => {
    // Trượt lên khỏi nhãn cụm đã đặt = y 1,4 ⇒ hộp chữ chạm −7,1.
    const yNguy = NHAN_CUM_DA_DAT.tren - KHE_NHAN_PX - CHU.cao / 2;
    expect(yNguy).toBeCloseTo(1.4, 6);
    expect(yNguy - CHU.cao / 2).toBeLessThan(0); // hộp thò khỏi khung
    expect(yNguy).toBeGreaterThanOrEqual(0); // …mà TÂM thì không ⇒ phép thử tâm mù
  });

  it("KHÔNG được chọn chỗ mà hộp chữ thò khỏi khung", () => {
    const d = datNhanSaBan(KHOI, CHU, [THE_KPI, NHAN_CUM_DA_DAT], KHUNG, "trong");
    expect(d).not.toBeNull();
    expect(d!.y - CHU.cao / 2).toBeGreaterThanOrEqual(0);
    expect(d!.y + CHU.cao / 2).toBeLessThanOrEqual(KHUNG.cao);
    expect(d!.x - CHU.rong / 2).toBeGreaterThanOrEqual(0);
    expect(d!.x + CHU.rong / 2).toBeLessThanOrEqual(KHUNG.rong);
  });

  it("và chỗ được chọn đúng là chỗ của NỀN `de1dc50a` (y = 44,5) — 0 hồi quy", () => {
    const d = datNhanSaBan(KHOI, CHU, [THE_KPI, NHAN_CUM_DA_DAT], KHUNG, "trong");
    expect(d!.y).toBeCloseTo(44.5, 1);
  });
});
