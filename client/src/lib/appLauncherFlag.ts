/**
 * doc 36 W1 — App Launcher feature flag (default OFF).
 *
 * The launcher IA ships behind a flag so the legacy 9-group sidebar keeps working
 * untouched until the pilot flips it on. Resolution order:
 *   1. localStorage "APP_LAUNCHER_V2" ("true"/"false") — per-browser pilot override.
 *   2. import.meta.env.VITE_APP_LAUNCHER_V2 === "true" — build/env default.
 *   3. OFF.
 */
export function isAppLauncherEnabled(): boolean {
  try {
    const ls = localStorage.getItem("APP_LAUNCHER_V2");
    if (ls != null) return ls === "true";
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_APP_LAUNCHER_V2 === "true";
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
