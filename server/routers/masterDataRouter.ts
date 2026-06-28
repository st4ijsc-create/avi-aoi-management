/**
 * Doc 07 §③ — MES/MOM MASTER DATA tRPC router (key "masterData").
 *
 * Covers Supplier / Material(+class) / Customer / Skill(+Certification) /
 * Tool-Fixture masters. Pure master-data CRUD: NOTHING here writes a command to a
 * machine (no commandDispatcher / driver.writeTags).
 *
 * RBAC: module "masterdata" (canView/Create/Edit/Delete) via requirePermission.
 *   Reuses the existing `settings`-category permission convention but with a NEW
 *   moduleName "masterdata" — checkPermission keys off moduleName only, so no DB
 *   permissionCategoryEnum change is required. Admin always passes; any non-admin
 *   without an explicit grant is denied (fail-safe FORBIDDEN).
 *
 * DB access is inlined here with the getDb()-guarded style used across server/db
 * (read helpers degrade to []/null when the DB is offline; writers throw
 * "Database not available") so the router is self-contained and does not require
 * editing the server/db barrel.
 */
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import {
  suppliers, InsertSupplier,
  materials, InsertMaterial,
  materialClasses, InsertMaterialClass,
  customers, InsertCustomer,
  skills, InsertSkill,
  userCertifications, InsertUserCertification,
  tools, InsertTool,
} from "../../drizzle/schema";

const MODULE = "masterdata";

// ── Generic getDb-guarded CRUD helpers (fail-safe) ──────────────────────────
async function listAll<T extends { id: any; createdAt: any }>(table: T, activeOnly?: boolean) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(table as any);
  if (activeOnly && (table as any).isActive) {
    return q.where(eq((table as any).isActive, true)).orderBy(desc((table as any).createdAt));
  }
  return q.orderBy(desc((table as any).createdAt));
}

async function getOne(table: any, id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return row ?? null;
}

async function insertOne(table: any, values: Record<string, any>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(table).values(values).returning({ id: table.id });
  return row.id;
}

async function updateOne(table: any, id: number, patch: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(table)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(table.id, id))
    .returning();
  return row ?? null;
}

async function deleteOne(table: any, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(table).where(eq(table.id, id));
  return { success: true };
}

// Drop undefined keys so partial updates only touch provided fields.
function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const idInput = z.object({ id: z.number().int().positive() });

// ─── Suppliers ──────────────────────────────────────────────────────────────
const supplierType = z.enum(["component", "raw_material", "service", "equipment", "subcontractor", "other"]);
const supplierApproval = z.enum(["pending", "approved", "conditional", "rejected", "suspended"]);
const suppliersRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(suppliers, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(suppliers, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      type: supplierType.optional(),
      contactName: z.string().max(256).optional(),
      contactEmail: z.string().max(320).optional(),
      contactPhone: z.string().max(40).optional(),
      address: z.string().optional(),
      country: z.string().max(80).optional(),
      rating: z.number().min(0).max(5).optional(),
      approvalStatus: supplierApproval.optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { rating, ...rest } = input;
      const id = await insertOne(suppliers, { ...rest, ...(rating != null ? { rating: String(rating) } : {}) } as InsertSupplier);
      return { id };
    }),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      type: supplierType.optional(),
      contactName: z.string().max(256).optional(),
      contactEmail: z.string().max(320).optional(),
      contactPhone: z.string().max(40).optional(),
      address: z.string().optional(),
      country: z.string().max(80).optional(),
      rating: z.number().min(0).max(5).optional(),
      approvalStatus: supplierApproval.optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, rating, ...rest } = input;
      return updateOne(suppliers, id, clean({ ...rest, ...(rating != null ? { rating: String(rating) } : {}) }));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(suppliers, input.id)),
});

// ─── Material classes + Materials ───────────────────────────────────────────
const materialsRouter = router({
  listClasses: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(() => listAll(materialClasses)),
  createClass: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      parentCode: z.string().max(64).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(materialClasses, input as InsertMaterialClass) })),
  updateClass: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      parentCode: z.string().max(64).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(materialClasses, id, clean(rest));
    }),
  deleteClass: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(materialClasses, input.id)),

  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(materials, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(materials, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      materialClass: z.string().max(64).optional(),
      mpn: z.string().max(128).optional(),
      manufacturer: z.string().max(256).optional(),
      packageType: z.string().max(64).optional(),
      msl: z.string().max(8).optional(),
      rohs: z.boolean().optional(),
      unit: z.string().max(16).optional(),
      datasheetUrl: z.string().optional(),
      defaultSupplierCode: z.string().max(64).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(materials, input as InsertMaterial) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      materialClass: z.string().max(64).optional(),
      mpn: z.string().max(128).optional(),
      manufacturer: z.string().max(256).optional(),
      packageType: z.string().max(64).optional(),
      msl: z.string().max(8).optional(),
      rohs: z.boolean().optional(),
      unit: z.string().max(16).optional(),
      datasheetUrl: z.string().optional(),
      defaultSupplierCode: z.string().max(64).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(materials, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(materials, input.id)),
});

// ─── Customers ──────────────────────────────────────────────────────────────
const customersRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(customers, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(customers, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      contactName: z.string().max(256).optional(),
      contactEmail: z.string().max(320).optional(),
      contactPhone: z.string().max(40).optional(),
      address: z.string().optional(),
      country: z.string().max(80).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(customers, input as InsertCustomer) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      contactName: z.string().max(256).optional(),
      contactEmail: z.string().max(320).optional(),
      contactPhone: z.string().max(40).optional(),
      address: z.string().optional(),
      country: z.string().max(80).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(customers, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(customers, input.id)),
});

// ─── Skills + User certifications ───────────────────────────────────────────
const certLevel = z.enum(["trainee", "qualified", "expert", "trainer"]);
const skillsRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(skills, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(skills, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      category: z.string().max(64).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(skills, input as InsertSkill) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      category: z.string().max(64).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(skills, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(skills, input.id)),

  // Certifications (user × skill)
  listCertifications: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ userId: z.number().int().positive().optional(), skillId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [];
      if (input?.userId != null) conds.push(eq(userCertifications.userId, input.userId));
      if (input?.skillId != null) conds.push(eq(userCertifications.skillId, input.skillId));
      const q = db.select().from(userCertifications);
      return (conds.length ? q.where(and(...conds)) : q).orderBy(asc(userCertifications.id));
    }),
  grantCertification: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      userId: z.number().int().positive(),
      skillId: z.number().int().positive(),
      level: certLevel.optional(),
      expiresAt: z.string().datetime().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await insertOne(userCertifications, {
        userId: input.userId,
        skillId: input.skillId,
        level: input.level ?? "trainee",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        certifiedBy: ctx.user?.id ?? null,
        notes: input.notes ?? null,
      } as InsertUserCertification);
      return { id };
    }),
  updateCertification: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      level: certLevel.optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, expiresAt, ...rest } = input;
      return updateOne(userCertifications, id, clean({
        ...rest,
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
      }));
    }),
  revokeCertification: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(userCertifications, input.id)),
});

// ─── Tools / Fixtures / Consumables ─────────────────────────────────────────
const toolType = z.enum(["nozzle", "stencil", "squeegee", "lens", "jig", "fixture", "other"]);
const toolStatus = z.enum(["available", "in_use", "maintenance", "worn", "retired"]);
const toolsRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(tools, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(tools, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      type: toolType.optional(),
      machineType: z.string().max(40).optional(),
      lifeLimit: z.number().int().min(0).optional(),
      lifeUsed: z.number().int().min(0).optional(),
      status: toolStatus.optional(),
      location: z.string().max(128).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(tools, input as InsertTool) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      type: toolType.optional(),
      machineType: z.string().max(40).optional(),
      lifeLimit: z.number().int().min(0).optional(),
      lifeUsed: z.number().int().min(0).optional(),
      status: toolStatus.optional(),
      location: z.string().max(128).optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).optional(),
      factoryCode: z.string().max(50).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(tools, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(tools, input.id)),
});

export const masterDataRouter = router({
  suppliers: suppliersRouter,
  materials: materialsRouter,
  customers: customersRouter,
  skills: skillsRouter,
  tools: toolsRouter,
});
