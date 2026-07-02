/**
 * roleLanding — map an authenticated user's role to the right "front door".
 *
 * Instead of every role landing on the marketing Home ("/"), each role is routed
 * to the surface most useful to them on login:
 *   - operator           → /operator            (the big-button floor shell)
 *   - maintenance        → /maintenance-home     (maintenance workspace, F1 doc 23)
 *   - quality_inspector  → /quality-home          (the inspection workspace)
 *   - supervisor/manager → /supervisor-home       (briefing: rollup + escalation, U1)
 *   - admin/it_admin     → /admin-home             (governance briefing, U5)
 *   - viewer/user        → /viewer-home           (read-only briefing, U3)
 *   - other/unknown      → /                      (Home)
 *
 * Intentionally minimal + safe: an unknown/undefined role falls through to "/".
 * Routes are NOT permission-checked here — each page enforces its own access;
 * this only picks a sensible default destination.
 */

export const FLOOR_ROLES = ["operator", "maintenance"] as const;

export function landingPathForRole(role?: string | null): string {
  switch (role) {
    case "operator":
      return "/operator";
    case "maintenance":
      return "/maintenance-home";
    case "quality_inspector":
      return "/quality-home";
    case "supervisor":
    case "manager":
      return "/supervisor-home";
    case "admin":
    case "it_admin":
      return "/admin-home";
    case "viewer":
    case "user":
      return "/viewer-home";
    default:
      return "/";
  }
}

/** True when the role is a shop-floor role that should be nudged off Home. */
export function isFloorRole(role?: string | null): boolean {
  return role === "operator" || role === "maintenance";
}
