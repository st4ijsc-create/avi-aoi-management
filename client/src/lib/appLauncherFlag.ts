/**
 * doc 36 — App Launcher is the DEFAULT menu; classic is opt-out.
 *
 * Prefer the reactive `useAppLauncherMode()` hook in components (so the in-app toggle
 * updates live). This function is the same resolution for non-React callers:
 *   1. localStorage "APP_LAUNCHER_V2" ("true"/"false") — the user's saved choice.
 *   2. VITE_APP_LAUNCHER_V2 === "false" — deployment default = classic.
 *   3. ON (default = App Launcher).
 */
export function isAppLauncherEnabled(): boolean {
  try {
    const ls = localStorage.getItem("APP_LAUNCHER_V2");
    if (ls === "true") return true;
    if (ls === "false") return false;
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_APP_LAUNCHER_V2 === "false" ? false : true;
}

/**
 * doc 36 W3 — HARD license route enforcement (default OFF).
 *
 * When ON, RouteGuard blocks deep-links to routes whose owning module the tenant hasn't
 * licensed (showing an upsell), closing the gap where the menu hid an app but its routes
 * stayed reachable. Kept OFF by default so existing deployments (whose license may list
 * fewer modules than routes in use) are not locked out until the operator flips it on.
 * Resolution: localStorage "LICENSE_ROUTE_GUARD" → VITE_LICENSE_ROUTE_GUARD → OFF.
 */
export function isLicenseEnforcementEnabled(): boolean {
  try {
    const ls = localStorage.getItem("LICENSE_ROUTE_GUARD");
    if (ls != null) return ls === "true";
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_LICENSE_ROUTE_GUARD === "true";
}

/**
 * doc 39 Wave 1b — persistent app-shell hoist (default OFF).
 *
 * When ON, ONE DashboardLayout is hoisted above the router so the sidebar/header/nav
 * chrome no longer remounts on every navigation (each page's own <DashboardLayout>
 * becomes a lightweight passthrough via InShellContext). OFF (default) = every page
 * mounts its own DashboardLayout, byte-for-byte as before — so this is safe to ship
 * dark and flip on only after a live smoke test (esp. chromeless routes + kiosk).
 * Resolution: localStorage "APP_SHELL_PERSISTENT" → VITE_APP_SHELL_PERSISTENT → OFF.
 */
export function isPersistentShellEnabled(): boolean {
  try {
    const ls = localStorage.getItem("APP_SHELL_PERSISTENT");
    if (ls != null) return ls === "true";
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_APP_SHELL_PERSISTENT === "true";
}

/**
 * Routes that render their own full-screen / bare content WITHOUT DashboardLayout
 * (login, setup, TV/kiosk boards, full-screen inbox, the DS showcase, 404). The
 * persistent shell must NOT wrap these — doing so would render sidebar chrome around
 * a TV board or the login screen. Keep in sync with the pages that don't import
 * DashboardLayout (AndonBoard/InboxPage/ComponentShowcase/Login/Setup/NotFound).
 */
const CHROMELESS_SHELL_ROUTES = new Set<string>([
  "/login",
  "/setup",
  "/andon",
  "/inbox",
  "/component-showcase",
  "/404",
]);

export function isChromelessShellRoute(pathname: string): boolean {
  const path = (pathname || "").split("?")[0];
  return CHROMELESS_SHELL_ROUTES.has(path);
}
