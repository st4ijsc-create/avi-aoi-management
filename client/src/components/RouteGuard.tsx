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
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { hasAccessToItem } from "@/lib/navigation";
import { landingPathForRole } from "@/lib/roleLanding";
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
}

export function RouteGuard({
  children,
  requireRole,
  requirePermission,
  navHref,
}: RouteGuardProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: permsLoading, isAdmin } = usePermissions();

  const role = user?.role ?? undefined;

  // 1. Don't decide until we know who the user is + their permissions.
  if (authLoading || permsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
