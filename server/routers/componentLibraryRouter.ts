/**
 * Doc 27 §2 M12a / doc 29 §1 (Đợt 8 — W8-A) — Component Library tRPC router
 * (key "componentLibrary").
 *
 * Package/footprint master CRUD + the materials↔package link. Pure master-data:
 * NOTHING here writes a command to a machine.
 *
 * RBAC: module "masterdata" (canView/Create/Edit/Delete) — the library IS
 * master data and lives beside the /master-data page, so it reuses the exact
 * grant the existing masterDataRouter uses (no new permission seeds needed).
 *
 * Delete semantics: component_packages carries deletedAt (doc 29 §1.2) →
 * delete is a SOFT delete (deletedAt + isActive=false); footprints have no
 * tombstone column → hard delete (they are pure geometry variants).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import {
  componentPackages, InsertComponentPackage,
  componentFootprints, InsertComponentFootprint,
  materials,
} from "../../drizzle/schema";

const MODULE = "masterdata";
const idInput = z.object({ id: z.number().int().positive() });

// Drop undefined keys so partial updates only touch provided fields.
function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** numeric(10,4) columns travel as strings in drizzle — stringify numbers. */
function num(v: number | null | undefined): string | null | undefined {
  return v == null ? (v as null | undefined) : String(v);
}

const packageBody = {
  ipcName: z.string().max(128).nullable().optional(),
  family: z.string().min(1).max(40).optional(),
  mountType: z.string().max(10).optional(),
  bodyLengthMm: z.number().nonnegative().nullable().optional(),
  bodyWidthMm: z.number().nonnegative().nullable().optional(),
  bodyHeightMm: z.number().nonnegative().nullable().optional(),
  pinCount: z.number().int().nonnegative().nullable().optional(),
  pitchMm: z.number().nonnegative().nullable().optional(),
  hasPolarity: z.boolean().optional(),
  polarityMark: z.string().max(40).nullable().optional(),
  leadType: z.string().max(30).nullable().optional(),
  inspectionNotes: z.string().nullable().optional(),
  defaultDefects: z.array(z.string().max(64)).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const componentLibraryRouter = router({
  // ── Packages ────────────────────────────────────────────────────────────────
  packages: router({
    list: protectedProcedure
      .use(requirePermission(MODULE, "canView"))
      .input(z.object({
        activeOnly: z.boolean().optional(),
        family: z.string().max(40).optional(),
        includeDeleted: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const conds = [];
        if (!input?.includeDeleted) conds.push(isNull(componentPackages.deletedAt));
        if (input?.activeOnly) conds.push(eq(componentPackages.isActive, true));
        if (input?.family) conds.push(eq(componentPackages.family, input.family));
        const q = db.select().from(componentPackages);
        return (conds.length ? q.where(and(...conds)) : q).orderBy(asc(componentPackages.code));
      }),

    get: protectedProcedure
      .use(requirePermission(MODULE, "canView"))
      .input(idInput)
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const [row] = await db.select().from(componentPackages).where(eq(componentPackages.id, input.id)).limit(1);
        return row ?? null;
      }),

    create: protectedProcedure
      .use(requirePermission(MODULE, "canCreate"))
      .input(z.object({
        ...packageBody,
        code: z.string().min(1).max(64),
        family: z.string().min(1).max(40),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { bodyLengthMm, bodyWidthMm, bodyHeightMm, pitchMm, ...rest } = input;
        try {
          const [row] = await db.insert(componentPackages).values({
            ...rest,
            bodyLengthMm: num(bodyLengthMm),
            bodyWidthMm: num(bodyWidthMm),
            bodyHeightMm: num(bodyHeightMm),
            pitchMm: num(pitchMm),
            origin: "manual",
          } as InsertComponentPackage).returning({ id: componentPackages.id });
          return { id: row.id };
        } catch (e) {
          if (/uq_comp_pkg_code|duplicate key/i.test(String((e as Error)?.message))) {
            throw new TRPCError({ code: "CONFLICT", message: `Package code '${input.code}' already exists` });
          }
          throw e;
        }
      }),

    update: protectedProcedure
      .use(requirePermission(MODULE, "canEdit"))
      .input(idInput.extend(packageBody))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { id, bodyLengthMm, bodyWidthMm, bodyHeightMm, pitchMm, ...rest } = input;
        const patch = clean({
          ...rest,
          bodyLengthMm: num(bodyLengthMm),
          bodyWidthMm: num(bodyWidthMm),
          bodyHeightMm: num(bodyHeightMm),
          pitchMm: num(pitchMm),
        });
        const [row] = await db
          .update(componentPackages)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(componentPackages.id, id))
          .returning();
        return row ?? null;
      }),

    /** SOFT delete — keeps the code as a tombstone; linked materials keep packageId
     *  (the row is still resolvable for historical Pareto), but it leaves lists. */
    delete: protectedProcedure
      .use(requirePermission(MODULE, "canDelete"))
      .input(idInput)
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db
          .update(componentPackages)
          .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
          .where(eq(componentPackages.id, input.id));
        return { success: true };
      }),
  }),

  // ── Footprints (land-pattern variants per package) ──────────────────────────
  footprints: router({
    listByPackage: protectedProcedure
      .use(requirePermission(MODULE, "canView"))
      .input(z.object({ packageId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db.select().from(componentFootprints)
          .where(eq(componentFootprints.packageId, input.packageId))
          .orderBy(asc(componentFootprints.code));
      }),

    create: protectedProcedure
      .use(requirePermission(MODULE, "canCreate"))
      .input(z.object({
        packageId: z.number().int().positive(),
        code: z.string().min(1).max(64),
        density: z.enum(["most", "nominal", "least"]).optional(),
        padCount: z.number().int().nonnegative().optional(),
        geometry: z.object({
          pads: z.array(z.object({
            x: z.number(), y: z.number(), w: z.number(), h: z.number(),
            shape: z.string().max(20).optional(), angle: z.number().optional(),
          })).optional(),
        }).optional(),
        courtyardMm: z.object({ w: z.number(), h: z.number() }).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        try {
          const [row] = await db.insert(componentFootprints).values(input as InsertComponentFootprint)
            .returning({ id: componentFootprints.id });
          return { id: row.id };
        } catch (e) {
          if (/uq_comp_fp_pkg_code|duplicate key/i.test(String((e as Error)?.message))) {
            throw new TRPCError({ code: "CONFLICT", message: `Footprint '${input.code}' already exists for this package` });
          }
          throw e;
        }
      }),

    update: protectedProcedure
      .use(requirePermission(MODULE, "canEdit"))
      .input(idInput.extend({
        density: z.enum(["most", "nominal", "least"]).nullable().optional(),
        padCount: z.number().int().nonnegative().nullable().optional(),
        geometry: z.object({
          pads: z.array(z.object({
            x: z.number(), y: z.number(), w: z.number(), h: z.number(),
            shape: z.string().max(20).optional(), angle: z.number().optional(),
          })).optional(),
        }).nullable().optional(),
        courtyardMm: z.object({ w: z.number(), h: z.number() }).nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { id, ...rest } = input;
        const [row] = await db
          .update(componentFootprints)
          .set({ ...clean(rest), updatedAt: new Date() })
          .where(eq(componentFootprints.id, id))
          .returning();
        return row ?? null;
      }),

    delete: protectedProcedure
      .use(requirePermission(MODULE, "canDelete"))
      .input(idInput)
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(componentFootprints).where(eq(componentFootprints.id, input.id));
        return { success: true };
      }),
  }),

  // ── Materials ↔ package linkage ─────────────────────────────────────────────
  /** Set (or clear with null) a material's packageId. */
  linkMaterial: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      materialId: z.number().int().positive(),
      packageId: z.number().int().positive().nullable(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      if (input.packageId != null) {
        const [pkg] = await db.select({ id: componentPackages.id }).from(componentPackages)
          .where(and(eq(componentPackages.id, input.packageId), isNull(componentPackages.deletedAt)))
          .limit(1);
        if (!pkg) throw new TRPCError({ code: "NOT_FOUND", message: `Package #${input.packageId} not found` });
      }
      const [row] = await db
        .update(materials)
        .set({ packageId: input.packageId, updatedAt: new Date() })
        .where(eq(materials.id, input.materialId))
        .returning({ id: materials.id, code: materials.code, packageId: materials.packageId });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Material #${input.materialId} not found` });
      return row;
    }),

  /**
   * Re-run the 0191 best-effort backfill: link UNLINKED materials whose
   * free-text packageType matches a package code (case-insensitive, trimmed).
   * Never overwrites an existing link.
   */
  backfillMaterialLinks: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const result = await db.execute(sql`
        UPDATE "materials" m
        SET "packageId" = cp."id", "updatedAt" = now()
        FROM "component_packages" cp
        WHERE m."packageId" IS NULL
          AND m."packageType" IS NOT NULL
          AND upper(trim(m."packageType")) = upper(cp."code")`);
      // postgres.js returns an array-like with `count`; drizzle passes it through.
      const linked = Number((result as unknown as { count?: number })?.count ?? 0);
      return { linked };
    }),

  /** Per-package linked-material counts + linkage coverage (page header stats). */
  linkStats: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return { totalMaterials: 0, linkedMaterials: 0, byPackage: [] as Array<{ packageId: number; count: number }> };
      const [totals] = (await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE "packageId" IS NOT NULL)::int AS linked
        FROM "materials"`)) as unknown as Array<{ total: number; linked: number }>;
      const byPackage = (await db.execute(sql`
        SELECT "packageId", count(*)::int AS count
        FROM "materials" WHERE "packageId" IS NOT NULL
        GROUP BY "packageId"`)) as unknown as Array<{ packageId: number; count: number }>;
      return {
        totalMaterials: Number(totals?.total ?? 0),
        linkedMaterials: Number(totals?.linked ?? 0),
        byPackage: byPackage.map((r) => ({ packageId: Number(r.packageId), count: Number(r.count) })),
      };
    }),
});
