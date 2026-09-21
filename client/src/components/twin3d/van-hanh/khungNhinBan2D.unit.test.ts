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
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÍNH CHÍNH 2026-09-21 — CÂU CŨ Ở ĐÂY LÀ MỘT LỜI KHAI **SAI**
 * ════════════════════════════════════════════════════════════════════════════
 * Câu cũ: *"2/14 có điểm giữa nằm dưới hai huy hiệu nhỏ (`do-tuoi-nen`, một icon) — chúng
 * **không khai** `data-che-nhan` nên `layVungCam` không thấy."*
 *
 * Đo lại bằng `elementFromPoint` (`.qa-v2/v6-2d-che-tam.mjs`): kẻ chặn là
 * `cum-trang-thai-du-lieu`, và nó **CÓ** `data-che-nhan=1`. Cả **7/7** lớp phủ đều khai đủ.
 * Cơ chế `layVungCam` chạy đúng; thứ bỏ sót nó nằm ở `vungDungCanvas`, vốn **chỉ trừ lớp phủ
 * cắt SUỐT một chiều** — một giới hạn **CỐ Ý** đã ghi trong docblock của chính nó.
 *
 * ⇒ Tôi đã đổ lỗi cho một thuộc tính bị quên trong khi gốc là một **luật hình học**. Bài học
 *   cùng lớp với "kết luận từ TÊN biến đếm": đọc tên cơ chế rồi đoán, thay vì hỏi DOM.
 *
 * ★ Mức độ đo được (lưới 2 px trong lòng từng biểu tượng, `.qa-v2/v6-2d-do-che.mjs`):
 *   toà 93 còn **21 %** diện tích (ô trống lớn nhất **6×6 px**) · toà 94 **34 %** (**8×8 px**) ·
 *   toà 97 **69 %** (**30×30 px**, vẫn đạt) · 11 cái còn lại **100 %**.
 *   Bấm tại điểm trống vẫn điều hướng đúng **3/3**, nên **đường đi không mất** — nhưng 2/14
 *   phá đúng ràng buộc **≥24×24 px** mà chủ dự án đã nhận khi chọn lối (b).
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
    /*
     * ⚠ Ca này TRƯỚC ĐÂY ghim `tt.px === VUNG.trai && tt.py === VUNG.tren` — tức ghim **góc
     *   neo**, một CƠ CHẾ. Quyết định mà nó sinh ra để bảo vệ là *"nội dung phải nằm trong
     *   vùng dùng được, không trong cả khung"*, và quyết định ấy **không đổi**. Góc neo thì
     *   đổi (xem docblock `khungNhinBan2D.ts`), nên ca được nâng lên ghim TÍNH CHẤT.
     */
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    const chieu = raPx(kn, KHUNG);
    const tt = chieu(ND.xMin, ND.zMin);
    const dd = chieu(ND.xMax, ND.zMax);
    expect(tt.px).toBeGreaterThanOrEqual(VUNG.trai - 1e-6);
    expect(tt.py).toBeGreaterThanOrEqual(VUNG.tren - 1e-6);
    expect(dd.px).toBeLessThanOrEqual(VUNG.phai + 1e-6);
    expect(dd.py).toBeLessThanOrEqual(VUNG.duoi + 1e-6);
    // Và phải THẬT SỰ lấp vùng theo ít nhất một chiều — nếu không thì "nằm trong vùng" đúng
    // một cách vô nghĩa (một chấm ở giữa cũng nằm trong vùng).
    const lapNgang = (dd.px - tt.px) / (VUNG.phai - VUNG.trai);
    const lapDoc = (dd.py - tt.py) / (VUNG.duoi - VUNG.tren);
    expect(Math.max(lapNgang, lapDoc)).toBeGreaterThan(0.95);
  });

  it("★★★ NEO ĐÁY — cùng luật với bản 3D, vì mọi thẻ nổi của màn này ở NỬA TRÊN", () => {
    /*
     * Đây là bản vá: neo góc TRÊN ném nội dung vào đúng dải `bang-kpi-noi` /
     * `cum-trang-thai-du-lieu` đang chiếm (đo: 2/14 biểu tượng còn 6×6 và 8×8 px bấm được).
     */
    const kn = khungNhinBan2D(ND, KHUNG, VUNG)!;
    const day = raPx(kn, KHUNG)(ND.xMax, ND.zMax);
    expect(day.py).toBeCloseTo(VUNG.duoi, 6);
  });

  it("★★★ CĂN GIỮA theo chiều NGANG khi còn chỗ trống", () => {
    // Vùng CAO và HẸP ⇒ chiều cao mới là chiều chặn, nên còn dư bề ngang để mà căn.
    const vungCao = { trai: 200, phai: 900, tren: 0, duoi: 200 };
    const kn = khungNhinBan2D(ND, KHUNG, vungCao)!;
    const chieu = raPx(kn, KHUNG);
    const t = chieu(ND.xMin, ND.zMin);
    const p = chieu(ND.xMax, ND.zMax);
    const duTrai = t.px - vungCao.trai;
    const duPhai = vungCao.phai - p.px;
    expect(duTrai).toBeGreaterThan(1); // thật sự có chỗ trống, không phải ca suy biến
    expect(duTrai).toBeCloseTo(duPhai, 6);
  });

  it("★★★ `leDayPx` CHỪA ĐÚNG chỗ cho nhãn treo dưới biểu tượng", () => {
    const LE = 28;
    const kn = khungNhinBan2D(ND, KHUNG, VUNG, { leDayPx: LE })!;
    const day = raPx(kn, KHUNG)(ND.xMax, ND.zMax);
    expect(day.py).toBeCloseTo(VUNG.duoi - LE, 6);
  });

  it("★★★ `leDayPx` RÁC/khổng lồ KHÔNG làm trắng cảnh — kẹp ở nửa bề cao", () => {
    // Trả `null` ở đây là đổi một phiền toái (nhãn bị cắt) lấy một sự cố (cảnh biến mất).
    for (const le of [Number.NaN, Number.POSITIVE_INFINITY, -50, 10_000]) {
      const kn = khungNhinBan2D(ND, KHUNG, VUNG, { leDayPx: le });
      expect(kn).not.toBeNull();
      const day = raPx(kn!, KHUNG)(ND.xMax, ND.zMax);
      expect(day.py).toBeLessThanOrEqual(VUNG.duoi + 1e-6);
      expect(day.py).toBeGreaterThan(VUNG.tren);
    }
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
    /*
     * ★ Ca này KHÔNG đổi sau bản vá neo đáy, và đó là một tính chất chứ không phải may mắn:
     *   nội dung 100×50 trên vùng 1000×500 cùng tỉ lệ 2:1 ⇒ lấp trọn cả hai chiều ⇒ không còn
     *   chỗ trống nào để mà neo. Chỗ neo chỉ đổi kết quả khi CÓ dư.
     */
    const kn = khungNhinBan2D(ND, KHUNG, { trai: 0, phai: 1000, tren: 0, duoi: 500 })!;
    expect(kn.x).toBeCloseTo(ND.xMin, 9);
    expect(kn.z).toBeCloseTo(ND.zMin, 9);
  });
});
