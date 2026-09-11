/**
 * ★★★ ĐỢT 45 (mục 2 · mục 9) — BỐ CỤC THANH CÔNG CỤ `/twin`: HAI QUYẾT ĐỊNH THUẦN, ĐO ĐƯỢC.
 *
 * QA Đợt 44 (D-7 mục 4 · 15): @1280 header 968 px chứa breadcrumb + 3 ô chọn + 5 huy hiệu tin cậy
 * + 6 nút ⇒ tràn phải ("Xưở"), breadcrumb bị bóp còn "T… › Nhà… › T" ở CẢ 1600 lẫn 1280 (ba mắt xích
 * `max-w-[9rem] truncate`, nav `min-w-0` nhường hết cho hai cụm `shrink-0`).
 *
 * Thiết kế (kế hoạch Đợt 45): mỗi cụm một nhà —
 *   • tin cậy dữ liệu (5 huy hiệu) RỜI header, thành viên nổi góc trên-phải CẢNH (`cum-trang-thai-du-lieu`,
 *     cùng chỗ "Mô phỏng" ở Line / thanh công cụ ở studio) — DOM/testid/data-* giữ nguyên;
 *   • header còn: điều hướng (breadcrumb + ô chọn) | cách nhìn (6 nút). Dưới `NGUONG_GON_PX`
 *     hai nút có chữ (Xuất USD · Xưởng dựng) thành icon-only (chữ vào `title` + `sr-only`) — vẫn là
 *     NÚT trong DOM, bấm được, không menu "⋯" giấu hành động;
 *   • breadcrumb: ≤ 3 mắt xích và không gọn ⇒ hiện hết; ngược lại gập các cấp trên vào "…" (menu
 *     bấm được), giữ cấp cha + cấp hiện tại ĐỦ CHỮ (không cắt giữa từ; `title` đủ).
 *
 * Thuần .ts (không React) để lưới đơn vị chấm được ngưỡng và phép gập.
 */
import type { MatXich } from "./phamViCanh";

/** Header hẹp hơn ngưỡng này (px, đo `ResizeObserver` — không phải viewport) ⇒ chế độ GỌN. */
export const NGUONG_GON_PX = 1100;

/** Số mắt xích tối đa hiện ĐẦY ĐỦ khi không gọn; hơn ⇒ gập các cấp trên. */
export const SO_MAT_XICH_HIEN_DU = 3;

/** Header gọn? `null`/0 (chưa đo) ⇒ KHÔNG gọn (mồi cho khung hình đầu — chữ đầy đủ là mặc định an toàn). */
export function laGon(rongHeaderPx: number | null | undefined): boolean {
  return typeof rongHeaderPx === "number" && rongHeaderPx > 0 && rongHeaderPx < NGUONG_GON_PX;
}

export interface BreadcrumbGop {
  /** Các cấp bị gập vào "…" (theo thứ tự trên → dưới); rỗng ⇒ không có nút "…". */
  anCap: MatXich[];
  /** Các mắt xích hiện đầy đủ; luôn chứa cấp hiện tại (phần tử cuối). */
  hien: MatXich[];
}

/**
 * Gập breadcrumb. Luôn giữ ít nhất cấp cha + cấp hiện tại (2 mắt xích) khi có ≥ 2;
 * ≤ `SO_MAT_XICH_HIEN_DU` mắt xích và không gọn ⇒ hiện hết.
 */
export function gopBreadcrumb(crumbs: readonly MatXich[], gon: boolean): BreadcrumbGop {
  if (crumbs.length <= 2 || (!gon && crumbs.length <= SO_MAT_XICH_HIEN_DU)) {
    return { anCap: [], hien: [...crumbs] };
  }
  return { anCap: crumbs.slice(0, -2), hien: crumbs.slice(-2) };
}
