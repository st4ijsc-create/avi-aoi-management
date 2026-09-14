// @vitest-environment jsdom
//
/**
 * `theoDoiDoiCho.dom.test.tsx` — ★★★ ĐỢT 59 (mục A): LỚP PHỦ **DỜI CHỖ** PHẢI MUA ĐƯỢC MỘT KHUNG.
 *
 * Bệnh (QA lần 10 §14q.37, Đợt 59 đo lại 210 px² vi / 355 px² en @1600, ở lì ≥ 17 s): THU rồi MỞ LẠI
 * panel trái ⇒ nhãn 3D nằm dưới tay nắm. `ResizeObserver` của `TheoDoiLopPhu` MÙ vì tay nắm chỉ đổi
 * `left` (`transition-[left] duration-200`) — kích thước không đổi một pixel nào.
 *
 * Tệp này đo **cơ chế**, không đo văn bản: dựng DOM thật (jsdom), bắn `transitionend` đúng như trình
 * duyệt bắn, rồi hỏi "có `invalidate()` không". Ba nhóm ca, trong đó nhóm ③ là **đối chứng dương**:
 * nếu bộ lọc thuộc tính hỏng theo hướng "cho qua tất", ca ③ ĐỎ và bất biến *idle 0 khung/40 s* được
 * bảo vệ bằng lưới chứ không bằng lời hứa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { THUOC_TINH_HINH_HOC, taoBoNgheDoiCho } from "./theoDoiDoiCho";
import { THUOC_TINH_CHE_NHAN } from "./LopNhan";

/** Bắn `transitionend` NHƯ TRÌNH DUYỆT: nổi bọt, mang `propertyName`. */
function banChuyenTiep(muc: Element, propertyName: string, loai = "transitionend") {
  const e = new Event(loai, { bubbles: true, composed: true }) as Event & { propertyName?: string };
  Object.defineProperty(e, "propertyName", { value: propertyName, configurable: true });
  muc.dispatchEvent(e);
}

function dungCay() {
  document.body.innerHTML = `
    <div data-testid="khung">
      <button data-testid="nut-thu-trai" ${THUOC_TINH_CHE_NHAN}="1"><span data-testid="mui-ten">›</span></button>
      <aside data-testid="panel-trai" ${THUOC_TINH_CHE_NHAN}="1"><b data-testid="chu-trong-panel">42</b></aside>
      <div data-testid="khong-khai"><i data-testid="chu-ngoai">x</i></div>
    </div>`;
  const q = (t: string) => document.querySelector(`[data-testid="${t}"]`)!;
  return { q };
}

describe("★★★ ① Lớp phủ tự khai DỜI CHỖ xong ⇒ `invalidate()`", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("tay nắm đổi `left` (đúng ca bệnh của QA lần 10) ⇒ gọi `invalidate` MỘT lần", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
    banChuyenTiep(q("nut-thu-trai"), "left");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("panel đổi `width` ⇒ gọi (RO đã lo ca này, nhưng hai cảm biến không được mâu thuẫn)", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
    banChuyenTiep(q("panel-trai"), "width");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("chuyển tiếp chạy trên phần tử CON của lớp phủ vẫn tính (nghe ở document, `closest`)", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
    banChuyenTiep(q("mui-ten"), "transform");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("`transitioncancel` (người dùng bấm lại giữa chừng) cũng phải tính — nếu không, khung cuối là khung SAI", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    const nghe = taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN);
    document.addEventListener("transitioncancel", nghe, true);
    banChuyenTiep(q("nut-thu-trai"), "left", "transitioncancel");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("★★ ② Ngoài lớp phủ tự khai ⇒ KHÔNG mua được khung", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("phần tử không có `data-che-nhan` (và không nằm trong lớp phủ nào) ⇒ 0 lần", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
    banChuyenTiep(q("chu-ngoai"), "left");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("sự kiện không mang `propertyName` (Event trần) ⇒ 0 lần, không ném", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    const nghe = taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN);
    document.addEventListener("transitionend", nghe, true);
    q("nut-thu-trai").dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("★★★ ③ ĐỐI CHỨNG DƯƠNG — bộ lọc HÌNH HỌC bảo vệ 'idle 0 khung/40 s'", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  /* `transition-colors` có trên gần như MỌI nút trong panel. Nếu ngày nào đó ai đó bỏ bộ lọc
     `propertyName`, bốn ca này ĐỎ — và đó là lời cảnh báo trước khi idle 0 khung/40 s chết. */
  it.each(["color", "background-color", "opacity", "box-shadow", "border-color", "fill"])(
    "`%s` đổi trên chính tay nắm ⇒ KHÔNG gọi `invalidate` (màu không dời vùng cấm một pixel nào)",
    (thuocTinh) => {
      const { q } = dungCay();
      const invalidate = vi.fn();
      document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
      banChuyenTiep(q("nut-thu-trai"), thuocTinh);
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it("danh sách là ALLOWLIST: thuộc tính lạ mặc định KHÔNG mua được khung", () => {
    const { q } = dungCay();
    const invalidate = vi.fn();
    document.addEventListener("transitionend", taoBoNgheDoiCho(invalidate, THUOC_TINH_CHE_NHAN), true);
    banChuyenTiep(q("nut-thu-trai"), "--mot-thuoc-tinh-chua-ton-tai");
    expect(invalidate).not.toHaveBeenCalled();
    expect(THUOC_TINH_HINH_HOC.has("color")).toBe(false);
    expect(THUOC_TINH_HINH_HOC.has("opacity")).toBe(false);
    // Hai trị mà tay nắm trái/phải THẬT dùng (`transition-[left]` / `transition-[right]`).
    expect(THUOC_TINH_HINH_HOC.has("left")).toBe(true);
    expect(THUOC_TINH_HINH_HOC.has("right")).toBe(true);
  });
});
