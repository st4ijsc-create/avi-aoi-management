/**
 * RouteGuard — route-level access control for SENSITIVE pages (doc 07 §④ P2).
 *
 * App.tsx renders page components directly, so deep-linking to an admin/OT page
 * could previously bypass the nav-level filtering in DashboardLayout. This wrapper
 * closes that gap: it re-uses the EXACT same gating the navigation uses
 * (`hasAccessToItem` + the `usePermissions` checker) so it never over-restricts a
 * legitimate user — admins always pass (admin bypass lives in both helpers).
 *
 * Usage (additive — wrap the existing <Route> child in App.tsx):
 *   <Route path="/users"><RouteGuard requireRole={["admin"]} requirePermission="admin_users"><Users /></RouteGuard></Route>
 *
 * Gating precedence:
 *   1. While auth/permissions are loading → render a spinner (never flash "denied").
 *   2. Admin role → always allowed.
 *   3. If `navHref` is given → defer to hasAccessToItem(navHref, …) so the guard and
 *      the sidebar agree exactly for that route.
 *   4. Else apply the explicit `requireRole` / `requirePermission` props.
 *   5. Denied → a friendly "Không có quyền truy cập" card with a button back to the
 *      user's role landing (never a hard redirect that loses context).
 */
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Loader2, ShieldAlert, Lock } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { hasAccessToItem } from "@/lib/navigation";
import { landingPathForRole } from "@/lib/roleLanding";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { isLicenseEnforcementEnabled } from "@/lib/appLauncherFlag";
import { Button } from "@/components/ui/button";

export interface RouteGuardProps {
  children: ReactNode;
  /** Roles allowed (in addition to admin, who always passes). */
  requireRole?: string[];
  /** Module permission required (checked via canView, same as the nav). */
  requirePermission?: string;
  /**
   * Optional nav href. When provided, the guard defers to the navigation helper
   * `hasAccessToItem` so it matches the sidebar's gating for that route EXACTLY.
   * Prefer this for routes that exist in navigation.tsx.
   */
  navHref?: string;
  /**
   * ★★★ doc 80 — mã SKU (`MOD_AI`, …) mà tuyến này THUỘC VỀ.
   *
   * ⚠⚠ Đây **KHÔNG** phải bản sao của cổng license theo tuyến ở §1b bên dưới. Hai thứ khác nhau ở
   *    ĐÚNG hai điểm, và cả hai đều load-bearing:
   *    1. §1b chạy sau cờ `LICENSE_ROUTE_GUARD` (mặc định **TẮT**) và suy module từ **bảng tuyến**
   *       của registry; ô này khai **TƯỜNG MINH** tại chỗ và **không** phụ thuộc cờ ấy — nên bật
   *       cổng cho MOD_AI không kéo theo việc bật cưỡng chế license cho MỌI module (đúng lý do cờ
   *       kia đang tắt: hệ đang chạy có SKU liệt kê ÍT module hơn số tuyến đang dùng).
   *    2. §1b không-brick theo cách khác: nó chỉ hỏi `isRouteAllowed`, mà `allowedModules` rơi về
   *       core ở cả những tình huống "chưa khai SKU". Ô này dùng `isModuleBlocked` — vị từ MỘT CHỦ
   *       ở `useLicenseModules`, khớp từng nhánh với `server/_core/moduleGate.ts`.
   *
   * ⇒ Chưa khai SKU · đang tải · guard `no_license` ⇒ **CHO VÀO**. Chỉ chặn khi SKU **đã khai** và
   *   thật sự không gồm module này.
   */
  requireModule?: string;
}

export function RouteGuard({
  children,
  requireRole,
  requirePermission,
  navHref,
  requireModule,
}: RouteGuardProps) {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permsLoading, isAdmin } = usePermissions();
  // doc 36 W3 — tenant-level license gate (independent of role). Flag-gated + only once
  // the license query has settled, so we never flash an upsell during load.
  const {
    isRouteAllowed: isLicenseRouteAllowed,
    isLoading: licenseLoading,
    isModuleBlocked,
  } = useLicenseModules();
  const licenseBlocked =
    isLicenseEnforcementEnabled() && !licenseLoading && !isLicenseRouteAllowed(location);
  // doc 80 — cổng theo MODULE khai tường minh; KHÔNG phụ thuộc cờ LICENSE_ROUTE_GUARD.
  const moduleBlocked = requireModule !== undefined && isModuleBlocked(requireModule);

  const role = user?.role ?? undefined;

  // 1. Don't decide until we know who the user is + their permissions.
  if (authLoading || permsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 1a-bis. doc 80 — cổng MODULE khai tường minh. Đặt TRƯỚC §1b và trước phép bỏ qua của admin:
  //         giấy phép là thứ CÔNG TY đã mua, không phải thứ VAI được cấp — một admin cũng không
  //         mở khoá được một module chưa mua. Trang này nói RÕ "chưa được cấp phép" (không phải
  //         "không có quyền"), không màn trắng, không chuyển hướng vòng: URL giữ nguyên, và hai
  //         lối ra là chợ module (`/modules`, tuyến CORE) và trang chính theo vai.
  if (moduleBlocked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Lock className="h-9 w-9" />
        </div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="module-not-licensed-title">
          {t("routeGuard.moduleTitle", "Module chưa được cấp phép")}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {t("routeGuard.moduleMessage", "Hệ thống của bạn chưa mua module này. Liên hệ để nâng cấp gói bản quyền.")}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/modules")}>{t("nav.app.upgrade", "Nâng cấp")}</Button>
          <Button variant="outline" onClick={() => navigate(landingPathForRole(role))}>
            {t("routeGuard.backToHome", "Về trang chính")}
          </Button>
        </div>
      </div>
    );
  }

  // 1b. License gate (tenant-level): the company hasn't purchased this module → upsell.
  //     Applies regardless of role (license is what the COMPANY bought, not who you are).
  //     The marketplace (/modules) is a CORE route so this is never a lock-out trap.
  if (licenseBlocked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Lock className="h-9 w-9" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          {t("routeGuard.licenseTitle", "Tính năng chưa được kích hoạt")}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {t(
            "routeGuard.licenseMessage",
            "Ứng dụng này chưa có trong gói bản quyền của bạn. Liên hệ để nâng cấp hoặc dùng thử.",
          )}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/modules")}>
            {t("nav.app.upgrade", "Nâng cấp")}
          </Button>
          <Button variant="outline" onClick={() => navigate(landingPathForRole(role))}>
            {t("routeGuard.backToHome", "Về trang chính")}
          </Button>
        </div>
      </div>
    );
  }

  // 2. Admin bypass (mirrors both nav helpers and usePermissions).
  let allowed = isAdmin || role === "admin";

  if (!allowed) {
    if (navHref) {
      // 3. Match the navigation gating exactly for this route. Cast mirrors
      //    DashboardLayout: the nav PermissionChecker types `action` as a plain
      //    string, slightly wider than usePermissions' PermissionAction union.
      allowed = hasAccessToItem(navHref, role, hasPermission as unknown as Parameters<typeof hasAccessToItem>[2]);
    } else {
      // 4. Explicit prop-based gating.
      const roleOk = !requireRole || (role != null && requireRole.includes(role));
      const permOk = !requirePermission || hasPermission(requirePermission, "canView");
      allowed = roleOk && permOk;
    }
  }

  if (allowed) {
    return <>{children}</>;
  }

  // 5. Friendly denied surface — no hard redirect (keeps the URL, offers a way out).
  const landing = landingPathForRole(role);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldAlert className="h-9 w-9" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">
        {t("routeGuard.deniedTitle", "Không có quyền truy cập")}
      </h1>
      <p className="max-w-md text-muted-foreground">
        {t(
          "routeGuard.deniedMessage",
          "Bạn không có quyền truy cập trang này. Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn.",
        )}
      </p>
      <Button onClick={() => navigate(landing)}>
        {t("routeGuard.backToHome", "Về trang chính")}
      </Button>
    </div>
  );
}

export default RouteGuard;
