/**
 * `theoDoiDoiCho.ts` — ★★★ ĐỢT 59 (mục A): **LỚP PHỦ DỜI CHỖ MÀ KHÔNG ĐỔI CỠ.**
 *
 * ── Vì sao tệp này tồn tại ──────────────────────────────────────────────────────
 * `KhungCanh.TheoDoiLopPhu` (Đợt 47 N1) đặt một `ResizeObserver` lên MỌI
 * `[data-che-nhan]` để `invalidate()` khi hình dạng vùng cấm đổi — vì `LopNhan`/`LopCanhBao`
 * đọc vùng cấm TRONG `useFrame`, mà `frameloop="demand"` chỉ vẽ khi có ai đó gọi `invalidate()`.
 *
 * QA lần 10 (§14q.37) đo được một trạng thái mà cơ chế ấy MÙ: ở 1600×900, **THU rồi MỞ LẠI**
 * panel trái ⇒ 2 nhãn 3D nằm dưới tay nắm và **ở lì ≥ 17 s** (Đợt 59 đo lại: 210 px² vi / 355 px²
 * en @1600, 5 px² @1280-en), chỉ một lần đổi cỡ cửa sổ mới dọn.
 *
 * ⚠ Brief Đợt 59 đoán *"tay nắm/panel không nằm trong tập quan sát"* — **SAI**: `nut-thu-trai`
 *   CÓ `data-che-nhan`, `quet()` đã `ro.observe` nó từ khung đầu tiên. Lỗ ở chỗ khác:
 *   tay nắm đổi `left` (`left-0` ↔ `left-56 2xl:left-72`) qua `transition-[left] duration-200`,
 *   **kích thước không đổi một pixel nào**, và `ResizeObserver` theo đặc tả chỉ báo khi hộp CỠ
 *   đổi, KHÔNG báo khi phần tử DỜI CHỖ. Chuỗi sự kiện thật khi MỞ LẠI panel:
 *     t=0   panel `w-0 → w-72` ⇒ RO kêu ⇒ khung được vẽ **trong khi tay nắm còn ở `left≈0`**
 *           ⇒ `locNhan` chỉ tránh dải x∈[0,21] rồi thả nhãn vào đúng chỗ tay nắm SẮP tới.
 *     t=200 tay nắm tới `left=288`. **Không ai kêu** ⇒ không khung nào nữa ⇒ nhãn ở lì.
 *
 * ── Vá ──────────────────────────────────────────────────────────────────────────
 * Cùng MỘT cơ chế, thêm đúng cái cảm biến còn thiếu: `ResizeObserver` lo "đổi CỠ",
 * `transitionend`/`transitioncancel` lo "đổi CHỖ". Cả hai đổ về một `invalidate()`.
 *
 * ★ Lọc theo `propertyName` thuộc nhóm HÌNH HỌC. `transition-colors` có trên gần như MỌI nút
 *   trong panel; cho màu/mờ/đổ bóng mua một khung là đánh đổi bất biến *"idle 0 khung/40 s"*
 *   (Đợt 40 T4) lấy một thứ không dời vùng cấm một pixel nào. Danh sách vì thế là DANH SÁCH CHO
 *   PHÉP (allowlist), không phải danh sách cấm — thuộc tính lạ mặc định KHÔNG mua được khung.
 * ★ Nghe ở `document` (pha bắt) rồi `closest([data-che-nhan])`: chuyển tiếp có thể chạy trên
 *   phần tử CON của lớp phủ, mà vùng cấm là bbox của phần tử TỰ KHAI.
 */

/** Thuộc tính CSS mà khi chuyển tiếp xong thì **bbox của lớp phủ đã khác** ⇒ vùng cấm phải tính lại. */
export const THUOC_TINH_HINH_HOC: ReadonlySet<string> = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "width",
  "height",
  "inset",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block-start",
  "inset-block-end",
  "transform",
  "translate",
  "scale",
  "rotate",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "font-size",
]);

/**
 * Bộ nghe `transitionend`/`transitioncancel` cho MỘT canvas: gọi `invalidate()` khi và chỉ khi
 * một lớp phủ tự khai `[${thuocTinhCheNhan}]` vừa DỜI CHỖ/ĐỔI HÌNH xong.
 *
 * Tách khỏi `KhungCanh.tsx` để đo được bằng lưới: hàm thuần trên một `Event`, không cần Canvas.
 */
export function taoBoNgheDoiCho(invalidate: () => void, thuocTinhCheNhan: string) {
  return (e: Event) => {
    const propertyName = (e as TransitionEvent).propertyName;
    if (typeof propertyName !== "string" || !THUOC_TINH_HINH_HOC.has(propertyName)) return;
    const muc = e.target;
    if (!(muc instanceof Element)) return;
    if (!muc.closest(`[${thuocTinhCheNhan}]`)) return;
    invalidate();
  };
}
