/**
 * Lô 4 Mục 2 (BG-74, client) — trình bày trạng thái gói AOI, TÁCH RIÊNG khỏi
 * `AOIPackages.tsx` thành logic THUẦN (không JSX, không hook) để test được mà
 * không cần hạ tầng render-test (repo không có — BG-129).
 *
 * ★★★ 'dead' (migration 0344, `packagestatusenum` — xem `laGoiDaChet` ở
 * `server/routers/aoiPackageRouter.ts`) là trạng thái CUỐI — TỆ HƠN `failed`
 * (một gói `failed` còn retry được; một gói `dead` thì KHÔNG, cần packageId MỚI).
 * Badge của nó phải NỔI HƠN `failed`, không phải xám nhạt hơn (đúng lỗi BG-74 khai:
 * badge cũ rơi vào fallback `bg-muted text-muted-foreground` vì thiếu khoá `dead`).
 */

export interface PackageStatusBadgeVariant {
  labelKey: string;
  className: string;
}

/**
 * `failed` giữ NGUYÊN className cũ (mờ `/15`) — bản vá này CHỈ THÊM khoá `dead`,
 * không đổi hành vi hiển thị của các trạng thái khác (đúng ràng buộc "chỉ thêm
 * đường đọc/hiển thị"). `dead` dùng nền ĐẶC `bg-destructive` (không mờ) + chữ
 * trắng `text-destructive-foreground` — cùng họ token `destructive` nhưng đậm
 * hơn hẳn `failed`, đúng ngữ nghĩa "CUỐI, tệ nhất" thay vì một biến thể phụ của
 * failed.
 */
export const PACKAGE_STATUS_BADGE_VARIANTS: Record<string, PackageStatusBadgeVariant> = {
  pending: { labelKey: "packages.pending", className: "bg-warning/15 text-warning border-warning/30" },
  uploading: { labelKey: "packages.uploading", className: "bg-info/15 text-info border-info/30" },
  uploaded: { labelKey: "packages.uploaded", className: "bg-info/15 text-info border-info/30" },
  committed: { labelKey: "packages.committed", className: "bg-success/15 text-success border-success/30" },
  failed: { labelKey: "common.error", className: "bg-destructive/15 text-destructive border-destructive/30" },
  dead: { labelKey: "packages.dead", className: "bg-destructive text-destructive-foreground border-destructive font-semibold" },
};

export interface PackageStatusFilterOption {
  value: string;
  labelKey: string;
}

/**
 * Bộ lọc UI trang gói AOI — nối `listPackages` (Mục 1, enum input đã mở rộng đủ
 * 6 giá trị). `all` không phải một status thật, KHÔNG đưa vào đây — `AOIPackages.tsx`
 * tự thêm tuỳ chọn "Tất cả" ở đầu danh sách hiển thị (i18n `common.all`, đã có sẵn).
 */
export const PACKAGE_STATUS_FILTER_OPTIONS: PackageStatusFilterOption[] = [
  { value: "committed", labelKey: "packages.committed" },
  { value: "uploaded", labelKey: "packages.uploaded" },
  { value: "pending", labelKey: "packages.pending" },
  { value: "failed", labelKey: "common.error" },
  { value: "dead", labelKey: "packages.dead" },
];
