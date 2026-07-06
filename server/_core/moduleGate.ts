/**
 * moduleGate — SERVER-SIDE per-module license enforcement (doc 37 P0-3).
 *
 * Problem this closes: until now, per-module entitlement was checked ONLY on the
 * client (`RouteGuard.tsx`, behind the OFF `LICENSE_ROUTE_GUARD` flag). A deep-link
 * tRPC call into a procedure that belongs to a NOT-purchased module still executed
 * on the server (`server/_core/trpc.ts` had no license middleware;
 * `licenseRouter.ts` only *returns* entitlement state, never enforces it).
 *
 * This middleware mirrors `accessControl.requirePermission`: it is a plain tRPC
 * middleware factory `moduleGate(moduleCode)` used as
 *   `protectedProcedure.use(moduleGate('MOD_AI'))`
 * or, more conveniently, via the `moduleProcedure('MOD_AI')` builder exported from
 * `trpc.ts`. It ADDS to (never replaces) existing RBAC/permission checks.
 *
 * ── Behaviour ─────────────────────────────────────────────────────────────────
 *   flag OFF (default)         → pass-through (identical to today)
 *   LICENSE_BYPASS=true        → pass-through (offline deployment)
 *   unknown / core module      → pass-through (never lock a CORE_* app)
 *   ON + module licensed       → pass-through
 *   ON + module NOT licensed   → TRPCError FORBIDDEN (marker: MODULE_NOT_LICENSED)
 *
 * ── Fail-safe ─────────────────────────────────────────────────────────────────
 * Entitlement resolution touches the DB / license guard. If that resolution THROWS
 * (DB down, guard mid-init, …) we ALLOW-with-log rather than deny, so a transient
 * infrastructure blip can never self-lock a production tenant out of a paid module.
 * A genuine "not licensed" outcome (resolution succeeded, module absent) is a hard
 * deny. This asymmetry is deliberate.
 *
 * Load-order safety: only pure shared/registry helpers + ENV are imported at module
 * top. The DB / licenseGuard / licenseService are dynamically imported INSIDE the
 * middleware (same technique as the audit & tenant-scope middlewares in trpc.ts) so
 * importing this file never drags the data layer into tRPC bootstrap.
 */

import { TRPCError } from "@trpc/server";
import {
  getModuleByCode,
  CORE_MODULE_CODES,
} from "@shared/module-registry";
import { resolveEditionModules } from "@shared/editions";
import { resolveDeploymentProfile } from "./deploymentProfile";
import { ENV } from "./env";
import type { TrpcContext } from "./context";

/**
 * Resolve the set of module codes the current deployment is entitled to.
 *
 * This mirrors the aggregation logic of `licenseRouter.getAllowedModules`
 * (single source of truth for entitlement): LicenseGuard state gates whether any
 * optional modules are visible, then modules are aggregated across ALL active +
 * expired (grace-period) licenses, with a disk-cache fallback, and finally bounded
 * by the deployment EDITION ceiling when a profile is enforced. Core modules are
 * always included.
 *
 * @throws if the DB / guard cannot be reached — caller treats a throw as fail-safe.
 */
async function resolveAllowedModuleCodes(): Promise<string[]> {
  const db = await import("../db");
  const { licenseGuard } = await import("../license/license-guard");
  const { licenseService } = await import("../license/license-service");

  const guardState = licenseGuard.getStatus().state; // normal|warning|readonly|locked|no_license
  const isGuardAllowing = ["normal", "warning", "readonly"].includes(guardState);

  // Guard blocks optional modules (locked / no_license) → core only.
  if (!isGuardAllowing) {
    return [...CORE_MODULE_CODES];
  }

  // Aggregate module codes from every active + expired (grace) license.
  const { licenses: activeLicenses } = await db.getAllLicenses({ status: "active", limit: 100 });
  const { licenses: expiredLicenses } = await db.getAllLicenses({ status: "expired", limit: 100 });

  let aggregated: string[] = [];
  for (const lic of [...activeLicenses, ...expiredLicenses]) {
    const mods = (lic.allowedModules as string[] | null) || [];
    if (mods.length > 0) aggregated.push(...mods);
  }
  aggregated = [...new Set(aggregated)];

  // Disk-cache fallback when the DB carries no module data (server-down history).
  if (aggregated.length === 0) {
    const cached = licenseService.loadLicenseStateCache();
    if (cached && cached.allowedModules && cached.allowedModules.length > 0) {
      aggregated = cached.allowedModules;
    }
  }

  let all = [...new Set([...CORE_MODULE_CODES, ...aggregated])];

  // Bound by edition ceiling (doc 33 I3) when a deployment profile is enforced.
  const profile = resolveDeploymentProfile();
  if (profile.profileEnforced) {
    all = resolveEditionModules(profile.edition, all);
  }

  return all;
}

/**
 * tRPC middleware factory — enforce that the caller's license includes `moduleCode`.
 *
 * Returns a plain middleware function (same shape as `requirePermission`) so it can
 * be chained onto any procedure: `protectedProcedure.use(moduleGate('MOD_OT_CONTROL'))`.
 */
export function moduleGate(moduleCode: string) {
  return async ({
    ctx,
    next,
  }: {
    ctx: TrpcContext & { user: NonNullable<TrpcContext["user"]> };
    next: Function;
  }) => {
    // ── Flag OFF (default) → pass-through, byte-for-byte current behaviour. ──
    if (!ENV.licenseModuleGate) {
      return next({ ctx });
    }

    // ── Offline deployment bypass → allow everything. ──
    if (ENV.licenseBypass) {
      return next({ ctx });
    }

    // ── Unknown module or core module → never block. ──
    const mod = getModuleByCode(moduleCode);
    if (!mod || mod.isCore) {
      return next({ ctx });
    }

    try {
      const allowed = await resolveAllowedModuleCodes();
      if (!allowed.includes(moduleCode)) {
        // Hard deny — resolution succeeded and the module is genuinely absent.
        throw new TRPCError({
          code: "FORBIDDEN",
          // "MODULE_NOT_LICENSED" marker lets the client distinguish a license
          // wall (→ upsell to /modules) from an RBAC denial. Also carried on
          // `cause` for programmatic handling.
          message: `MODULE_NOT_LICENSED: Module "${mod.name}" chưa được cấp phép. Vui lòng nâng cấp license.`,
          cause: { moduleNotLicensed: moduleCode },
        });
      }
      return next({ ctx });
    } catch (err) {
      // A real license-wall denial propagates.
      if (err instanceof TRPCError) throw err;
      // Resolution failure (DB/guard error) → FAIL-SAFE ALLOW + log. Never
      // self-lock a production tenant out of a paid module on a transient blip.
      console.warn(
        `[moduleGate] entitlement resolution failed for ${moduleCode} — allowing (fail-safe): ${
          (err as Error)?.message ?? err
        }`,
      );
      return next({ ctx });
    }
  };
}
