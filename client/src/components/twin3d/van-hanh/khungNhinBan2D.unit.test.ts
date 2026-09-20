/**
 * khungNhinBan2D.unit.test.ts — **ĐẶT NỘI DUNG 2D VÀO VÙNG CÒN DÙNG ĐƯỢC.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC GHIM — ĐO TRÊN TRÌNH DUYỆT THẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Bản 3D từ lâu đặt cảnh vào **vùng còn dùng được** (`vungDungCanvas`); bản 2D thì khớp vào
 * **cả** khung, nên lớp phủ DOM che mất chính nội dung. Sau khi biểu tượng toà thành **đích
 * bấm** (lối (b), chủ dự án chốt 2026-09-20), khuyết tật ấy thành một khuyết tật **bấm**:
 *
 * | | điểm giữa bị che | bấm đúng | cạnh nhỏ nhất |
 * |---|---|---|---|
 * | trước | **8/14** | 2/3 mẫu | 86,2 px |
 * | khớp theo NỘI DUNG (chưa đủ) | **8/14** | 2/3 | 88,2 px |
 * | **đặt vào VÙNG DÙNG ĐƯỢC** | **2/14** | **3/3** | **38,4 px** |
 *
 * ⚠ Hàng giữa là phần đáng nhớ: khớp theo nội dung — bản vá vốn đã cứu nhánh máy — **không cứu
 *   được** ở đây, vì nội dung đã lấp gần trọn khung. Hai nguyên nhân khác nhau; vá đúng nguyên
 *   nhân thứ nhất không đụng gì tới nguyên nhân thứ hai.
 *
 * ★ Còn 2/14 có ĐIỂM GIỮA nằm dưới hai huy hiệu nhỏ (`do-tuoi-nen`, một icon) — chúng không khai
 *   `data-che-nhan` nên `layVungCam` không thấy. Kết cục người dùng vẫn nguyên: cả hai thuộc
 *   nhà máy 48, vốn còn biểu tượng khác bấm được ⇒ **5/5 nhà máy đều tới được**.
 */
import { describe, expect, it } from "vitest";

import { khungNhinBan2D } from "./khungNhinBan2D";

const ND = { xMin: 0, xMax: 100, zMin: 0, zMax: 50 };
const KHUNG = { rong: 1000, cao: 500 };
/** Panel trái 200 px, panel phải 100 px ⇒ dải dùng được 200…900. */
const VUNG = { trai: 200, phai: 900, tren: 0, duoi: 500 };

/** Chiếu một điểm thế giới ra px theo đúng cách `<svg viewBox>` + `meet` sẽ làm. */
function raPx(kn: { x: number; z: number; rong: number; sau: number }, khung: typeof KHUNG) {
  const k = Math.min(khung.rong / kn.rong, khung.cao / kn.sau);
  return (x: number, z: number) => ({ px: (x - kn.x) * k, py: (z - kn.z) * k });
}

describe("khungNhinBan2D", () => {
  it("★★★ KẾT CỤC ĐANG CHỮA: nội dung rơi ĐÚNG vào vùng dùng được, không vào cả khung", () => {
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    const chieu = raPx(kn, KHUNG);
    const tt = chieu(ND.xMin, ND.zMin);
    expect(tt.px).toBeCloseTo(VUNG.trai, 6);
    expect(tt.py).toBeCloseTo(VUNG.tren, 6);
  });

  it("★★★ KHÔNG bóp méo: tỉ lệ px/mét GIỐNG NHAU trên hai trục", () => {
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    const chieu = raPx(kn, KHUNG);
    const a = chieu(ND.xMin, ND.zMin);
    const b = chieu(ND.xMax, ND.zMax);
    const kNgang = (b.px - a.px) / (ND.xMax - ND.xMin);
    const kDoc = (b.py - a.py) / (ND.zMax - ND.zMin);
    expect(kNgang).toBeCloseTo(kDoc, 9);
  });

  it("★★★ nội dung LỌT TRỌN trong vùng (không tràn ra dưới panel)", () => {
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    const chieu = raPx(kn, KHUNG);
    const b = chieu(ND.xMax, ND.zMax);
    expect(b.px).toBeLessThanOrEqual(VUNG.phai + 1e-6);
    expect(b.py).toBeLessThanOrEqual(VUNG.duoi + 1e-6);
  });

  it("★★★ `viewBox` CÙNG TỈ LỆ với khung ⇒ `meet` không thêm lề của riêng nó", () => {
    // Nếu tỉ lệ lệch, `meet` tự căn giữa và mọi phép tính vị trí ở trên sai theo.
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    expect(kn.rong / kn.sau).toBeCloseTo(KHUNG.rong / KHUNG.cao, 9);
  });

  it("★★★ CA NGHỊCH — panel RỘNG hơn ⇒ nội dung phải NHỎ lại (không phải một hằng)", () => {
    const hep = khungNhinBan2D(ND, KHUNG, { trai: 400, phai: 900, tren: 0, duoi: 500 })!;
    const rong = khungNhinBan2D(ND, KHUNG, VUNG)!;
    // `viewBox` rộng hơn = mỗi mét chiếm ít px hơn = nội dung nhỏ hơn.
    expect(hep.rong).toBeGreaterThan(rong.rong);
  });

  it("★★★ KHÔNG có vùng dùng được ⇒ `null` (người gọi giữ đường cũ, KHÔNG bịa một vùng)", () => {
    expect(khungNhinBan2D(ND, KHUNG, null)).toBeNull();
    expect(khungNhinBan2D(ND, null, VUNG)).toBeNull();
    expect(khungNhinBan2D(null, KHUNG, VUNG)).toBeNull();
  });

  it("★★★ vùng/nội dung SUY BIẾN (bề 0) ⇒ `null`, không chia cho 0", () => {
    expect(khungNhinBan2D({ xMin: 5, xMax: 5, zMin: 0, zMax: 5 }, KHUNG, VUNG)).toBeNull();
    expect(khungNhinBan2D(ND, KHUNG, { trai: 200, phai: 200, tren: 0, duoi: 500 })).toBeNull();
    expect(khungNhinBan2D(ND, { rong: 0, cao: 500 }, VUNG)).toBeNull();
  });

  it("★★★ số RÁC ⇒ `null`, không để `NaN` chảy vào `viewBox`", () => {
    // Một `NaN` trong `viewBox` làm `<svg>` bỏ qua thuộc tính ⇒ cảnh nhảy về mặc định, câm.
    expect(khungNhinBan2D({ ...ND, xMax: Number.NaN }, KHUNG, VUNG)).toBeNull();
    expect(khungNhinBan2D(ND, KHUNG, { ...VUNG, phai: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("★ vùng = TRỌN khung ⇒ vẫn đúng: nội dung lấp trọn, gốc ở (xMin, zMin)", () => {
    const kn = khungNhinBan2D(ND, KHUNG, { trai: 0, phai: 1000, tren: 0, duoi: 500 })!;
    expect(kn.x).toBeCloseTo(ND.xMin, 9);
    expect(kn.z).toBeCloseTo(ND.zMin, 9);
  });
});
