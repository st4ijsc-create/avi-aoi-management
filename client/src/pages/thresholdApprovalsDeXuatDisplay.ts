/**
 * client/src/pages/thresholdApprovalsDeXuatDisplay.ts
 *
 * Lô 7 Mục 4 (BG-111) — màn duyệt (`ThresholdApprovalsPage.tsx`) hiển thị ĐỦ BỘ
 * `suggestion.deXuat` (Lô 7 Mục 2 — `thresholdApproval.request` mở rộng), không
 * chỉ LSL/USL/nominal như trước. Tách THUẦN khỏi component (cùng khuôn
 * `thresholdApprovalsBatch.ts` — file này không render, test được ở
 * `environment: "node"`, 0 `@testing-library/react`).
 *
 * ⚠ Hàng CŨ (`status='requested'` tồn kho TRƯỚC Lô 7 — 176 dev + 30 test đo
 * được, xem lo-7-report.md) mang `suggestion` là blob metadata AI (KHÔNG có
 * khoá `deXuat`) — `xayDeXuatHienThi` trả MẢNG RỖNG cho hàng này (không bịa
 * field), và trang TIẾP TỤC hiển thị khối "current vs proposed" (LSL/USL/
 * nominal) NGUYÊN VĂN như trước Lô 7 — khối đó KHÔNG đọc file này, xem
 * `ThresholdApprovalsPage.tsx`. File này chỉ thêm một khối HIỂN THỊ MỚI
 * (render CÓ ĐIỀU KIỆN — chỉ khi mảng khác rỗng), không thay thế khối cũ.
 */
import { POINT_LIMIT_SPEC, type PointLimitField } from "@shared/pointLimitSpec";

const NHAN_THEO_FIELD = new Map<string, string>(POINT_LIMIT_SPEC.map((m) => [m.field, m.i18nKey]));
/** Thứ tự hiển thị ỔN ĐỊNH = thứ tự khai trong POINT_LIMIT_SPEC (không phụ thuộc thứ tự khoá JSON). */
const THU_TU_FIELD: readonly string[] = POINT_LIMIT_SPEC.map((m) => m.field);

export interface DeXuatHienThi {
  readonly field: string;
  readonly i18nKey: string;
  /** `null` = đề xuất XOÁ giới hạn này (đúng ngữ nghĩa BG-123/Lô 7 Mục 2). */
  readonly giaTri: string | null;
  readonly laXoa: boolean;
}

/**
 * Đọc `suggestion.deXuat` của một hàng `threshold_approvals` và trả về danh
 * sách hiển thị theo ĐÚNG thứ tự `POINT_LIMIT_SPEC` — chỉ field CÓ MẶT trong
 * `deXuat` mới xuất hiện (khoá vắng mặt = hàng này không đề xuất field đó).
 * Hàng CŨ (không có `deXuat` hợp lệ, hoặc `deXuat` không phải object) ⇒ `[]`.
 */
export function xayDeXuatHienThi(suggestion: unknown): DeXuatHienThi[] {
  if (!suggestion || typeof suggestion !== "object") return [];
  const deXuat = (suggestion as Record<string, unknown>).deXuat;
  if (!deXuat || typeof deXuat !== "object" || Array.isArray(deXuat)) return [];

  const obj = deXuat as Record<string, unknown>;
  const ra: DeXuatHienThi[] = [];
  for (const field of THU_TU_FIELD) {
    if (!(field in obj)) continue; // field này hàng KHÔNG đề xuất — bỏ qua.
    const v = obj[field];
    const giaTri = v === null ? null : v === undefined ? null : String(v);
    ra.push({
      field,
      i18nKey: NHAN_THEO_FIELD.get(field) ?? field,
      giaTri,
      laXoa: v === null,
    });
  }
  return ra;
}

/** `true` khi hàng này mang một `suggestion.deXuat` đủ bộ (Lô 7) — dùng để quyết định có render khối mới hay không. */
export function coDeXuatDayDu(suggestion: unknown): boolean {
  return xayDeXuatHienThi(suggestion).length > 0;
}

export type { PointLimitField };
