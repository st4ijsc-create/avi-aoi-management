/**
 * roleLanding — map an authenticated user's role to the right "front door".
 *
 * Instead of every role landing on the marketing Home ("/"), each role is routed
 * to the surface most useful to them on login:
 *   - operator           → /operator            (the big-button floor shell)
 *   - maintenance        → /technician-copilot   (RCA copilot)
 *   - quality_inspector  → /quality-home          (the inspection workspace)
 *   - supervisor/manager → /management-insight    (exec NL Q&A + alerts)
 *   - admin/it_admin     → /dashboard             (full ops dashboard)
 *   - viewer/user/other  → /                      (Home)
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
      return "/technician-copilot";
    case "quality_inspector":
      return "/quality-home";
    case "supervisor":
    case "manager":
      return "/management-insight";
    case "admin":
    case "it_admin":
      return "/dashboard";
    case "viewer":
    case "user":
    default:
      return "/";
  }
}

/** True when the role is a shop-floor role that should be nudged off Home. */
export function isFloorRole(role?: string | null): boolean {
  return role === "operator" || role === "maintenance";
}
