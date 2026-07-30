/**
 * First-run bootstrap router (key "bootstrap") — doc 54 §11 Phase-0 (P0.5).
 *
 * `bootstrap.newFactory` seeds the MINIMUM shell a real rollout needs so a fresh
 * deployment can start clean WITHOUT the SIM-FAC demo data: a corporate root, a
 * factory shell under it, and a "production vs simulation" deployment tag/flag.
 *
 * SAFETY / GUARANTEES:
 *   • admin-only (adminProcedure) — this stands up top-level tenancy.
 *   • Idempotent: corporate/factory are existence-checked by code (re-run is a
 *     no-op that returns created=false); the mode flag is upserted.
 *   • NON-destructive: never deletes or overwrites existing hierarchy rows. The
 *     SIM-FAC demo data (if present) is left untouched — a clean rollout simply
 *     stops pointing at it and points at the new factory + production mode.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { eq } from "drizzle-orm";
import { router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { getDb } from "../db/connection";
import { corporates } from "../../drizzle/schema";
import * as db from "../db";

const DEPLOYMENT_MODE_KEY = "deployment.mode";

/** Upsert a system_settings key (create if absent, else update). */
async function upsertSetting(
  key: string,
  value: string,
  description: string,
  userId: number,
): Promise<void> {
  const existing = await db.getSystemSetting(key);
  if (existing) {
    await db.updateSystemSetting(key, value, userId);
  } else {
    await db.createSystemSetting({
      settingKey: key,
      settingValue: value,
      description,
      category: "deployment",
      updatedBy: userId,
    });
  }
}

export const bootstrapRouter = router({
  /**
   * Stand up a corporate root + factory shell + production/simulation flag.
   * Minimal, idempotent, non-destructive (see file header).
   */
  newFactory: adminProcedure
    .input(z.object({
      corporateCode: z.string().trim().min(1).max(50),
      corporateName: z.string().trim().min(1).max(255).optional(),
      factoryCode: z.string().trim().min(1).max(50),
      factoryName: z.string().trim().min(1).max(255).optional(),
      /** "production vs simulation" tag for the deployment. */
      mode: z.enum(["production", "simulation"]).default("production"),
      country: z.string().max(100).optional(),
      timezone: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDb();
      if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const corporateCode = input.corporateCode.trim();
      const factoryCode = input.factoryCode.trim();

      // ── 1) Corporate root (idempotent by code) ──────────────────────────────
      let corporateCreated = false;
      const [existingCorp] = await d
        .select({ id: corporates.id })
        .from(corporates)
        .where(eq(corporates.code, corporateCode))
        .limit(1);
      if (!existingCorp) {
        try {
          await d.insert(corporates).values({
            code: corporateCode,
            name: input.corporateName?.trim() || corporateCode,
            country: input.country ?? null,
          });
          corporateCreated = true;
        } catch (err) {
          // Unique-race: another bootstrap created it first — treat as existing.
          const again = await d
            .select({ id: corporates.id })
            .from(corporates)
            .where(eq(corporates.code, corporateCode))
            .limit(1);
          if (again.length === 0) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: err instanceof Error ? err.message : "Failed to create corporate",
            });
          }
        }
      }

      // ── 2) Factory shell under the corporate (idempotent by code) ───────────
      let factoryCreated = false;
      const existingFactory = await db.getFactoryByCode(factoryCode);
      let factoryId: number;
      if (existingFactory) {
        factoryId = existingFactory.id;
      } else {
        factoryId = await db.createFactory({
          corporateCode,
          code: factoryCode,
          name: input.factoryName?.trim() || factoryCode,
          country: input.country ?? null,
          ...(input.timezone ? { timezone: input.timezone } : {}),
        });
        factoryCreated = true;
      }

      // ── 3) Production-vs-simulation tag/flag (upsert) ───────────────────────
      // Global deployment mode + a per-factory tag so multi-factory rollouts can
      // mark each factory independently.
      await upsertSetting(
        DEPLOYMENT_MODE_KEY,
        input.mode,
        "Deployment mode: production | simulation (set at first-run bootstrap)",
        ctx.user.id,
      );
      await upsertSetting(
        `factory.mode.${factoryCode}`,
        input.mode,
        `Deployment mode for factory ${factoryCode}`,
        ctx.user.id,
      );

      // Best-effort audit — never fail the bootstrap on an audit write.
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? null,
          action: "create",
          entityType: "factory",
          entityId: factoryId,
          entityName: factoryCode,
          details: { bootstrap: true, corporateCode, mode: input.mode, corporateCreated, factoryCreated },
          status: "success",
        });
      } catch {
        /* audit is best-effort */
      }

      return {
        corporate: { code: corporateCode, created: corporateCreated },
        factory: { id: factoryId, code: factoryCode, created: factoryCreated },
        mode: input.mode,
      };
    }),
});

export type BootstrapRouter = typeof bootstrapRouter;
