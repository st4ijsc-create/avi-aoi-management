/**
 * roleLanding — map an authenticated user's role to the right "front door".
 *
 * doc 67 W5 (việc 3, quyết định #1a) — 0-click tới đúng cửa của vai sau login
 * (Login.tsx resolveDestination vẫn ưu tiên ?next=/deep-link; Home "/" cũng dùng
 * map này qua resolveRoleLanding, admin có thể override per-role trong
 * role_dashboard_defaults):
 *   - operator            → /ops-console        ("Xử lý cảnh báo" — cửa cảnh báo tại line)
 *   - supervisor/manager  → /control-tower       ("Tổng quan nhà máy", tab Quản đốc)
 *   - admin/it_admin/executive → /control-tower  (tab Điều hành)
 *   - viewer/user         → /control-tower       (đọc-only, tab Điều hành)
 *   - maintenance         → /maintenance-home    (giữ — workspace bảo trì, F1 doc 23)
 *   - engineer            → /engineering-home    (giữ — hub kỹ thuật)
 *   - quality_inspector   → /quality-home        (giữ — workspace chất lượng)
 *   - other/unknown       → /                    (Home)
 * (Không có role "kiosk" trong hệ — kiosk là chế độ URL ?kiosk=1 trên /andon.)
 *
 * Intentionally minimal + safe: an unknown/undefined role falls through to "/".
 * Routes are NOT permission-checked here — each page enforces its own access;
 * this only picks a sensible default destination. (Đã kiểm chứng seed
 * DEFAULT_ROLE_PERMISSIONS: operator có `andon` canView → /ops-console mở;
 * supervisor/viewer/user có `machine_status` canView → /control-tower mở.)
 */

export const FLOOR_ROLES = ["operator", "maintenance"] as const;

export function landingPathForRole(role?: string | null): string {
  switch (role) {
    case "operator":
      return "/ops-console";
    case "maintenance":
      return "/maintenance-home";
    case "engineer":
      return "/engineering-home";
    case "quality_inspector":
      return "/quality-home";
    case "supervisor":
    case "manager":
    case "admin":
    case "it_admin":
    case "executive":
    case "viewer":
    case "user":
      return "/control-tower";
    default:
      return "/";
  }
}

/** True when the role is a shop-floor role that should be nudged off Home. */
export function isFloorRole(role?: string | null): boolean {
  return role === "operator" || role === "maintenance";
}
