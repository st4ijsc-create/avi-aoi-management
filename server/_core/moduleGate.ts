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
 *   flag OFF                    → pass-through (identical to legacy behaviour)
 *   LICENSE_BYPASS=true         → pass-through (offline deployment)
 *   unknown / core module       → pass-through (never lock a CORE_* app)
 *   SKU NOT configured          → pass-through (see "No-brick" below)
 *   ON + module licensed        → pass-through
 *   ON + module NOT licensed    → TRPCError FORBIDDEN (marker: MODULE_NOT_LICENSED)
 *
 * ── Doc 38 Đợt Q — flag DEFAULT ON, but NO-BRICK ─────────────────────────────
 * `LICENSE_MODULE_GATE_ENABLED` now defaults ON (set it to "false" to fully disable).
 * To guarantee flipping it on can NEVER brick a deployment, the gate enforces ONLY
 * when the deployment's SKU is EXPLICITLY populated. Concretely it fails OPEN when:
 *   (a) there is NO license row at all, OR
 *   (b) every license row's `allowed_modules` is empty/null (and no disk-cache SKU).
 * i.e. a system that has never been told which modules it owns lets everything
 * through. A module is denied only once at least one license row lists modules
 * explicitly and the requested module is absent from that union.
 *
 * ── Fail-safe ─────────────────────────────────────────────────────────────────
 * Entitlement resolution touches the DB / license guard. If that resolution THROWS
 * (DB down, guard mid-init, …) we ALLOW-with-log rather than deny, so a transient
 * infrastructure blip can never self-lock a production tenant out of a paid module.
 * A genuine "not licensed" outcome (resolution succeeded, SKU configured, module
 * absent) is a hard deny. This asymmetry is deliberate.
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
 * Result of entitlement resolution.
 *  - `configured: false` → the deployment has never listed which modules it owns
 *    (no license row, or all rows have empty allowed_modules). Caller fails OPEN.
 *  - `configured: true`  → `allowed` is the authoritative set to enforce against.
 */
type Entitlement = { configured: false } | { configured: true; allowed: string[] };

/**
 * Resolve the set of module codes the current deployment is entitled to.
 *
 * Mirrors `licenseRouter.getAllowedModules` aggregation (single source of truth):
 * modules are aggregated across ALL active + expired (grace-period) licenses, with a
 * disk-cache fallback, and finally bounded by the deployment EDITION ceiling when a
 * profile is enforced. Core modules are always included.
 *
 * Doc 38 no-brick: if NO license row carries an explicit `allowed_modules` list
 * (and no disk-cache SKU exists) the deployment is treated as UNCONFIGURED → the
 * caller allows the request rather than restricting to core-only.
 *
 * @throws if the DB / guard cannot be reached — caller treats a throw as fail-safe.
 */
async function resolveEntitlement(): Promise<Entitlement> {
  const db = await import("../db");
  const { licenseService } = await import("../license/license-service");

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

  // ── No-brick: SKU never populated → deployment is UNCONFIGURED → fail OPEN. ──
  if (aggregated.length === 0) {
    return { configured: false };
  }

  let all = [...new Set([...CORE_MODULE_CODES, ...aggregated])];

  // Bound by edition ceiling (doc 33 I3) when a deployment profile is enforced.
  const profile = resolveDeploymentProfile();
  if (profile.profileEnforced) {
    all = resolveEditionModules(profile.edition, all);
  }

  return { configured: true, allowed: all };
}

/**
 * doc69 G2-4 — ctx-independent version of the EXACT SAME entitlement decision `moduleGate`
 * makes below, for non-tRPC callers that want to gate a feature by the same license/edition
 * rule without a tRPC middleware context (e.g. `aiGateway.planInference`, which is called
 * from many services/service-to-service paths, not only tRPC procedures). Entitlement itself
 * is deployment-global (not per-request), so no `ctx` is actually needed — this just exposes
 * the same decision as a plain async function so there is ONE entitlement engine, not two.
 *
 * Same behaviour table as `moduleGate` (flag OFF / LICENSE_BYPASS / unknown-or-core module /
 * no-brick-unconfigured / resolution failure ⇒ true; genuinely-not-licensed ⇒ false).
 */
export async function isModuleLicensed(moduleCode: string): Promise<boolean> {
  if (!ENV.licenseModuleGate) return true;
  if (ENV.licenseBypass) return true;

  const mod = getModuleByCode(moduleCode);
  if (!mod || mod.isCore) return true;

  try {
    const entitlement = await resolveEntitlement();
    if (!entitlement.configured) return true; // no-brick: unconfigured deployment → allow
    return entitlement.allowed.includes(moduleCode);
  } catch (err) {
    console.warn(
      `[moduleGate] isModuleLicensed(${moduleCode}) entitlement resolution failed — allowing (fail-safe): ${
        (err as Error)?.message ?? err
      }`,
    );
    return true;
  }
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
      const entitlement = await resolveEntitlement();
      // No-brick: SKU never configured → allow (never lock an unconfigured system).
      if (!entitlement.configured) {
        return next({ ctx });
      }
      if (!entitlement.allowed.includes(moduleCode)) {
        // Hard deny — resolution succeeded, SKU configured, module genuinely absent.
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
