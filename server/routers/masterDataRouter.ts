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
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { rethrowDbError, withDbErrors, isUniqueViolation } from "../_core/dbErrors";
import { getDb } from "../db/connection";
import {
  suppliers, InsertSupplier,
  materials, InsertMaterial,
  materialClasses, InsertMaterialClass,
  customers, InsertCustomer,
  skills, InsertSkill,
  userCertifications, InsertUserCertification,
  users,
  tools, InsertTool,
  unitsOfMeasure, InsertUnitOfMeasure,
  unitConversions, InsertUnitConversion,
  plantCalendars, InsertPlantCalendar,
  calendarDays, InsertCalendarDay,
  calendarDayShifts, InsertCalendarDayShift,
  shiftConfigs,
  warehouses, InsertWarehouse,
  storageLocations, InsertStorageLocation,
  inventoryBalances, InsertInventoryBalance,
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
  try {
    const [row] = await db.insert(table).values(values).returning({ id: table.id });
    return row.id;
  } catch (err) {
    rethrowDbError(err, { conflictMessage: "Mã đã tồn tại" });
  }
}

async function updateOne(table: any, id: number, patch: Record<string, any>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const [row] = await db
      .update(table)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(table.id, id))
      .returning();
    return row ?? null;
  } catch (err) {
    rethrowDbError(err, { conflictMessage: "Mã đã tồn tại" });
  }
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

// ── doc 42 Đợt 4A #2 — validate mã tham chiếu TỒN TẠI trong bảng cha ──────────
/**
 * Bịt đường API trực tiếp: FE picker chặn mã rác nhưng caller gọi thẳng tRPC có
 * thể gửi mã không tồn tại (materialClass/unit/uom/material/warehouse). Nếu `code`
 * rỗng/null → bỏ qua (field không bắt buộc). Nếu có mà không thấy trong `table`
 * (theo cột `code`) → BAD_REQUEST tiếng Việt. DB offline → bỏ qua (writer sau đó
 * sẽ ném "Database not available").
 */
async function requireRef(code: unknown, table: any, label: string): Promise<void> {
  if (code == null || code === "") return;
  const db = await getDb();
  if (!db) return;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, String(code))).limit(1);
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label} "${code}" không tồn tại` });
  }
}

// ── doc 42 Đợt 4A #1 — import engine: upsert theo `code`, đếm insert/update/lỗi ─
export interface ImportOutcome {
  inserted: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

/** Message 1-dòng thân thiện cho lỗi import (zod / TRPCError / unique / khác). */
function importErrMessage(err: unknown): string {
  if (err instanceof TRPCError) return err.message;
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const field = issue?.path?.join(".");
    return field ? `${field}: ${issue.message}` : (issue?.message ?? "Dữ liệu không hợp lệ");
  }
  if (isUniqueViolation(err)) return "Mã đã tồn tại";
  return err instanceof Error ? err.message : "Lỗi không xác định";
}

/**
 * Nhập một mảng dòng (client đã parse field-keyed + ép kiểu) vào `table`, upsert
 * theo cột unique `code`: đã có → UPDATE, chưa có → INSERT. Mỗi dòng lỗi (zod /
 * ref không tồn tại / constraint) đếm vào `failed` + `errors`, KHÔNG chặn dòng khác.
 */
async function importByCode(
  table: any,
  rows: Array<Record<string, unknown>>,
  schema: z.ZodTypeAny,
  opts: {
    transform?: (v: any) => Record<string, any>;
    validateRefs?: (v: any) => Promise<void>;
  } = {},
): Promise<ImportOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const out: ImportOutcome = { inserted: 0, updated: 0, failed: 0, errors: [] };
  let rowNum = 0;
  for (const raw of rows) {
    rowNum++;
    try {
      const parsed = schema.parse(raw) as Record<string, any>;
      if (opts.validateRefs) await opts.validateRefs(parsed);
      const values = clean(opts.transform ? opts.transform(parsed) : parsed) as Record<string, any>;
      const code = values.code;
      const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.code, code)).limit(1);
      if (existing) {
        const { code: _omitCode, ...patch } = values;
        await db.update(table).set({ ...patch, updatedAt: new Date() }).where(eq(table.id, existing.id));
        out.updated++;
      } else {
        await db.insert(table).values(values);
        out.inserted++;
      }
    } catch (err) {
      out.failed++;
      out.errors.push({ row: rowNum, message: importErrMessage(err) });
    }
  }
  return out;
}

const idInput = z.object({ id: z.number().int().positive() });
/** Input chung cho import: mảng dòng đã parse field-keyed từ client. */
const importInput = z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(5000) });

// ── doc 42 Đợt 4C J1 — mass-actions (xoá / đổi trạng thái hàng loạt) ──────────
/** Kết quả 1 thao tác hàng loạt: đếm ok (deleted|updated) + failed + lỗi từng id. */
export interface BulkOutcome {
  deleted?: number;
  updated?: number;
  failed: number;
  errors: Array<{ id: number; message: string }>;
}
/** Input chung cho mass-action: mảng id (>=1, <=1000 để chặn payload khổng lồ). */
const bulkIdsInput = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });
const bulkSetActiveInput = bulkIdsInput.extend({ isActive: z.boolean() });

/**
 * Xoá hàng loạt theo id. Mỗi id lỗi (FK/constraint) đếm vào failed+errors NHƯNG
 * KHÔNG chặn id khác — trả tổng kết {deleted,failed,errors}. Message lỗi đi qua
 * importErrMessage (ẩn SQL thô, unique → "Mã đã tồn tại").
 */
async function bulkDeleteByIds(table: any, ids: number[]): Promise<BulkOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const out: BulkOutcome = { deleted: 0, failed: 0, errors: [] };
  for (const id of ids) {
    try {
      await db.delete(table).where(eq(table.id, id));
      out.deleted! += 1;
    } catch (err) {
      out.failed += 1;
      out.errors.push({ id, message: importErrMessage(err) });
    }
  }
  return out;
}

/** Bật/tắt isActive hàng loạt theo id (cập nhật updatedAt). Đếm updated/failed như trên. */
async function bulkSetActiveByIds(table: any, ids: number[], isActive: boolean): Promise<BulkOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const out: BulkOutcome = { updated: 0, failed: 0, errors: [] };
  for (const id of ids) {
    try {
      await db.update(table).set({ isActive, updatedAt: new Date() }).where(eq(table.id, id));
      out.updated! += 1;
    } catch (err) {
      out.failed += 1;
      out.errors.push({ id, message: importErrMessage(err) });
    }
  }
  return out;
}

// ─── Suppliers ──────────────────────────────────────────────────────────────
const supplierType = z.enum(["component", "raw_material", "service", "equipment", "subcontractor", "other"]);
const supplierApproval = z.enum(["pending", "approved", "conditional", "rejected", "suspended"]);
const supplierImportSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  type: supplierType.optional(),
  contactName: z.string().max(256).optional(),
  contactEmail: z.string().email().max(320).optional(),
  contactPhone: z.string().max(40).optional(),
  address: z.string().optional(),
  country: z.string().max(80).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  approvalStatus: supplierApproval.optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});
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
      contactEmail: z.string().email().max(320).optional(),
      contactPhone: z.string().max(40).optional(),
      address: z.string().optional(),
      country: z.string().max(80).optional(),
      rating: z.coerce.number().min(0).max(5).optional(),
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
      contactName: z.string().max(256).nullish(),
      contactEmail: z.string().email().max(320).nullish(),
      contactPhone: z.string().max(40).nullish(),
      address: z.string().nullish(),
      country: z.string().max(80).nullish(),
      rating: z.coerce.number().min(0).max(5).nullish(),
      approvalStatus: supplierApproval.optional(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).nullish(),
      factoryCode: z.string().max(50).nullish(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, rating, ...rest } = input;
      return updateOne(suppliers, id, clean({ ...rest, ...(rating != null ? { rating: String(rating) } : {}) }));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(suppliers, input.id)),
  /** Doc 42 Đợt 4C J1 — xoá hàng loạt NCC đã chọn (gate canDelete). */
  bulkDelete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(bulkIdsInput)
    .mutation(({ input }) => bulkDeleteByIds(suppliers, input.ids)),
  /** Doc 42 Đợt 4C J1 — bật/tắt trạng thái hàng loạt NCC đã chọn (gate canEdit). */
  bulkSetActive: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(bulkSetActiveInput)
    .mutation(({ input }) => bulkSetActiveByIds(suppliers, input.ids, input.isActive)),
  /** Doc 42 Đợt 4A #1 — nhập hàng loạt NCC (upsert theo code). */
  importRows: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(importInput)
    .mutation(({ input }) => importByCode(suppliers, input.rows, supplierImportSchema, {
      transform: (v) => {
        const { rating, ...rest } = v;
        return { ...rest, ...(rating != null ? { rating: String(rating) } : {}) };
      },
    })),
  /** Doc 42 Đợt 1 — where-used: đếm số vật liệu trỏ tới supplier qua defaultSupplierCode
   *  (map code→count, dùng cảnh báo tham chiếu mồ côi trước khi xoá). */
  usageCounts: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return {} as Record<string, number>;
      const rows = await db
        .select({ code: materials.defaultSupplierCode, count: sql<number>`count(*)::int` })
        .from(materials)
        .where(isNotNull(materials.defaultSupplierCode))
        .groupBy(materials.defaultSupplierCode);
      const out: Record<string, number> = {};
      for (const r of rows) if (r.code) out[String(r.code)] = Number(r.count);
      return out;
    }),
});

// ─── Material classes + Materials ───────────────────────────────────────────
const materialClassImportSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  parentCode: z.string().max(64).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});
const materialImportSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  materialClass: z.string().max(64).optional(),
  mpn: z.string().max(128).optional(),
  manufacturer: z.string().max(256).optional(),
  packageType: z.string().max(64).optional(),
  msl: z.string().max(8).optional(),
  unit: z.string().max(16).optional(),
  rohs: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});
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
      parentCode: z.string().max(64).nullish(),
      description: z.string().nullish(),
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
  /** Doc 42 Đợt 1 — where-used: đếm số vật liệu thuộc mỗi nhóm vật tư qua
   *  materials.materialClass (map code→count) để cảnh báo tham chiếu trước khi xoá. */
  classUsageCounts: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return {} as Record<string, number>;
      const rows = await db
        .select({ code: materials.materialClass, count: sql<number>`count(*)::int` })
        .from(materials)
        .where(isNotNull(materials.materialClass))
        .groupBy(materials.materialClass);
      const out: Record<string, number> = {};
      for (const r of rows) if (r.code) out[String(r.code)] = Number(r.count);
      return out;
    }),

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
    .mutation(async ({ input }) => {
      // doc 42 Đợt 4A #2 — mã tham chiếu phải TỒN TẠI (chặn đường API trực tiếp).
      await requireRef(input.materialClass, materialClasses, "Nhóm vật tư");
      await requireRef(input.unit, unitsOfMeasure, "Đơn vị");
      return { id: await insertOne(materials, input as InsertMaterial) };
    }),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      materialClass: z.string().max(64).nullish(),
      mpn: z.string().max(128).nullish(),
      manufacturer: z.string().max(256).nullish(),
      packageType: z.string().max(64).nullish(),
      msl: z.string().max(8).nullish(),
      rohs: z.boolean().optional(),
      unit: z.string().max(16).optional(),
      datasheetUrl: z.string().nullish(),
      defaultSupplierCode: z.string().max(64).nullish(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).nullish(),
      factoryCode: z.string().max(50).nullish(),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      // Chỉ validate khi có mã (null = xoá tham chiếu → bỏ qua).
      await requireRef(rest.materialClass, materialClasses, "Nhóm vật tư");
      await requireRef(rest.unit, unitsOfMeasure, "Đơn vị");
      return updateOne(materials, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(materials, input.id)),
  /** Doc 42 Đợt 4C J1 — xoá hàng loạt vật tư đã chọn (gate canDelete). */
  bulkDelete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(bulkIdsInput)
    .mutation(({ input }) => bulkDeleteByIds(materials, input.ids)),
  /** Doc 42 Đợt 4C J1 — bật/tắt trạng thái hàng loạt vật tư đã chọn (gate canEdit). */
  bulkSetActive: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(bulkSetActiveInput)
    .mutation(({ input }) => bulkSetActiveByIds(materials, input.ids, input.isActive)),
  /** Doc 42 Đợt 4A #1 — nhập hàng loạt vật tư (upsert theo code + validate ref). */
  importRows: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(importInput)
    .mutation(({ input }) => importByCode(materials, input.rows, materialImportSchema, {
      validateRefs: async (v) => {
        await requireRef(v.materialClass, materialClasses, "Nhóm vật tư");
        await requireRef(v.unit, unitsOfMeasure, "Đơn vị");
      },
    })),
  /** Doc 42 Đợt 4A #1 — nhập hàng loạt nhóm vật tư (upsert theo code). */
  importClasses: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(importInput)
    .mutation(({ input }) => importByCode(materialClasses, input.rows, materialClassImportSchema)),
});

// ─── Customers ──────────────────────────────────────────────────────────────
const customerImportSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  contactName: z.string().max(256).optional(),
  contactEmail: z.string().email().max(320).optional(),
  contactPhone: z.string().max(40).optional(),
  address: z.string().optional(),
  country: z.string().max(80).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});
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
      contactEmail: z.string().email().max(320).optional(),
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
      contactName: z.string().max(256).nullish(),
      contactEmail: z.string().email().max(320).nullish(),
      contactPhone: z.string().max(40).nullish(),
      address: z.string().nullish(),
      country: z.string().max(80).nullish(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).nullish(),
      factoryCode: z.string().max(50).nullish(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(customers, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(customers, input.id)),
  /** Doc 42 Đợt 4C J1 — xoá hàng loạt khách hàng đã chọn (gate canDelete). */
  bulkDelete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(bulkIdsInput)
    .mutation(({ input }) => bulkDeleteByIds(customers, input.ids)),
  /** Doc 42 Đợt 4C J1 — bật/tắt trạng thái hàng loạt khách hàng đã chọn (gate canEdit). */
  bulkSetActive: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(bulkSetActiveInput)
    .mutation(({ input }) => bulkSetActiveByIds(customers, input.ids, input.isActive)),
  /** Doc 42 Đợt 4A #1 — nhập hàng loạt khách hàng (upsert theo code). */
  importRows: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(importInput)
    .mutation(({ input }) => importByCode(customers, input.rows, customerImportSchema)),
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
      category: z.string().max(64).nullish(),
      description: z.string().nullish(),
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
      notes: z.string().nullish(),
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

// ─── Skill matrix: user × skill certifications (doc 42 Đợt 4B H1) ────────────
// WIRE liên kết chết skill→operator. Bảng user_certifications đã có schema nhưng
// chưa có "skill matrix" view (ai có kỹ năng nào + cảnh báo hết hạn — dữ liệu
// chết theo audit doc 42 §4 workforce). Khác skillsRouter.*Certification ở chỗ:
//   • list JOIN tên user + tên skill NGAY tại server → bảng vẫn hiện tên kể cả
//     khi user.list bị chặn (admin-only), không phải join thủ công phía client.
//   • assign UPSERT theo unique (userId,skillId): gán lại 1 người cho cùng kỹ
//     năng thì cập nhật cấp độ/hạn/ghi-chú thay vì ném lỗi trùng khoá.
//   • revoke = xoá bản ghi (ConfirmDeleteDialog phía UI).
const userCertificationsRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      userId: z.number().int().positive().optional(),
      skillId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [];
      if (input?.userId != null) conds.push(eq(userCertifications.userId, input.userId));
      if (input?.skillId != null) conds.push(eq(userCertifications.skillId, input.skillId));
      const q = db
        .select({
          id: userCertifications.id,
          userId: userCertifications.userId,
          skillId: userCertifications.skillId,
          level: userCertifications.level,
          grantedAt: userCertifications.grantedAt,
          expiresAt: userCertifications.expiresAt,
          certifiedBy: userCertifications.certifiedBy,
          notes: userCertifications.notes,
          isActive: userCertifications.isActive,
          userName: users.name,
          userUsername: users.username,
          skillCode: skills.code,
          skillName: skills.name,
        })
        .from(userCertifications)
        .leftJoin(users, eq(userCertifications.userId, users.id))
        .leftJoin(skills, eq(userCertifications.skillId, skills.id));
      return (conds.length ? q.where(and(...conds)) : q).orderBy(asc(userCertifications.id));
    }),
  assign: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      userId: z.number().int().positive(),
      skillId: z.number().int().positive(),
      level: certLevel.optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const expires = input.expiresAt ? new Date(input.expiresAt) : null;
      const level = input.level ?? "trainee";
      // TRUE upsert on unique (userId,skillId) — INSERT-only would throw on the
      // duplicate-key conflict when re-assigning the same person to a skill.
      const [row] = await withDbErrors(async () => db
        .insert(userCertifications)
        .values({
          userId: input.userId,
          skillId: input.skillId,
          level,
          expiresAt: expires,
          certifiedBy: ctx.user?.id ?? null,
          notes: input.notes ?? null,
          isActive: true,
        } as InsertUserCertification)
        .onConflictDoUpdate({
          target: [userCertifications.userId, userCertifications.skillId],
          set: {
            level,
            expiresAt: expires,
            certifiedBy: ctx.user?.id ?? null,
            notes: input.notes ?? null,
            isActive: true,
            grantedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: userCertifications.id }), { conflictMessage: "Chứng chỉ đã tồn tại" });
      return { id: row.id };
    }),
  revoke: protectedProcedure
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
      machineType: z.string().max(40).nullish(),
      lifeLimit: z.number().int().min(0).nullish(),
      lifeUsed: z.number().int().min(0).optional(),
      status: toolStatus.optional(),
      location: z.string().max(128).nullish(),
      isActive: z.boolean().optional(),
      corporateCode: z.string().max(50).nullish(),
      factoryCode: z.string().max(50).nullish(),
      notes: z.string().nullish(),
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

// ─── Units of Measure (+conversions) ────────────────────────────────────────
const uomDimension = z.enum(["length", "mass", "volume", "time", "temperature", "count", "percent", "other"]);
const uomRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(unitsOfMeasure, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(unitsOfMeasure, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(32),
      name: z.string().min(1).max(128),
      dimension: uomDimension.optional(),
      isBase: z.boolean().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(unitsOfMeasure, input as InsertUnitOfMeasure) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(128).optional(),
      dimension: uomDimension.optional(),
      isBase: z.boolean().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(unitsOfMeasure, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(unitsOfMeasure, input.id)),

  // Conversions (from × factor + offset = to)
  listConversions: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(() => listAll(unitConversions)),
  createConversion: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      fromUomCode: z.string().min(1).max(32),
      toUomCode: z.string().min(1).max(32),
      factor: z.number(),
      offset: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // doc 42 Đợt 4A #2 — cả hai đơn vị quy đổi phải TỒN TẠI trong bảng UoM.
      await requireRef(input.fromUomCode, unitsOfMeasure, "Đơn vị");
      await requireRef(input.toUomCode, unitsOfMeasure, "Đơn vị");
      const { factor, offset, ...rest } = input;
      const id = await insertOne(unitConversions, {
        ...rest,
        factor: String(factor),
        ...(offset != null ? { offset: String(offset) } : {}),
      } as InsertUnitConversion);
      return { id };
    }),
  updateConversion: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      factor: z.number().optional(),
      offset: z.number().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, factor, offset, ...rest } = input;
      return updateOne(unitConversions, id, clean({
        ...rest,
        ...(factor != null ? { factor: String(factor) } : {}),
        ...(offset != null ? { offset: String(offset) } : {}),
      }));
    }),
  deleteConversion: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(unitConversions, input.id)),
});

// ─── Plant / Shift Calendar (+days) ─────────────────────────────────────────
const calendarDayType = z.enum(["working", "holiday", "planned_downtime"]);
const calendarRouter = router({
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(plantCalendars, input?.activeOnly)),
  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(plantCalendars, input.id)),
  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      factoryCode: z.string().max(50).optional(),
      timezone: z.string().max(64).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(plantCalendars, input as InsertPlantCalendar) })),
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      factoryCode: z.string().max(50).nullish(),
      timezone: z.string().max(64).optional(),
      isActive: z.boolean().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(plantCalendars, id, clean(rest));
    }),
  delete: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(plantCalendars, input.id)),

  // Calendar days (working / holiday / planned_downtime)
  listDays: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ calendarId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const q = db.select().from(calendarDays);
      return (input?.calendarId != null
        ? q.where(eq(calendarDays.calendarId, input.calendarId))
        : q).orderBy(asc(calendarDays.date));
    }),
  createDay: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      calendarId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dayType: calendarDayType.optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(calendarDays, input as InsertCalendarDay) })),
  updateDay: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dayType: calendarDayType.optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(calendarDays, id, clean(rest));
    }),
  deleteDay: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(calendarDays, input.id)),

  // ── doc 42 T9 — ca làm việc áp dụng cho từng ngày lịch (junction) ───────────
  // Bảng nối calendar_days ↔ shift_configs: 1 ngày chạy nhiều ca. TÁI DÙNG
  // shift_configs (production.ts) làm nguồn định nghĩa ca — không tạo bảng ca mới.
  /** Danh sách ca (shift_configs) đang bật — để UI chọn gán vào 1 ngày lịch. */
  listShiftConfigs: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(shiftConfigs)
        .where(eq(shiftConfigs.isActive, true))
        .orderBy(asc(shiftConfigs.orderIndex), asc(shiftConfigs.id));
    }),
  /** Ca đã gán cho 1 ngày lịch — JOIN shift_configs để trả kèm mã/tên/giờ ca. */
  listDayShifts: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ calendarDayId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: calendarDayShifts.id,
          calendarDayId: calendarDayShifts.calendarDayId,
          shiftConfigId: calendarDayShifts.shiftConfigId,
          isActive: calendarDayShifts.isActive,
          shiftCode: shiftConfigs.code,
          shiftName: shiftConfigs.name,
          startHour: shiftConfigs.startHour,
          startMinute: shiftConfigs.startMinute,
          endHour: shiftConfigs.endHour,
          endMinute: shiftConfigs.endMinute,
        })
        .from(calendarDayShifts)
        .leftJoin(shiftConfigs, eq(calendarDayShifts.shiftConfigId, shiftConfigs.id))
        .where(eq(calendarDayShifts.calendarDayId, input.calendarDayId))
        .orderBy(asc(shiftConfigs.orderIndex), asc(calendarDayShifts.id));
    }),
  /** Gán 1 ca vào 1 ngày lịch — UPSERT theo unique (calendarDayId,shiftConfigId)
   *  (gán lại ca đã gỡ mềm → bật lại isActive thay vì ném lỗi trùng khoá). */
  assignShift: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      calendarDayId: z.number().int().positive(),
      shiftConfigId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [row] = await withDbErrors(async () => db
        .insert(calendarDayShifts)
        .values({
          calendarDayId: input.calendarDayId,
          shiftConfigId: input.shiftConfigId,
          isActive: true,
        } as InsertCalendarDayShift)
        .onConflictDoUpdate({
          target: [calendarDayShifts.calendarDayId, calendarDayShifts.shiftConfigId],
          set: { isActive: true, updatedAt: new Date() },
        })
        .returning({ id: calendarDayShifts.id }), { conflictMessage: "Ca đã được gán cho ngày này" });
      return { id: row.id };
    }),
  /** Gỡ 1 ca khỏi 1 ngày lịch (theo id bản ghi nối). */
  unassignShift: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(calendarDayShifts, input.id)),
});

// ─── Inventory: Warehouses + Storage locations + Balances ───────────────────
const warehouseType = z.enum(["raw", "wip", "fg", "spare", "other"]);
const storageLocationKind = z.enum(["bin", "shelf", "zone"]);
const inventoryRouter = router({
  // Warehouses
  listWarehouses: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ activeOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listAll(warehouses, input?.activeOnly)),
  getWarehouse: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(warehouses, input.id)),
  createWarehouse: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      factoryCode: z.string().max(50).optional(),
      type: warehouseType.optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(warehouses, input as InsertWarehouse) })),
  updateWarehouse: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      name: z.string().min(1).max(256).optional(),
      factoryCode: z.string().max(50).nullish(),
      type: warehouseType.optional(),
      isActive: z.boolean().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(warehouses, id, clean(rest));
    }),
  deleteWarehouse: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(warehouses, input.id)),

  // Storage locations
  listLocations: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ warehouseId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const q = db.select().from(storageLocations);
      return (input?.warehouseId != null
        ? q.where(eq(storageLocations.warehouseId, input.warehouseId))
        : q).orderBy(asc(storageLocations.id));
    }),
  createLocation: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      warehouseId: z.number().int().positive(),
      code: z.string().min(1).max(64),
      name: z.string().max(256).optional(),
      kind: storageLocationKind.optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => ({ id: await insertOne(storageLocations, input as InsertStorageLocation) })),
  updateLocation: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      code: z.string().min(1).max(64).optional(),
      name: z.string().max(256).nullish(),
      kind: storageLocationKind.optional(),
      isActive: z.boolean().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return updateOne(storageLocations, id, clean(rest));
    }),
  deleteLocation: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(storageLocations, input.id)),

  // Inventory balances
  listBalances: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      materialCode: z.string().max(64).optional(),
      warehouseCode: z.string().max(64).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [];
      if (input?.materialCode != null) conds.push(eq(inventoryBalances.materialCode, input.materialCode));
      if (input?.warehouseCode != null) conds.push(eq(inventoryBalances.warehouseCode, input.warehouseCode));
      const q = db.select().from(inventoryBalances);
      return (conds.length ? q.where(and(...conds)) : q).orderBy(desc(inventoryBalances.updatedAt));
    }),
  getBalance: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(idInput)
    .query(({ input }) => getOne(inventoryBalances, input.id)),
  upsertBalance: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      materialCode: z.string().min(1).max(64),
      warehouseCode: z.string().min(1).max(64),
      locationCode: z.string().max(64).optional(),
      lotCode: z.string().max(64).optional(),
      quantityOnHand: z.number(),
      uomCode: z.string().max(32).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      // doc 42 Đợt 4A #2 — mã vật tư / kho / đơn vị phải TỒN TẠI (chặn mã rác qua API).
      await requireRef(input.materialCode, materials, "Vật tư");
      await requireRef(input.warehouseCode, warehouses, "Kho");
      await requireRef(input.uomCode, unitsOfMeasure, "Đơn vị");
      const { quantityOnHand, ...rest } = input;
      // TRUE upsert on the unique (materialCode,warehouseCode,locationCode,lotCode)
      // index — INSERT-only would throw on the duplicate-key conflict.
      const [row] = await withDbErrors(async () => db
        .insert(inventoryBalances)
        .values({ ...rest, quantityOnHand: String(quantityOnHand) } as InsertInventoryBalance)
        .onConflictDoUpdate({
          target: [
            inventoryBalances.materialCode,
            inventoryBalances.warehouseCode,
            inventoryBalances.locationCode,
            inventoryBalances.lotCode,
          ],
          set: {
            quantityOnHand: String(quantityOnHand),
            ...(rest.uomCode != null ? { uomCode: rest.uomCode } : {}),
            ...(rest.notes != null ? { notes: rest.notes } : {}),
            updatedAt: new Date(),
          },
        })
        .returning({ id: inventoryBalances.id }), { conflictMessage: "Mã đã tồn tại" });
      return { id: row.id };
    }),
  updateBalance: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(idInput.extend({
      quantityOnHand: z.number().optional(),
      uomCode: z.string().max(32).optional(),
      locationCode: z.string().max(64).nullish(),
      lotCode: z.string().max(64).nullish(),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ input }) => {
      const { id, quantityOnHand, ...rest } = input;
      // doc 42 Đợt 4A #2 — nếu đổi đơn vị thì đơn vị mới phải TỒN TẠI.
      await requireRef(rest.uomCode, unitsOfMeasure, "Đơn vị");
      return updateOne(inventoryBalances, id, clean({
        ...rest,
        ...(quantityOnHand != null ? { quantityOnHand: String(quantityOnHand) } : {}),
      }));
    }),
  deleteBalance: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(idInput)
    .mutation(({ input }) => deleteOne(inventoryBalances, input.id)),
});

// ─── doc 42 Đợt 5 K1 — Data-quality dashboard (governance) ───────────────────
// Bảng điều khiển CHẤT LƯỢNG DỮ LIỆU chủ (read-only): với mỗi thực thể master-data
// đếm tổng bản ghi + số bản ghi THIẾU trường quan trọng (email/mã NSX/…) hoặc trỏ
// tham chiếu MỒ CÔI (mã trỏ tới bản ghi cha đã bị xoá — tái dùng ý requireRef). Mỗi
// thực thể = MỘT truy vấn tổng hợp `COUNT(*) FILTER (WHERE …)` (không kéo cả bảng),
// chạy được cả khi bảng rỗng (trả 0). DB offline → [] (fail-safe như toàn router).
export interface QualityIssue {
  /** Mã ổn định (client i18n key). */
  code: string;
  /** Nhãn tiếng Việt (client dùng làm defaultValue). */
  label: string;
  /** Số bản ghi dính vấn đề này. */
  count: number;
}
export interface QualityEntity {
  /** Mã thực thể (khớp tab /master-data để link lọc sẵn). */
  entity: string;
  label: string;
  /** Tổng số bản ghi của thực thể. */
  total: number;
  issues: QualityIssue[];
}

// Doc 54 §11 P0.4b — chất lượng KỸ THUẬT + PHÂN CẤP (điểm đo + mồ côi phân cấp).
/** Một bản ghi vi phạm cụ thể cho "drill list" (giới hạn số lượng). */
export interface QualityDrillSample {
  id: number;
  /** Nhãn hiển thị (mã điểm/máy/trạm/sản phẩm) — client hiện nguyên văn. */
  label: string;
  /** Các mã vấn đề dòng này dính (client i18n qua dataQuality.issue.<entity>.<code>). */
  reasonCodes: string[];
}
/** Thẻ thực thể kèm danh sách drill các bản ghi vi phạm cụ thể. */
export interface QualityEntityExtended extends QualityEntity {
  samples: QualityDrillSample[];
}

/** Lấy 1 dòng tổng hợp đầu tiên (object cột→giá trị) từ kết quả db.execute. */
function firstRow(res: any): Record<string, any> {
  const rows = (res?.rows ?? res) as any[];
  return (Array.isArray(rows) ? rows[0] : undefined) ?? {};
}
/** Lấy TẤT CẢ dòng (mảng object) từ kết quả db.execute — cho drill list. */
function allRows(res: any): Record<string, any>[] {
  const rows = (res?.rows ?? res) as any[];
  return Array.isArray(rows) ? rows : [];
}
const n = (v: unknown) => Number(v ?? 0) || 0;

const qualityRouter = router({
  /** Chỉ số chất lượng dữ liệu cho từng thực thể master-data (canView). */
  summary: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async (): Promise<QualityEntity[]> => {
      const db = await getDb();
      if (!db) return [];

      const [sup, mat, cus, tl, conv] = await Promise.all([
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE s."approvalStatus" = 'pending'))::int AS pending,
            (COUNT(*) FILTER (WHERE s."contactEmail" IS NULL OR s."contactEmail" = ''))::int AS missing_email,
            (COUNT(*) FILTER (WHERE (s."contactName" IS NULL OR s."contactName" = '') AND (s."contactPhone" IS NULL OR s."contactPhone" = '')))::int AS missing_contact
          FROM suppliers s
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE m."materialClass" IS NULL OR m."materialClass" = ''))::int AS missing_class,
            (COUNT(*) FILTER (WHERE m."materialClass" IS NOT NULL AND m."materialClass" <> '' AND NOT EXISTS (SELECT 1 FROM material_classes mc WHERE mc.code = m."materialClass")))::int AS orphan_class,
            (COUNT(*) FILTER (WHERE m."unit" IS NOT NULL AND m."unit" <> '' AND NOT EXISTS (SELECT 1 FROM units_of_measure u WHERE u.code = m."unit")))::int AS orphan_unit,
            (COUNT(*) FILTER (WHERE m."mpn" IS NULL OR m."mpn" = ''))::int AS missing_mpn
          FROM materials m
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE c."contactEmail" IS NULL OR c."contactEmail" = ''))::int AS missing_email,
            (COUNT(*) FILTER (WHERE (c."contactEmail" IS NULL OR c."contactEmail" = '') AND (c."contactName" IS NULL OR c."contactName" = '') AND (c."contactPhone" IS NULL OR c."contactPhone" = '')))::int AS missing_contact
          FROM customers c
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE t."location" IS NULL OR t."location" = ''))::int AS missing_location,
            (COUNT(*) FILTER (WHERE t."type" = 'other'))::int AS untyped
          FROM tools t
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM units_of_measure u WHERE u.code = c."fromUomCode")))::int AS orphan_from,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM units_of_measure u WHERE u.code = c."toUomCode")))::int AS orphan_to
          FROM unit_conversions c
        `),
      ]);

      const rSup = firstRow(sup);
      const rMat = firstRow(mat);
      const rCus = firstRow(cus);
      const rTl = firstRow(tl);
      const rConv = firstRow(conv);

      return [
        {
          entity: "suppliers",
          label: "Nhà cung cấp",
          total: n(rSup.total),
          issues: [
            { code: "pending", label: "Chờ duyệt", count: n(rSup.pending) },
            { code: "missingEmail", label: "Thiếu email liên hệ", count: n(rSup.missing_email) },
            { code: "missingContact", label: "Thiếu người liên hệ & điện thoại", count: n(rSup.missing_contact) },
          ],
        },
        {
          entity: "materials",
          label: "Vật tư / linh kiện",
          total: n(rMat.total),
          issues: [
            { code: "missingClass", label: "Thiếu nhóm vật tư", count: n(rMat.missing_class) },
            { code: "orphanClass", label: "Nhóm vật tư không tồn tại", count: n(rMat.orphan_class) },
            { code: "orphanUnit", label: "Đơn vị không tồn tại", count: n(rMat.orphan_unit) },
            { code: "missingMpn", label: "Thiếu mã nhà sản xuất (MPN)", count: n(rMat.missing_mpn) },
          ],
        },
        {
          entity: "customers",
          label: "Khách hàng",
          total: n(rCus.total),
          issues: [
            { code: "missingEmail", label: "Thiếu email liên hệ", count: n(rCus.missing_email) },
            { code: "missingContact", label: "Thiếu toàn bộ thông tin liên hệ", count: n(rCus.missing_contact) },
          ],
        },
        {
          entity: "tools",
          label: "Dụng cụ / đồ gá",
          total: n(rTl.total),
          issues: [
            { code: "missingLocation", label: "Thiếu vị trí lưu trữ", count: n(rTl.missing_location) },
            { code: "untyped", label: "Chưa phân loại (loại \"khác\")", count: n(rTl.untyped) },
          ],
        },
        {
          entity: "uom",
          label: "Quy đổi đơn vị",
          total: n(rConv.total),
          issues: [
            { code: "orphanFrom", label: "Đơn vị nguồn không tồn tại", count: n(rConv.orphan_from) },
            { code: "orphanTo", label: "Đơn vị đích không tồn tại", count: n(rConv.orphan_to) },
          ],
        },
      ];
    }),

  /**
   * Doc 54 §11 P0.4b — chất lượng KỸ THUẬT + PHÂN CẤP (canView). Điểm đo thiếu
   * ngưỡng / toạ độ tại gốc (0,0) / thiếu componentCode, và các "mồ côi" phân cấp
   * (máy dưới trạm đã ngừng, trạm dưới line đã ngừng, sản phẩm chưa có điểm đo,
   * máy chưa gán sản phẩm). Mỗi thẻ = 1 truy vấn ĐẾM + 1 truy vấn LIMIT lấy mẫu
   * drill (≤25 dòng). DB offline → [] (fail-safe như toàn router).
   */
  engineering: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async (): Promise<QualityEntityExtended[]> => {
      const db = await getDb();
      if (!db) return [];

      const [ptCnt, ptRows, mcCnt, mcRows, stCnt, stRows, pmCnt, pmRows] = await Promise.all([
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE pd."lowerLimit" IS NULL AND pd."upperLimit" IS NULL AND pd."criteria" IS NULL))::int AS no_threshold,
            (COUNT(*) FILTER (WHERE pd."positionX" = 0 AND pd."positionY" = 0))::int AS origin_coord,
            (COUNT(*) FILTER (WHERE pd."componentCode" IS NULL OR pd."componentCode" = ''))::int AS no_component
          FROM measurement_point_defs pd
          WHERE pd."deletedAt" IS NULL AND pd."isActive" = true
        `),
        db.execute(sql`
          SELECT pd.id, pd.code, pd."productModelId" AS pmid,
            CASE WHEN pd."lowerLimit" IS NULL AND pd."upperLimit" IS NULL AND pd."criteria" IS NULL THEN 1 ELSE 0 END AS f_thr,
            CASE WHEN pd."positionX" = 0 AND pd."positionY" = 0 THEN 1 ELSE 0 END AS f_origin,
            CASE WHEN pd."componentCode" IS NULL OR pd."componentCode" = '' THEN 1 ELSE 0 END AS f_comp
          FROM measurement_point_defs pd
          WHERE pd."deletedAt" IS NULL AND pd."isActive" = true
            AND ( (pd."lowerLimit" IS NULL AND pd."upperLimit" IS NULL AND pd."criteria" IS NULL)
               OR (pd."positionX" = 0 AND pd."positionY" = 0)
               OR (pd."componentCode" IS NULL OR pd."componentCode" = '') )
          ORDER BY pd.id
          LIMIT 25
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM stations s WHERE s.id = m."stationId" AND s."isActive" = true)))::int AS no_station,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM product_machine_mappings pmm WHERE pmm."machineId" = m.id AND pmm."isActive" = true)))::int AS no_product
          FROM machines m
          WHERE m."isActive" = true
        `),
        db.execute(sql`
          SELECT m.id, m.code, m.name,
            CASE WHEN NOT EXISTS (SELECT 1 FROM stations s WHERE s.id = m."stationId" AND s."isActive" = true) THEN 1 ELSE 0 END AS f_station,
            CASE WHEN NOT EXISTS (SELECT 1 FROM product_machine_mappings pmm WHERE pmm."machineId" = m.id AND pmm."isActive" = true) THEN 1 ELSE 0 END AS f_product
          FROM machines m
          WHERE m."isActive" = true
            AND ( NOT EXISTS (SELECT 1 FROM stations s WHERE s.id = m."stationId" AND s."isActive" = true)
               OR NOT EXISTS (SELECT 1 FROM product_machine_mappings pmm WHERE pmm."machineId" = m.id AND pmm."isActive" = true) )
          ORDER BY m.id
          LIMIT 25
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM production_lines l WHERE l.id = st."lineId" AND l."isActive" = true)))::int AS no_line
          FROM stations st
          WHERE st."isActive" = true
        `),
        db.execute(sql`
          SELECT st.id, st.code, st.name
          FROM stations st
          WHERE st."isActive" = true
            AND NOT EXISTS (SELECT 1 FROM production_lines l WHERE l.id = st."lineId" AND l."isActive" = true)
          ORDER BY st.id
          LIMIT 25
        `),
        db.execute(sql`
          SELECT
            (COUNT(*))::int AS total,
            (COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM measurement_point_defs pd WHERE pd."productModelId" = pm.id AND pd."deletedAt" IS NULL AND pd."isActive" = true)))::int AS no_points
          FROM product_models pm
          WHERE pm."isActive" = true AND pm."deletedAt" IS NULL
        `),
        db.execute(sql`
          SELECT pm.id, pm.code, pm.name
          FROM product_models pm
          WHERE pm."isActive" = true AND pm."deletedAt" IS NULL
            AND NOT EXISTS (SELECT 1 FROM measurement_point_defs pd WHERE pd."productModelId" = pm.id AND pd."deletedAt" IS NULL AND pd."isActive" = true)
          ORDER BY pm.id
          LIMIT 25
        `),
      ]);

      const rPt = firstRow(ptCnt);
      const rMc = firstRow(mcCnt);
      const rSt = firstRow(stCnt);
      const rPm = firstRow(pmCnt);

      const pointSamples: QualityDrillSample[] = allRows(ptRows).map((r) => {
        const reasonCodes: string[] = [];
        if (n(r.f_thr)) reasonCodes.push("noThreshold");
        if (n(r.f_origin)) reasonCodes.push("originCoord");
        if (n(r.f_comp)) reasonCodes.push("noComponent");
        return { id: n(r.id), label: `${r.code ?? "#" + r.id} · SP#${n(r.pmid)}`, reasonCodes };
      });
      const machineSamples: QualityDrillSample[] = allRows(mcRows).map((r) => {
        const reasonCodes: string[] = [];
        if (n(r.f_station)) reasonCodes.push("noStation");
        if (n(r.f_product)) reasonCodes.push("noProduct");
        return { id: n(r.id), label: `${r.code ?? "#" + r.id}${r.name ? " · " + r.name : ""}`, reasonCodes };
      });
      const stationSamples: QualityDrillSample[] = allRows(stRows).map((r) => ({
        id: n(r.id),
        label: `${r.code ?? "#" + r.id}${r.name ? " · " + r.name : ""}`,
        reasonCodes: ["noLine"],
      }));
      const productSamples: QualityDrillSample[] = allRows(pmRows).map((r) => ({
        id: n(r.id),
        label: `${r.code ?? "#" + r.id}${r.name ? " · " + r.name : ""}`,
        reasonCodes: ["noPoints"],
      }));

      return [
        {
          entity: "points",
          label: "Điểm đo",
          total: n(rPt.total),
          issues: [
            { code: "noThreshold", label: "Không có ngưỡng (dưới/trên/tiêu chí đều trống)", count: n(rPt.no_threshold) },
            { code: "originCoord", label: "Toạ độ tại gốc (0,0)", count: n(rPt.origin_coord) },
            { code: "noComponent", label: "Thiếu mã linh kiện (componentCode)", count: n(rPt.no_component) },
          ],
          samples: pointSamples,
        },
        {
          entity: "machines",
          label: "Máy (phân cấp)",
          total: n(rMc.total),
          issues: [
            { code: "noStation", label: "Trạm cha đã ngừng / không tồn tại", count: n(rMc.no_station) },
            { code: "noProduct", label: "Chưa gán sản phẩm nào", count: n(rMc.no_product) },
          ],
          samples: machineSamples,
        },
        {
          entity: "stations",
          label: "Trạm (phân cấp)",
          total: n(rSt.total),
          issues: [
            { code: "noLine", label: "Dây chuyền cha đã ngừng / không tồn tại", count: n(rSt.no_line) },
          ],
          samples: stationSamples,
        },
        {
          entity: "products",
          label: "Sản phẩm (phân cấp)",
          total: n(rPm.total),
          issues: [
            { code: "noPoints", label: "Chưa có điểm đo nào", count: n(rPm.no_points) },
          ],
          samples: productSamples,
        },
      ];
    }),
});

export const masterDataRouter = router({
  suppliers: suppliersRouter,
  materials: materialsRouter,
  customers: customersRouter,
  skills: skillsRouter,
  userCertifications: userCertificationsRouter,
  tools: toolsRouter,
  uom: uomRouter,
  calendar: calendarRouter,
  inventory: inventoryRouter,
  quality: qualityRouter,
});
