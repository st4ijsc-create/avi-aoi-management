import { publicProcedure, protectedProcedure, router, roleProcedure } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "../db";
import { storagePut } from "../storage";
import { MACHINE_TYPES } from "../constants/machineTypes";
import { requirePermission } from "../_core/accessControl";
import {
  eqGovernEnabled,
  buildSeedTypes,
  resolveType,
} from "../services/standards/deviceTypeRegistry";
// W8-A (doc 27 M13 / doc 29 §4): soft 2-tier capabilities gate + weekly drift scan.
import {
  validateCapabilities,
  toStamp,
  loadDeviceTypeNodes,
  capabilitiesValidationEnforced,
  runCapabilitiesDriftScanNow,
  getCapabilitiesDriftStatus,
} from "../services/standards/capabilitiesValidation";
import { runConformance, subjectFromResolved } from "../services/standards/conformanceTest";
import {
  createAuditContext,
  logCreate,
  logUpdate,
  logDelete,
  logCrudOperation,
  ENTITY_TYPES,
} from "../services/auditTrailService";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import { withDbErrors, rethrowDbError } from "../_core/dbErrors";
import { MACHINE_LIFECYCLE_STATUSES, MACHINE_LIFECYCLE_TRANSITIONS } from "../../drizzle/schema";

// ── Doc 27 Đợt 3 / W3-B — M5 audit helpers ──────────────────────────────────
// EVERY master-data mutation in this file (corporate hierarchy + machines) now
// writes an audit row via auditTrailService (db.createAuditLog / audit_logs —
// same mechanism W1-D used for inspection.bulkAcknowledge). Snapshots are
// DIFF-ONLY (before is picked down to the mutated keys), sanitized by the
// service (apiKey/token/secret → ***REDACTED***) and bounded (no base64 image
// payloads are ever logged — uploads log the storage key only). Machine
// lifecycle transitions ADDITIONALLY go to the append-only control_audit_log
// (control-grade, doc 25 T6).

/** Domain errors from server/db are detected by NAME so tests can mock ../db. */
function isErrorNamed(e: unknown, name: string): boolean {
  return e instanceof Error && e.name === name;
}

/** Pick only `keys` from a row — the diff-only "before" snapshot for logUpdate. */
function pickBefore(row: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const k of keys) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

type AuditableCtx = Parameters<typeof createAuditContext>[0];

/** Audit an action that is not a plain create/update/delete (approve, reject, restore, lifecycle…). */
async function auditAction(
  ctx: AuditableCtx,
  entry: {
    action: string;
    entityType: string;
    entityId?: number | null;
    entityName?: string | null;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await logCrudOperation(createAuditContext(ctx), {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityName: entry.entityName ?? null,
    details: {
      operation: entry.action,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
    },
    status: "success",
  });
}

/**
 * W5-20 (4) — Enforcement nghiệm thu khi tạo máy. Khi EQ_GOVERN_ENABLED bật, kiểm tra
 * machineType có device-type đã xuất bản + đạt conformance. Ở mức CẢNH BÁO (không chặn)
 * — trả về chuỗi cảnh báo để UI hiển thị; không lưu deviceTypeVersion (cần migration).
 */
function commissionGovernanceWarning(machineType: string): string | undefined {
  if (!eqGovernEnabled()) return undefined;
  const resolved = resolveType(machineType, buildSeedTypes());
  if (!resolved) return `No published device type for machineType '${machineType}'`;
  const conf = runConformance(subjectFromResolved(resolved));
  if (!conf.pass) return `Device type '${machineType}' fails conformance: ${conf.violations.map((v) => v.rule).join("; ")}`;
  return undefined;
}

// ============ FACTORY ROUTER ============
export const factoryRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getFactories();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1, "Mã nhà máy là bắt buộc").max(50),
      name: z.string().min(1, "Tên nhà máy là bắt buộc").max(255),
      description: z.string().optional(),
      address: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await withDbErrors(() => db.createFactory(input), { conflictMessage: `Mã nhà máy '${input.code}' đã tồn tại` });
      await logCreate(createAuditContext(ctx), ENTITY_TYPES.FACTORY, id, input.name, input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      address: z.string().optional(),
      isActive: z.boolean().optional(),
      mapPositionX: z.number().min(0).max(1).optional(),
      mapPositionY: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, mapPositionX, mapPositionY, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (mapPositionX !== undefined) data.mapPositionX = mapPositionX.toString();
      if (mapPositionY !== undefined) data.mapPositionY = mapPositionY.toString();
      const before = await db.getFactoryById(id);
      await withDbErrors(() => db.updateFactory(id, data), { conflictMessage: "Mã nhà máy đã tồn tại" });
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.FACTORY, id, before?.name ?? `factory#${id}`, pickBefore(before, Object.keys(data)), data);
      return { success: true };
    }),

  updateMapPosition: adminProcedure
    .input(z.object({
      id: z.number(),
      mapPositionX: z.number().min(0).max(1),
      mapPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateFactory(input.id, {
        mapPositionX: input.mapPositionX.toString(),
        mapPositionY: input.mapPositionY.toString(),
      });
      await auditAction(ctx, {
        action: "update", entityType: ENTITY_TYPES.FACTORY, entityId: input.id,
        metadata: { mapPositionX: input.mapPositionX, mapPositionY: input.mapPositionY },
      });
      return { success: true };
    }),

  // W6-25 — Upload ảnh nền mặt bằng (CAD/ảnh). Gated machine_control/canEdit như layout máy.
  // Mẫu theo machine.uploadImage: nhận base64, đẩy storagePut, lưu url+key vào factory.
  uploadFloorPlan: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      imageData: z.string(), // base64
      fileName: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, imageData, fileName, contentType } = input;
      const buffer = Buffer.from(imageData, "base64");
      const fileKey = `factories/${id}/floorplan-${Date.now()}-${fileName}`;
      const { url } = await storagePut(fileKey, buffer, contentType);
      await db.updateFactory(id, { floorPlanImageUrl: url, floorPlanImageKey: fileKey });
      // M5: metadata only — NEVER the base64 payload.
      await auditAction(ctx, {
        action: "update", entityType: ENTITY_TYPES.FACTORY, entityId: id,
        metadata: { uploaded: "floorPlanImage", fileKey },
      });
      return { url, key: fileKey };
    }),

  // W6-25 — Kích thước sàn thật (mét) + tuỳ chọn xoá ảnh nền. Gated machine_control/canEdit.
  updateFloorDims: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      floorWidthM: z.number().positive().max(10000).optional(),
      floorDepthM: z.number().positive().max(10000).optional(),
      clearImage: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, floorWidthM, floorDepthM, clearImage } = input;
      const data: Record<string, unknown> = {};
      if (floorWidthM !== undefined) data.floorWidthM = floorWidthM.toString();
      if (floorDepthM !== undefined) data.floorDepthM = floorDepthM.toString();
      if (clearImage) { data.floorPlanImageUrl = null; data.floorPlanImageKey = null; }
      const before = await db.getFactoryById(id);
      await db.updateFactory(id, data);
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.FACTORY, id, before?.name ?? `factory#${id}`, pickBefore(before, Object.keys(data)), data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.getFactoryById(input.id);
      if (input.cascade) {
        await db.cascadeDeleteFactory(input.id);
      } else {
        await db.deleteFactory(input.id);
      }
      await logDelete(createAuditContext(ctx), ENTITY_TYPES.FACTORY, input.id, before?.name ?? `factory#${input.id}`,
        { code: before?.code, name: before?.name }, { cascade: input.cascade === true });
      return { success: true };
    }),

  cascadeInfo: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryCascadeInfo(input.id);
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedFactories();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.restoreFactory(input.id);
      await auditAction(ctx, { action: "factory.restore", entityType: ENTITY_TYPES.FACTORY, entityId: input.id });
      return { success: true };
    }),
});

// ============ FACTORY ZONE ROUTER (W6-25) ============
// Vùng polygon vẽ trên mặt bằng. Đọc mở cho user đăng nhập; ghi phải machine_control/canEdit.
const zonePointsSchema = z.array(z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})).max(200);

export const factoryZoneRouter = router({
  listByFactory: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryZones(input.factoryId);
    }),

  create: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      factoryId: z.number(),
      name: z.string().min(1).max(120),
      color: z.string().min(1).max(24).optional(),
      points: zonePointsSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createFactoryZone({
        factoryId: input.factoryId,
        name: input.name,
        color: input.color ?? "#0ea5e9",
        points: input.points ?? [],
      });
      await auditAction(ctx, {
        action: "create", entityType: "factory_zone", entityId: id, entityName: input.name,
        metadata: { factoryId: input.factoryId, pointCount: input.points?.length ?? 0 },
      });
      return { id };
    }),

  update: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(120).optional(),
      color: z.string().min(1).max(24).optional(),
      points: zonePointsSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      await db.updateFactoryZone(id, rest);
      await auditAction(ctx, {
        action: "update", entityType: "factory_zone", entityId: id,
        metadata: { name: rest.name, color: rest.color, pointCount: rest.points?.length },
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteFactoryZone(input.id);
      await auditAction(ctx, { action: "delete", entityType: "factory_zone", entityId: input.id });
      return { success: true };
    }),
});

// ============ WORKSHOP ROUTER ============
export const workshopRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getWorkshops();
  }),

  listByFactory: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .query(async ({ input }) => {
      return db.getWorkshopsByFactory(input.factoryId);
    }),

  create: adminProcedure
    .input(z.object({
      factoryId: z.number({ error: "Vui lòng chọn nhà máy" }),
      code: z.string().min(1, "Mã xưởng là bắt buộc").max(50),
      name: z.string().min(1, "Tên xưởng là bắt buộc").max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await withDbErrors(() => db.createWorkshop(input), { conflictMessage: `Mã xưởng '${input.code}' đã tồn tại` });
      await logCreate(createAuditContext(ctx), ENTITY_TYPES.WORKSHOP, id, input.name, input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      factoryId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const before = await db.getWorkshopById(id);
      await db.updateWorkshop(id, data);
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.WORKSHOP, id, before?.name ?? `workshop#${id}`, pickBefore(before, Object.keys(data)), data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.getWorkshopById(input.id);
      if (input.cascade) {
        await db.cascadeDeleteWorkshop(input.id);
      } else {
        await db.deleteWorkshop(input.id);
      }
      await logDelete(createAuditContext(ctx), ENTITY_TYPES.WORKSHOP, input.id, before?.name ?? `workshop#${input.id}`,
        { code: before?.code, name: before?.name }, { cascade: input.cascade === true });
      return { success: true };
    }),

  cascadeInfo: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getWorkshopCascadeInfo(input.id);
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedWorkshops();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.restoreWorkshop(input.id);
      await auditAction(ctx, { action: "workshop.restore", entityType: ENTITY_TYPES.WORKSHOP, entityId: input.id });
      return { success: true };
    }),
});

// ============ PRODUCTION LINE ROUTER ============
export const lineRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getProductionLines();
  }),

  listByWorkshop: protectedProcedure
    .input(z.object({ workshopId: z.number() }))
    .query(async ({ input }) => {
      return db.getProductionLinesByWorkshop(input.workshopId);
    }),

  create: adminProcedure
    .input(z.object({
      workshopId: z.number({ error: "Vui lòng chọn xưởng" }),
      code: z.string().min(1, "Mã line là bắt buộc").max(50),
      name: z.string().min(1, "Tên line là bắt buộc").max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await withDbErrors(() => db.createProductionLine(input), { conflictMessage: `Mã line '${input.code}' đã tồn tại` });
      await logCreate(createAuditContext(ctx), ENTITY_TYPES.LINE, id, input.name, input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      workshopId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const before = await db.getLineById(id);
      await db.updateProductionLine(id, data);
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.LINE, id, before?.name ?? `line#${id}`, pickBefore(before, Object.keys(data)), data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.getLineById(input.id);
      if (input.cascade) {
        await db.cascadeDeleteLine(input.id);
      } else {
        await db.deleteProductionLine(input.id);
      }
      await logDelete(createAuditContext(ctx), ENTITY_TYPES.LINE, input.id, before?.name ?? `line#${input.id}`,
        { code: before?.code, name: before?.name }, { cascade: input.cascade === true });
      return { success: true };
    }),

  cascadeInfo: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getLineCascadeInfo(input.id);
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedLines();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.restoreLine(input.id);
      await auditAction(ctx, { action: "line.restore", entityType: ENTITY_TYPES.LINE, entityId: input.id });
      return { success: true };
    }),
});

// ============ STATION ROUTER ============
export const stationRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getStations();
  }),

  listByLine: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ input }) => {
      return db.getStationsByLine(input.lineId);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number({ error: "Vui lòng chọn line" }),
      code: z.string().min(1, "Mã trạm là bắt buộc").max(50),
      name: z.string().min(1, "Tên trạm là bắt buộc").max(255),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await withDbErrors(() => db.createStation(input), { conflictMessage: `Mã trạm '${input.code}' đã tồn tại` });
      await logCreate(createAuditContext(ctx), ENTITY_TYPES.STATION, id, input.name, input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      lineId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const before = await db.getStationById(id);
      await db.updateStation(id, data);
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.STATION, id, before?.name ?? `station#${id}`, pickBefore(before, Object.keys(data)), data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.getStationById(input.id);
      if (input.cascade) {
        await db.cascadeDeleteStation(input.id);
      } else {
        await db.deleteStation(input.id);
      }
      await logDelete(createAuditContext(ctx), ENTITY_TYPES.STATION, input.id, before?.name ?? `station#${input.id}`,
        { code: before?.code, name: before?.name }, { cascade: input.cascade === true });
      return { success: true };
    }),

  cascadeInfo: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getStationCascadeInfo(input.id);
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedStations();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.restoreStation(input.id);
      await auditAction(ctx, { action: "station.restore", entityType: ENTITY_TYPES.STATION, entityId: input.id });
      return { success: true };
    }),
});

// ============ MACHINE ROUTER ============

// ── Doc 27 W2-C — gap M4 (throttle + validate parts ONLY; full lifecycle = Đợt 3) ──
// The public `register` endpoint had no rate limit and hardcoded stationId: 1
// (which may not even exist) → orphan rows / pending-queue DoS. This adds:
//   • per-IP fixed-window throttle (MACHINE_REGISTER_RATE_LIMIT_PER_HOUR, default 20/h; 0 = off)
//   • a global pending-registration cap  (MACHINE_REGISTER_PENDING_CAP, default 200; 0 = off)
//   • the default station is RESOLVED via the (previously unused) db.getDefaultStation()
//     and validated to exist instead of assuming id 1.
const registerIpWindows = new Map<string, { start: number; count: number }>();
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

function registerRateLimitPerHour(): number {
  const n = parseInt(process.env.MACHINE_REGISTER_RATE_LIMIT_PER_HOUR || "20", 10);
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

function registerPendingCap(): number {
  const n = parseInt(process.env.MACHINE_REGISTER_PENDING_CAP || "200", 10);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

function enforceRegisterThrottle(ip: string | undefined | null): void {
  const limit = registerRateLimitPerHour();
  if (limit <= 0) return;
  const key = ip && ip.length > 0 ? ip : "unknown";
  const now = Date.now();
  const win = registerIpWindows.get(key);
  if (!win || now - win.start >= REGISTER_WINDOW_MS) {
    registerIpWindows.set(key, { start: now, count: 1 });
    if (registerIpWindows.size > 10_000) {
      for (const [k, v] of registerIpWindows) {
        if (now - v.start >= REGISTER_WINDOW_MS) registerIpWindows.delete(k);
      }
    }
    return;
  }
  win.count += 1;
  if (win.count > limit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many machine registrations from this address (limit ${limit}/hour)`,
    });
  }
}

/** Test helper — clears the per-IP registration throttle windows. */
export function _resetRegisterThrottle(): void {
  registerIpWindows.clear();
}

export const machineRouter = router({
  // ============ MACHINE SYNC APIs (Public - cho AOI/AVI) ============

  // Đăng ký máy từ AOI/AVI (không cần APIKey)
  register: publicProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      machineType: z.enum(MACHINE_TYPES),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      firmwareVersion: z.string().optional(),
      syncMode: z.enum(["online", "offline"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // M4: per-IP throttle on this public endpoint (create AND update paths).
      enforceRegisterThrottle((ctx as { req?: { ip?: string } })?.req?.ip);

      // Tìm máy theo serialNumber (M3: ACTIVE rows only — tombstones are never resurrected here)
      const existing = await db.getMachineBySerialNumber(input.serialNumber);
      if (existing) {
        // M2: a decommissioned/retired asset must NOT silently re-enter the
        // approval queue — re-commissioning is an explicit admin decision.
        const lifecycle = (existing as { lifecycleStatus?: string | null }).lifecycleStatus;
        if (lifecycle === "retired" || lifecycle === "decommissioned") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Machine '${existing.code}' is ${lifecycle} — an admin must re-commission it before it can register again`,
          });
        }
        // Nếu đã có, cập nhật thông tin (trừ APIKey)
        await db.updateMachine(existing.id, {
          name: input.name,
          machineType: input.machineType,
          model: input.model,
          manufacturer: input.manufacturer,
          firmwareVersion: input.firmwareVersion,
          serialNumber: input.serialNumber,
          syncMode: input.syncMode || "online",
          registrationStatus: "pending",
        });
        await auditAction(ctx as AuditableCtx, {
          action: "machine.register", entityType: ENTITY_TYPES.MACHINE, entityId: existing.id, entityName: existing.code,
          metadata: { mode: "updated", serialNumber: input.serialNumber, machineType: input.machineType },
        });
        return { id: existing.id, registrationStatus: "pending", message: "Machine info updated, awaiting approval" };
      }

      // M4: global pending cap — an unauthenticated flood must not grow the
      // approval queue unbounded.
      const cap = registerPendingCap();
      if (cap > 0) {
        const pending = await db.getPendingMachines();
        if (Array.isArray(pending) && pending.length >= cap) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Registration queue is full (${cap} pending machines) — ask an admin to approve/reject pending registrations first`,
          });
        }
      }

      // M4: resolve + validate the default station instead of hardcoding id 1.
      const defaultStation = await db.getDefaultStation();
      if (!defaultStation) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active station configured — create the factory hierarchy before registering machines",
        });
      }

      // M7: the generated SN-code can collide with an ACTIVE machine that has a
      // different serial. Policy (documented): RETRY WITH A NUMERIC SUFFIX (an
      // unattended machine must not dead-end on a name clash — the admin
      // normalises the code at approval anyway); only after 5 attempts → CONFLICT.
      let code = `SN-${input.serialNumber}`;
      if (await db.getMachineByCode(code)) {
        let resolved: string | undefined;
        for (let i = 2; i <= 5 && !resolved; i++) {
          const candidate = `SN-${input.serialNumber}-${i}`;
          if (!(await db.getMachineByCode(candidate))) resolved = candidate;
        }
        if (!resolved) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Machine code '${code}' (and suffixed variants) are already in use by active machines — contact an admin`,
          });
        }
        code = resolved;
      }

      // Tạo mới máy với trạng thái pending, chưa có APIKey.
      // M2: register flow starts life as 'commissioning' (admin approval advances it to 'active').
      try {
        const id = await db.createMachine({
          code,
          name: input.name,
          machineType: input.machineType,
          model: input.model,
          manufacturer: input.manufacturer,
          firmwareVersion: input.firmwareVersion,
          serialNumber: input.serialNumber,
          syncMode: input.syncMode || "online",
          registrationStatus: "pending",
          lifecycleStatus: "commissioning",
          stationId: defaultStation.id, // Station mặc định THẬT — admin sẽ mapping lại sau
        });
        await auditAction(ctx as AuditableCtx, {
          action: "machine.register", entityType: ENTITY_TYPES.MACHINE, entityId: id, entityName: code,
          metadata: { mode: "created", serialNumber: input.serialNumber, machineType: input.machineType, stationId: defaultStation.id },
        });
        return { id, registrationStatus: "pending", message: "Machine registered, awaiting admin approval" };
      } catch (e) {
        // Concurrent register racing the pre-check — clean CONFLICT, not a raw 500.
        if (isErrorNamed(e, "MachineCodeCollisionError")) {
          throw new TRPCError({ code: "CONFLICT", message: (e as Error).message });
        }
        throw e;
      }
    }),

  // Lấy cấu hình máy (trả về mapping, APIKey, trạng thái, ...)
  config: publicProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(100),
    }))
    .query(async ({ input }) => {
      const machine = await db.getMachineBySerialNumber(input.serialNumber);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found. Please call register first." });

      const station = await db.getStationById(machine.stationId);
      const line = await db.getLineByStationId(machine.stationId);

      return {
        machineId: machine.id,
        name: machine.name,
        code: machine.code,
        serialNumber: machine.serialNumber || input.serialNumber,
        apiKey: machine.registrationStatus === "approved" ? machine.apiKey : null, // Chỉ trả APIKey nếu đã duyệt
        machineType: machine.machineType,
        model: machine.model,
        manufacturer: machine.manufacturer,
        firmwareVersion: machine.firmwareVersion,
        registrationStatus: machine.registrationStatus,
        syncMode: machine.syncMode,
        stationId: machine.stationId,
        description: machine.description,
        lastSyncAt: machine.lastSyncAt,
        isApproved: machine.registrationStatus === "approved",
        mapping: {
          station: station ? { id: station.id, code: station.code, name: station.name } : null,
          line: line ? { id: line.id, code: line.code, name: line.name } : null,
        },
      };
    }),

  // ============ ADMIN: Quản lý đăng ký máy ============

  // Danh sách máy chờ duyệt
  listPending: adminProcedure
    .query(async () => {
      return db.getPendingMachines();
    }),

  // Admin duyệt máy + mapping
  approve: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),     // Đặt lại mã máy chuẩn hoá
      name: z.string().min(1).max(255).optional(),     // Đổi tên máy
      stationId: z.number().optional(),                // Gán vào station/line
    }))
    .mutation(async ({ input, ctx }) => {
      const machine = await db.getMachineById(input.id);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });

      // M7: the admin may normalise the code at approval — pre-check it against
      // ACTIVE machines so the rename fails as a clean CONFLICT, not a raw 500.
      if (input.code && input.code !== machine.code) {
        const holder = await db.getMachineByCode(input.code);
        if (holder && holder.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Machine code '${input.code}' is already in use by machine #${holder.id} (${holder.name})`,
          });
        }
      }

      // Sinh APIKey nếu chưa có
      const apiKey = machine.apiKey || `mach_${nanoid(32)}`;

      await db.approveMachine(input.id, {
        code: input.code || machine.code,
        name: input.name || machine.name,
        stationId: input.stationId || machine.stationId,
        apiKey,
      });

      // M5: audit — snapshots NEVER include the apiKey.
      await auditAction(ctx, {
        action: "machine.approve", entityType: ENTITY_TYPES.MACHINE, entityId: input.id, entityName: input.code || machine.code,
        before: { code: machine.code, name: machine.name, stationId: machine.stationId, registrationStatus: machine.registrationStatus },
        after: { code: input.code || machine.code, name: input.name || machine.name, stationId: input.stationId || machine.stationId, registrationStatus: "approved" },
      });

      return { success: true, apiKey, message: "Machine approved and mapped" };
    }),

  // Admin từ chối máy
  reject: adminProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.rejectMachine(input.id, input.reason);
      await auditAction(ctx, {
        action: "machine.reject", entityType: ENTITY_TYPES.MACHINE, entityId: input.id,
        metadata: { reason: input.reason ?? null },
      });
      return { success: true, message: "Machine registration rejected" };
    }),

  list: protectedProcedure.query(async () => {
    // Doc 42 (theme 10) — KHÔNG trả apiKey trong list (kể cả admin); màn hình
    // cần key dùng endpoint theo-máy (getById/approve/regenerateApiKey).
    const rows = await db.getMachines();
    return rows.map(({ apiKey: _apiKey, ...rest }) => rest);
  }),

  // ── Doc 27 Đợt 5 / W5-E — gap F9: server-side search + pagination ────────
  // `list` above stays a full list (30+ consumers); this is the paged variant
  // used by MachineRegistration. Bounded: default 50, hard max 200.
  listPaged: protectedProcedure
    .input(z.object({
      search: z.string().trim().max(100).optional(),
      registrationStatus: z.enum(["pending", "approved", "rejected", "unmapped"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).default({ limit: 50, offset: 0 }))
    .query(async ({ input }) => {
      return db.getMachinesPaged(input);
    }),

  // F9 — registration-status counts for the summary cards (replaces counting a
  // full client-side list).
  registrationSummary: protectedProcedure.query(async () => {
    return db.getMachineRegistrationSummary();
  }),

  // ── Doc 27 Đợt 5 / W5-E — gap F3: onboarding duplicate-code pre-check ────
  // Đợt-3 partial-unique semantics (uq_machines_code_active): only ACTIVE
  // machines hold a code — getMachineByCode already filters isActive, so a
  // soft-deleted tombstone does NOT block reuse. This is advisory (the create
  // path still enforces CONFLICT server-side on the race).
  checkCode: protectedProcedure
    .input(z.object({
      code: z.string().trim().min(1).max(50),
      /** When editing an existing machine, its own code is not a conflict. */
      excludeId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const holder = await db.getMachineByCode(input.code);
      if (!holder || (input.excludeId !== undefined && holder.id === input.excludeId)) {
        return { available: true as const, holder: null };
      }
      return {
        available: false as const,
        holder: { id: holder.id, code: holder.code, name: holder.name },
      };
    }),

  listByStation: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .query(async ({ input }) => {
      return db.getMachinesByStation(input.stationId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMachineById(input.id);
    }),

  getStats: protectedProcedure
    .input(z.object({
      id: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getMachineStats(input.id, input.startDate, input.endDate);
    }),

  // Doc 40 W1 (Minh-P1) — role-floor: engineer/supervisor may ONBOARD (create) a
  // machine (master-data write, not device actuation). NB: update/delete/regenerateApiKey
  // vẫn adminProcedure (admin-only) — cố ý để onboarding mở nhưng sửa/xoá vòng đời vẫn
  // do admin; nếu cần nhất quán thì mở cùng role-floor ở đợt sau (QA-1b ghi nhận).
  create: roleProcedure("admin", "supervisor", "engineer")
    .input(z.object({
      stationId: z.number({ error: "Vui lòng chọn trạm" }),
      code: z.string().min(1, "Mã máy là bắt buộc").max(50),
      name: z.string().min(1, "Tên máy là bắt buộc").max(255),
      machineType: z.enum(MACHINE_TYPES),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
      // Doc 40 W1 (Tuấn-P0, 0238) — địa chỉ kết nối từ onboarding wizard. Optional
      // để không phá caller cũ; lưu thẳng vào bản ghi máy qua createMachine(...input).
      ipAddress: z.string().min(1).max(45).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      connectionProtocol: z.enum(["websocket", "tcp", "http"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // M7: pre-check duplicate code among ACTIVE machines → clean CONFLICT
      // instead of a raw 500 from the unique index.
      const dup = await db.getMachineByCode(input.code);
      if (dup) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Mã máy '${input.code}' đã được dùng bởi máy #${dup.id} (${dup.name})`,
        });
      }

      const governanceWarning = commissionGovernanceWarning(input.machineType);
      const apiKey = `mach_${nanoid(32)}`;
      try {
        const id = await db.createMachine({ ...input, apiKey });
        // M5: audit the created payload (input carries no secrets; the generated
        // apiKey is deliberately NOT logged).
        await logCreate(createAuditContext(ctx), ENTITY_TYPES.MACHINE, id, input.name, { ...input });
        return { id, apiKey, governanceWarning };
      } catch (e) {
        if (isErrorNamed(e, "MachineCodeCollisionError")) {
          throw new TRPCError({ code: "CONFLICT", message: (e as Error).message });
        }
        rethrowDbError(e, { conflictMessage: `Mã máy '${input.code}' đã tồn tại` });
      }
    }),

  regenerateApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const apiKey = `mach_${nanoid(32)}`;
      const dbInstance = await db.getDb();
      if (!dbInstance) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const { machines } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.update(machines).set({ apiKey }).where(eq(machines.id, input.id));
      // M5: record THAT the key rotated — never the key value.
      await auditAction(ctx, { action: "machine.regenerateApiKey", entityType: ENTITY_TYPES.MACHINE, entityId: input.id });
      return { apiKey };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
      registrationStatus: z.enum(["pending", "approved", "rejected", "unmapped"]).optional(),
      syncMode: z.enum(["online", "offline"]).optional(),
      serialNumber: z.string().optional(),
      firmwareVersion: z.string().optional(),
      apiKey: z.string().optional(), // Cho phép admin mapping/gán APIKey
      // W8-A (M13): capability flags. When present the payload is validated
      // against the deviceTypes attributesSchema contract (doc 29 §4.2) —
      // warning-only by default; CAPABILITIES_VALIDATION_ENFORCED rejects on
      // required-attribute violations. null clears the payload + stamp.
      capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, capabilities, ...data } = input;
      const before = await db.getMachineById(id);

      // ── M13 tier-1/tier-2 soft gate (only when the caller touches capabilities) ──
      let capabilitiesValidation: ReturnType<typeof toStamp> | null | undefined;
      if (capabilities !== undefined) {
        if (!before) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
        }
        if (capabilities === null) {
          capabilitiesValidation = null; // cleared payload → cleared stamp
        } else {
          const nodes = await loadDeviceTypeNodes();
          const result = validateCapabilities(before.machineType, capabilities, nodes);
          if (capabilitiesValidationEnforced() && result.blockingErrors.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                `Capabilities rejected (CAPABILITIES_VALIDATION_ENFORCED): required attribute(s) invalid — ` +
                result.blockingErrors.map((e) => `${e.path} (expected ${e.expected}, got ${e.got})`).join("; "),
            });
          }
          capabilitiesValidation = toStamp(result, "save");
        }
      }

      const patch = {
        ...data,
        ...(capabilities !== undefined ? { capabilities, capabilitiesValidation } : {}),
      } as Parameters<typeof db.updateMachine>[1];
      await db.updateMachine(id, patch);
      // M5: diff-only snapshot; auditTrailService sanitises apiKey → ***REDACTED***.
      await logUpdate(createAuditContext(ctx), ENTITY_TYPES.MACHINE, id, before?.code ?? `machine#${id}`, pickBefore(before, Object.keys(patch)), patch as Record<string, unknown>);
      return {
        success: true,
        // Additive: surfaces the tier-1 warning payload to the caller/UI.
        ...(capabilitiesValidation !== undefined ? { capabilitiesValidation } : {}),
      };
    }),

  // ── W8-A (doc 27 M13 / doc 29 §4.2) — capabilities validation surface ───────
  /** Stored stamp + a FRESH re-check of a machine's capabilities vs its device type. */
  checkCapabilities: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const machine = await db.getMachineById(input.id);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
      const nodes = await loadDeviceTypeNodes();
      const fresh = validateCapabilities(machine.machineType, (machine as { capabilities?: unknown }).capabilities ?? null, nodes);
      return {
        machineId: machine.id,
        machineType: machine.machineType,
        enforced: capabilitiesValidationEnforced(),
        stored: (machine as { capabilitiesValidation?: unknown }).capabilitiesValidation ?? null,
        fresh,
      };
    }),

  /** Tier-2 weekly drift report — status + last run (admin). */
  capabilitiesDriftStatus: adminProcedure.query(() => getCapabilitiesDriftStatus()),

  /** Run the drift scan on demand (admin; re-stamps machines that declare capabilities). */
  runCapabilitiesDriftScan: adminProcedure.mutation(async ({ ctx }) => {
    const report = await runCapabilitiesDriftScanNow();
    await auditAction(ctx, {
      action: "machine.capabilitiesDriftScan",
      entityType: ENTITY_TYPES.MACHINE,
      metadata: {
        machinesChecked: report.machinesChecked,
        drifted: report.drifted.length,
        unmappedMachineTypes: report.unmappedMachineTypes,
      },
    });
    return report;
  }),

  // Upload machine image
  uploadImage: adminProcedure
    .input(z.object({
      id: z.number(),
      imageType: z.enum(["2D", "3D"]),
      imageData: z.string(), // Base64 encoded image
      fileName: z.string(),
      contentType: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, imageType, imageData, fileName, contentType } = input;

      // Convert base64 to buffer
      const buffer = Buffer.from(imageData, 'base64');

      // Generate unique file key
      const fileKey = `machines/${id}/${imageType.toLowerCase()}-${Date.now()}-${fileName}`;

      // Upload to S3
      const { url } = await storagePut(fileKey, buffer, contentType);

      // Update machine record
      const updateData = imageType === "2D"
        ? { image2DUrl: url, image2DKey: fileKey }
        : { image3DUrl: url, image3DKey: fileKey };

      await db.updateMachine(id, updateData);
      // M5: metadata only — NEVER the base64 payload.
      await auditAction(ctx, {
        action: "update", entityType: ENTITY_TYPES.MACHINE, entityId: id,
        metadata: { uploaded: `image${imageType}`, fileKey },
      });

      return { url, key: fileKey };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // M3: soft-delete keeps the code as a tombstone (partial unique index
      // frees it for re-registration) and force-stamps lifecycle 'retired'.
      const before = await db.getMachineById(input.id);
      await db.deleteMachine(input.id);
      await logDelete(createAuditContext(ctx), ENTITY_TYPES.MACHINE, input.id, before?.code ?? `machine#${input.id}`, {
        code: before?.code, name: before?.name, stationId: before?.stationId,
        lifecycleStatus: (before as { lifecycleStatus?: string } | undefined)?.lifecycleStatus,
      });
      return { success: true };
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedMachines();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // M3: restoring a tombstone whose code was reused by a newer active
      // machine is a CONFLICT (clear message from db.restoreMachine).
      try {
        await db.restoreMachine(input.id);
      } catch (e) {
        if (isErrorNamed(e, "MachineCodeCollisionError")) {
          throw new TRPCError({ code: "CONFLICT", message: (e as Error).message });
        }
        if (e instanceof Error && e.message === "Machine not found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
        }
        throw e;
      }
      await auditAction(ctx, {
        action: "machine.restore", entityType: ENTITY_TYPES.MACHINE, entityId: input.id,
        // db.restoreMachine lands the asset on 'decommissioned' (excluded from
        // auto-assign) until someone re-commissions it — record that fact.
        after: { isActive: true, lifecycleStatus: "decommissioned" },
      });
      return { success: true };
    }),

  // ── Doc 27 Đợt 3 / W3-B — gap M2: asset lifecycle transition ──────────────
  // RBAC per existing patterns in this router: machine_control/canEdit module
  // permission (admin always passes; engineers get the module grant).
  // A reason is MANDATORY for decommissioned/retired. Illegal transitions →
  // CONFLICT. Writes BOTH audit_logs (master-data trail, M5) and the
  // append-only control_audit_log (control-grade event).
  setLifecycleStatus: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      status: z.enum(MACHINE_LIFECYCLE_STATUSES),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if ((input.status === "decommissioned" || input.status === "retired") && !input.reason?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A reason is required when decommissioning or retiring a machine",
        });
      }

      let result: Awaited<ReturnType<typeof db.transitionMachineLifecycle>>;
      try {
        result = await db.transitionMachineLifecycle(input.id, input.status);
      } catch (e) {
        if (isErrorNamed(e, "LifecycleTransitionError")) {
          throw new TRPCError({ code: "CONFLICT", message: (e as Error).message });
        }
        if (e instanceof Error && e.message === "Machine not found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
        }
        throw e;
      }

      await auditAction(ctx, {
        action: "machine.setLifecycleStatus", entityType: ENTITY_TYPES.MACHINE,
        entityId: input.id, entityName: result.after.code,
        before: { lifecycleStatus: result.before.lifecycleStatus },
        after: { lifecycleStatus: result.after.lifecycleStatus },
        metadata: { reason: input.reason ?? null },
      });

      // Control-grade append-only ledger (doc 25 T6 mechanism).
      const dbInstance = await db.getDb();
      if (dbInstance) {
        await recordAuditEvent(dbInstance, {
          entityType: "machine",
          entityId: input.id,
          action: `lifecycle.${input.status}`,
          actorId: ctx.user.id,
          before: { lifecycleStatus: result.before.lifecycleStatus },
          after: { lifecycleStatus: result.after.lifecycleStatus },
          reason: input.reason ?? null,
        });
      }

      return { success: true, lifecycleStatus: result.after.lifecycleStatus };
    }),

  // Legal next lifecycle states for a machine (single source of truth for the UI).
  lifecycleTransitions: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const machine = await db.getMachineById(input.id);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
      const current = ((machine as { lifecycleStatus?: string }).lifecycleStatus ?? "active") as keyof typeof MACHINE_LIFECYCLE_TRANSITIONS;
      return {
        current,
        allowed: [...(MACHINE_LIFECYCLE_TRANSITIONS[current] ?? [])],
      };
    }),

  // Update machine layout position — ghi vị trí máy nên phải có quyền machine_control/canEdit
  updateLayoutPosition: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      layoutPositionX: z.number().min(0).max(1),
      layoutPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, layoutPositionX, layoutPositionY } = input;
      await db.updateMachine(id, {
        layoutPositionX: layoutPositionX.toString(),
        layoutPositionY: layoutPositionY.toString(),
      });
      await auditAction(ctx, {
        action: "update", entityType: ENTITY_TYPES.MACHINE, entityId: id,
        metadata: { layoutPositionX, layoutPositionY },
      });
      return { success: true };
    }),

  // Full floor-plan transform: position (0–1) + rotation + footprint. Writes the
  // x/y decimal columns (for legacy consumers) AND a `layout` jsonb with the rest.
  updateLayout: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      rotationDeg: z.number().min(0).max(360).optional(),
      footprintW: z.number().min(0.3).max(20).optional(),
      footprintD: z.number().min(0.3).max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, x, y, rotationDeg, footprintW, footprintD } = input;
      await db.updateMachine(id, {
        layoutPositionX: x.toString(),
        layoutPositionY: y.toString(),
        layout: { x, y, rotationDeg, footprintW, footprintD },
      });
      await auditAction(ctx, {
        action: "update", entityType: ENTITY_TYPES.MACHINE, entityId: id,
        metadata: { layout: { x, y, rotationDeg, footprintW, footprintD } },
      });
      return { success: true };
    }),
});
