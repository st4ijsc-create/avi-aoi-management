/**
 * roleLandingResolve — landing destination WITH the role-default override
 * (doc 27 A12 / W5-C).
 *
 * The static map in roleLanding.ts stays the source of truth/fallback; an
 * admin may additionally bind a per-role `landingPath` in
 * role_dashboard_defaults (migration 0184). This helper asks the server for
 * the current user's effective binding and prefers its landingPath.
 *
 * Fail-safe by construction: any error, timeout (2s) or missing binding →
 * the static landingPathForRole result. Never throws.
 */
import { landingPathForRole } from "@/lib/roleLanding";

interface EffectiveDashboardLike {
  landingPath?: string | null;
}

interface UtilsLike {
  dashboardWidget: {
    getMyEffectiveDashboard: {
      fetch: (input?: undefined, opts?: { staleTime?: number }) => Promise<EffectiveDashboardLike | null | undefined>;
    };
  };
}

export async function resolveRoleLanding(
  utils: UtilsLike,
  role?: string | null,
  timeoutMs = 2000,
): Promise<string> {
  const fallback = landingPathForRole(role);
  try {
    const eff = await Promise.race([
      utils.dashboardWidget.getMyEffectiveDashboard.fetch(undefined, { staleTime: 60_000 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const landing = eff?.landingPath;
    if (typeof landing === "string" && landing.startsWith("/")) return landing;
  } catch {
    // endpoint unavailable / migration not applied → static fallback
  }
  return fallback;
}
