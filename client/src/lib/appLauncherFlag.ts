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
