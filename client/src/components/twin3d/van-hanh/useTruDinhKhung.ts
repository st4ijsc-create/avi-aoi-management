/**
 * useTruDinhKhung.ts — ĐO đỉnh khung rồi trừ khỏi `100vh`, qua một biến CSS **RIÊNG** của khung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO ĐO, KHÔNG ĐOÁN — G23/G41, trả giá ba lần
 * ════════════════════════════════════════════════════════════════════════════
 *   · Đợt 30 màn Line: `h-full` kế thừa chiều cao cha **không trừ vỏ ứng dụng**
 *     ⇒ 12 ô trạm nằm ở **y=904 > 900** trong khi mọi `toBeVisible()` XANH.
 *   · Đợt 32 (QA) `/twin-studio`: `h-[calc(100vh-5rem)]` giả định vỏ cao 80 px;
 *     đỉnh thật của khung là **133 px** (breadcrumb + tiêu đề + chọn nhà máy)
 *     ⇒ đáy **953 > 900** ở 1600×900 và **773 > 720** ở 1280×720 — thư viện
 *     asset và bảng thuộc tính bị cắt dưới mép, không lỗi nào nổ.
 *   · `TwinVanHanh.tsx` ghi nguyên văn: *"Đừng thay `5rem` bằng một hằng số
 *     đoán khác — lần sau chrome đổi là sai lại, và không có lỗi nào nổ."*
 *
 * ⇒ Hook này ĐO `getBoundingClientRect().top` của chính khung và ghi
 *   `--<tên>: <top>px` lên phần tử; khung đặt `height: calc(100vh - var(--<tên>,
 *   5rem))`. `5rem` chỉ là MỒI cho khung hình đầu tiên trước khi effect chạy.
 *
 * ★ MỖI MÀN MỘT TÊN BIẾN (`--twin-line-top`, `--twin-may-top`,
 *   `--twin-studio-top`): các màn là các route, không bao giờ sống cùng lúc
 *   (QĐ-19), nhưng dùng chung một biến CSS toàn cục sẽ để lại giá trị của màn
 *   TRƯỚC cho màn SAU đọc — một khớp nối ẩn giữa hai thứ đáng lẽ độc lập.
 *   Vì biến ghi lên **chính phần tử** (không lên `:root`), tên riêng còn là
 *   một lớp bảo hiểm thứ hai: không có chỗ nào để đọc nhầm.
 *
 * ★ G12 — Đợt 35 gom ba bản chép tay (Line/Máy/Studio) về MỘT hook. `TwinVanHanh`
 *   giữ bản riêng vì nó còn cộng `demDuoi` (dải dưới) — một hợp đồng khác.
 *
 * ⚠ Đo lại khi vỏ đổi chiều cao (thu/mở sidebar, đổi cỡ cửa sổ): `ResizeObserver`
 *   trên `document.body` + `resize`. Không có cái này thì lần đầu đúng, lần sau
 *   thu sidebar là sai lại — cùng lớp lỗi "đúng một lần".
 */
import { useEffect, type RefObject } from "react";

/** Tên biến CSS tuỳ chỉnh — phải bắt đầu bằng `--`. */
export type TenBienCss = `--${string}`;

/**
 * Ghi `tenBien = <đỉnh khung>px` lên phần tử `ref` và cập nhật khi vỏ đổi.
 * Giá trị luôn `≥ 0` và làm tròn về số nguyên px (calc với số lẻ làm canvas lệch nửa px).
 */
export function useTruDinhKhung(ref: RefObject<HTMLElement | null>, tenBien: TenBienCss): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doLai = () => {
      const tren = el.getBoundingClientRect().top;
      el.style.setProperty(tenBien, `${Math.max(0, Math.round(tren))}px`);
    };
    doLai();
    const ro = new ResizeObserver(doLai);
    ro.observe(document.body);
    window.addEventListener("resize", doLai);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", doLai);
    };
  }, [ref, tenBien]);
}

/** Chuỗi `height` đi kèm — một chỗ viết, ba màn dùng; `5rem` là mồi trước effect. */
export function chieuCaoTruDinh(tenBien: TenBienCss): string {
  return `calc(100vh - var(${tenBien}, 5rem))`;
}
