/**
 * teachTreeLogic.ts — Khối C Task 10: logic THUẦN cho tab "Cây dạy" (`TeachTreeTab.tsx` +
 * `ComponentLimitsTable.tsx`). Tách khỏi component để test được KHÔNG CẦN DOM/DB (vitest chạy
 * `*.unit.test.ts` ở `environment: "node"` — không có jsdom, không `@testing-library/react`
 * trong repo này; xem `vitest.config.ts` — mọi `.unit.test.ts` của client đều test HÀM THUẦN
 * import từ module cạnh component, không "render + mock trpc". Cùng khuôn
 * `batchSuggestLogic.ts` / `batchSuggest.logic.unit.test.ts`).
 *
 * ── Nguồn dữ liệu: `appRouter.cayDay` (Task 9, `server/routers/cayDayRouter.ts`) ─────────────
 * Bốn kiểu dưới suy trực tiếp từ `RouterOutputs["cayDay"][...]` — KHÔNG khai lại tay, tránh lệch
 * hợp đồng nếu Task 9 đổi field (đúng bài học "client đọc sai thứ server gửi" đã đốt 4 lượt).
 *
 * ⚠⚠ BG-105 (bổ sung điều phối, review Task 9) — `coGioiHan` là phân loại theo CẤU HÌNH: một
 * point-def có ≥1/18 cột `POINT_LIMIT_SPEC` khác NULL (trừ `unit`), tính được TRƯỚC khi có bo
 * nào đo (`server/db/cayDay.ts: tinhGioiHan`). Nó KHÔNG cùng trục với `khongGioiHan` của
 * spec-gate (`server/services/pointResultEvaluator.ts`) — cái đó phân loại theo MỘT KẾT QUẢ ĐO
 * cụ thể (cần cả giới hạn lẫn trị đo khớp chiều, loại lệch đơn vị). Hai câu hỏi KHÁC NHAU:
 * "đã dạy giới hạn chưa" (bảng này) vs "bo cụ thể này có chấm được không" (spec-gate) — có thể
 * LỆCH trên cùng một bo. NHÃN của bảng này CHỈ được nói "đã dạy / chưa dạy", KHÔNG BAO GIỜ dùng
 * chữ ngụ ý cổng chấm được ("sẵn sàng chấm", "cổng hoạt động", "đã kiểm"…) — người sau đọc thấy
 * lệch với spec-gate ĐỪNG "sửa cho khớp", đó là hai trục đúng-cả-hai.
 *
 * ⚠⚠ CỘT HIỂN THỊ — đọc `shared/pointLimitSpec.ts`, KHÔNG khai lại tay (bổ sung điều phối, sau
 * re-review Task 7: `ProductModels.tsx`/`productModels/types.ts`/`PointDetailsForm.tsx` đang
 * chép tay 16/18 cột SONG SONG với spec — đúng lớp lỗi Task 7 dọn; module này KHÔNG được thêm
 * nguồn chép-tay thứ tư). Quyết định #2 của chủ dự án (2026-09-03, đo trên 3.252 điểm đo thật):
 * bảng CHỈ phơi trường ĐANG DÙNG — `TEN_COT_HIEN_THI` dưới đây là TIÊU CHÍ LỌC duy nhất (5 tên),
 * `COT_GIOI_HAN_HIEN_THI` suy ra bằng cách LỌC `POINT_LIMIT_SPEC` theo tiêu chí đó — field/nhóm/
 * i18nKey của mỗi cột vẫn đọc nguyên từ spec, không chép lại. 14 trường còn lại (area, volume,
 * coplanarity, warpage, voidPct, offsetX, offsetY, tilt, thickness — nhóm 3D/GD&T) CHƯA BAO GIỜ
 * có dữ liệu ⇒ không lọt qua tiêu chí, KHÔNG có cột. `nominalValue` mà brief Task 10 nhắc tới
 * KHÔNG có trong `POINT_LIMIT_SPEC` (18 cột spec-gate chấm bằng) — nó chỉ nằm trong
 * `APPROVAL_LIMIT_FIELDS` (hàng đợi duyệt ngưỡng, KHÔNG dùng cho spec-gate). Đo hợp đồng thật
 * (`traComponentTheoCapture`/`traThongKeGioiHan`, Task 9) TRƯỚC khi viết bảng ⇒ bảng này KHÔNG
 * có cột `nominalValue` — brief bị bác bỏ ở điểm này, khai trong `task-10-report.md`.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { POINT_LIMIT_SPEC, type MucGioiHan } from "@shared/pointLimitSpec";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type MayCoBanDay = RouterOutputs["cayDay"]["listMachinesForProduct"][number];
export type CayDayTree = RouterOutputs["cayDay"]["getTree"];
export type CayDaySurface = CayDayTree["surfaces"][number];
export type CayDayPosition = CayDaySurface["positions"][number];
export type CayDayCapture = CayDayPosition["captures"][number];
export type ComponentCayDay = RouterOutputs["cayDay"]["listComponents"][number];
export type ThongKeGioiHan = RouterOutputs["cayDay"]["thongKeGioiHan"];

/** Tiêu chí lọc DUY NHẤT — 5 tên cột giới hạn có dữ liệu thật (đo trên 3.252 điểm, xem đầu file). */
const TEN_COT_HIEN_THI = new Set(["lowerLimit", "upperLimit", "unit", "heightMin", "heightMax"]);

/** `POINT_LIMIT_SPEC` LỌC theo `TEN_COT_HIEN_THI`, giữ nguyên thứ tự/field/i18nKey của spec gốc. */
export const COT_GIOI_HAN_HIEN_THI: readonly MucGioiHan[] =
  POINT_LIMIT_SPEC.filter((m) => TEN_COT_HIEN_THI.has(m.field));

/** Một hàng hiển thị trong `ComponentLimitsTable`. `gioiHanHienThi` khoá theo `m.field` của `COT_GIOI_HAN_HIEN_THI`. */
export interface ComponentLimitsRow {
  readonly id: number;
  readonly componentExtId: string | null;
  readonly name: string;
  readonly roi: string;
  readonly coGioiHan: boolean;
  readonly gioiHanHienThi: Readonly<Record<string, string | null>>;
}

/** ROI dạng gọn `x,y (w×h)` — thiếu bất kỳ toạ độ nào ⇒ "—" (không bịa số một phần). */
export function formatRoi(c: Pick<ComponentCayDay, "roiX" | "roiY" | "roiWidth" | "roiHeight">): string {
  const { roiX, roiY, roiWidth, roiHeight } = c;
  if (roiX == null || roiY == null || roiWidth == null || roiHeight == null) return "—";
  return `${roiX},${roiY} (${roiWidth}×${roiHeight})`;
}

/**
 * Chiếu MỘT `ComponentCayDay` (Task 9) → một hàng bảng. `gioiHanHienThi` lấy đúng TẬP CON
 * `COT_GIOI_HAN_HIEN_THI` của `c.gioiHan` (Task 9 đã trả đủ 18 khoá) — lọc bằng VÒNG LẶP trên
 * spec đã lọc, không liệt kê tên cột tay lần thứ hai.
 */
export function mapComponentRow(c: ComponentCayDay): ComponentLimitsRow {
  const gioiHanHienThi: Record<string, string | null> = {};
  for (const cot of COT_GIOI_HAN_HIEN_THI) {
    gioiHanHienThi[cot.field] = c.gioiHan[cot.field] ?? null;
  }
  return {
    id: c.id,
    componentExtId: c.componentExtId,
    name: c.name,
    roi: formatRoi(c),
    coGioiHan: c.coGioiHan,
    gioiHanHienThi,
  };
}

/** Danh sách `listComponents` (MỘT capture) → danh sách hàng bảng, giữ nguyên số lượng/thứ tự. */
export function mapComponentRows(list: readonly ComponentCayDay[]): ComponentLimitsRow[] {
  return list.map(mapComponentRow);
}

/** Nhãn + tông màu badge trạng thái — chỉ nói "đã dạy / chưa dạy" (xem cảnh báo BG-105 đầu file). */
export interface TrangThaiGioiHan {
  readonly key: string;
  readonly defaultText: string;
  readonly variant: "secondary" | "destructive";
}
export function trangThaiGioiHan(coGioiHan: boolean): TrangThaiGioiHan {
  return coGioiHan
    ? { key: "teachTree.daDay", defaultText: "Đã dạy giới hạn", variant: "secondary" }
    : { key: "teachTree.chuaCoGioiHan", defaultText: "Chưa dạy", variant: "destructive" };
}

/**
 * Máy MẶC ĐỊNH được chọn khi danh sách `listMachinesForProduct` vừa nạp — máy ĐẦU TIÊN theo
 * thứ tự trả về, hoặc `null` khi rỗng (⇒ `TeachTreeTab` render empty-state, KHÔNG tự bịa máy).
 */
export function layMayMacDinh(danhSachMay: readonly MayCoBanDay[]): number | null {
  return danhSachMay.length > 0 ? danhSachMay[0].machineId : null;
}

/**
 * Chuỗi "tiến độ dạy" cho thanh đầu bảng — CHIẾU THẲNG `thongKeGioiHan` (Task 9, đếm TOÀN CÂY
 * của `(sản phẩm, máy)`), KHÔNG đếm lại từ `rows` của MỘT capture: `listComponents` chỉ trả
 * component của capture đang chọn (một phần cây) — đếm lại ở đây sẽ cho một con số SAI (nhỏ
 * hơn) so với `thongKeGioiHan`. Hai con số "đã dạy" (bảng vs thanh thống kê) khớp nhau BẰNG CẤU
 * TẠO chỉ khi thanh thống kê không tự tính gì — nó CHỈ hiển thị lại số Task 9 đã tính.
 */
export function formatThongKe(stats: ThongKeGioiHan): { daDay: number; tong: number } {
  return { daDay: stats.daDay, tong: stats.tongComponent };
}
