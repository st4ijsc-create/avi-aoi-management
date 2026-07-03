import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
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
import { runConformance, subjectFromResolved } from "../services/standards/conformanceTest";

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
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      address: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createFactory(input);
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
    .mutation(async ({ input }) => {
      const { id, mapPositionX, mapPositionY, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (mapPositionX !== undefined) data.mapPositionX = mapPositionX.toString();
      if (mapPositionY !== undefined) data.mapPositionY = mapPositionY.toString();
      await db.updateFactory(id, data);
      return { success: true };
    }),

  updateMapPosition: adminProcedure
    .input(z.object({
      id: z.number(),
      mapPositionX: z.number().min(0).max(1),
      mapPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      await db.updateFactory(input.id, {
        mapPositionX: input.mapPositionX.toString(),
        mapPositionY: input.mapPositionY.toString(),
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
    .mutation(async ({ input }) => {
      const { id, imageData, fileName, contentType } = input;
      const buffer = Buffer.from(imageData, "base64");
      const fileKey = `factories/${id}/floorplan-${Date.now()}-${fileName}`;
      const { url } = await storagePut(fileKey, buffer, contentType);
      await db.updateFactory(id, { floorPlanImageUrl: url, floorPlanImageKey: fileKey });
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
    .mutation(async ({ input }) => {
      const { id, floorWidthM, floorDepthM, clearImage } = input;
      const data: Record<string, unknown> = {};
      if (floorWidthM !== undefined) data.floorWidthM = floorWidthM.toString();
      if (floorDepthM !== undefined) data.floorDepthM = floorDepthM.toString();
      if (clearImage) { data.floorPlanImageUrl = null; data.floorPlanImageKey = null; }
      await db.updateFactory(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      if (input.cascade) {
        await db.cascadeDeleteFactory(input.id);
      } else {
        await db.deleteFactory(input.id);
      }
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
    .mutation(async ({ input }) => {
      await db.restoreFactory(input.id);
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
    .mutation(async ({ input }) => {
      const id = await db.createFactoryZone({
        factoryId: input.factoryId,
        name: input.name,
        color: input.color ?? "#0ea5e9",
        points: input.points ?? [],
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
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      await db.updateFactoryZone(id, rest);
      return { success: true };
    }),

  delete: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteFactoryZone(input.id);
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
      factoryId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createWorkshop(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      factoryId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateWorkshop(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      if (input.cascade) {
        await db.cascadeDeleteWorkshop(input.id);
      } else {
        await db.deleteWorkshop(input.id);
      }
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
    .mutation(async ({ input }) => {
      await db.restoreWorkshop(input.id);
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
      workshopId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createProductionLine(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      workshopId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductionLine(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      if (input.cascade) {
        await db.cascadeDeleteLine(input.id);
      } else {
        await db.deleteProductionLine(input.id);
      }
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
    .mutation(async ({ input }) => {
      await db.restoreLine(input.id);
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
      lineId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createStation(input);
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
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateStation(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number(), cascade: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      if (input.cascade) {
        await db.cascadeDeleteStation(input.id);
      } else {
        await db.deleteStation(input.id);
      }
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
    .mutation(async ({ input }) => {
      await db.restoreStation(input.id);
      return { success: true };
    }),
});

// ============ MACHINE ROUTER ============
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
    .mutation(async ({ input }) => {
      // Tìm máy theo serialNumber
      const existing = await db.getMachineBySerialNumber(input.serialNumber);
      if (existing) {
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
        return { id: existing.id, registrationStatus: "pending", message: "Machine info updated, awaiting approval" };
      }
      // Tạo mới máy với trạng thái pending, chưa có APIKey
      const id = await db.createMachine({
        code: `SN-${input.serialNumber}`,
        name: input.name,
        machineType: input.machineType,
        model: input.model,
        manufacturer: input.manufacturer,
        firmwareVersion: input.firmwareVersion,
        serialNumber: input.serialNumber,
        syncMode: input.syncMode || "online",
        registrationStatus: "pending",
        stationId: 1, // Tạm gán station mặc định, admin sẽ mapping sau
      });
      return { id, registrationStatus: "pending", message: "Machine registered, awaiting admin approval" };
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
    .mutation(async ({ input }) => {
      const machine = await db.getMachineById(input.id);
      if (!machine) throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });

      // Sinh APIKey nếu chưa có
      const apiKey = machine.apiKey || `mach_${nanoid(32)}`;

      await db.approveMachine(input.id, {
        code: input.code || machine.code,
        name: input.name || machine.name,
        stationId: input.stationId || machine.stationId,
        apiKey,
      });

      return { success: true, apiKey, message: "Machine approved and mapped" };
    }),

  // Admin từ chối máy
  reject: adminProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.rejectMachine(input.id, input.reason);
      return { success: true, message: "Machine registration rejected" };
    }),

  list: protectedProcedure.query(async () => {
    return db.getMachines();
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

  create: adminProcedure
    .input(z.object({
      stationId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      machineType: z.enum(MACHINE_TYPES),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const governanceWarning = commissionGovernanceWarning(input.machineType);
      const apiKey = `mach_${nanoid(32)}`;
      const id = await db.createMachine({ ...input, apiKey });
      return { id, apiKey, governanceWarning };
    }),

  regenerateApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const apiKey = `mach_${nanoid(32)}`;
      const dbInstance = await db.getDb();
      if (!dbInstance) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      
      const { machines } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.update(machines).set({ apiKey }).where(eq(machines.id, input.id));
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
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMachine(id, data);
      return { success: true };
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
    .mutation(async ({ input }) => {
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
      
      return { url, key: fileKey };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMachine(input.id);
      return { success: true };
    }),

  listDeleted: adminProcedure.query(async () => {
    return db.getDeletedMachines();
  }),

  restore: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.restoreMachine(input.id);
      return { success: true };
    }),

  // Update machine layout position — ghi vị trí máy nên phải có quyền machine_control/canEdit
  updateLayoutPosition: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      id: z.number(),
      layoutPositionX: z.number().min(0).max(1),
      layoutPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      const { id, layoutPositionX, layoutPositionY } = input;
      await db.updateMachine(id, {
        layoutPositionX: layoutPositionX.toString(),
        layoutPositionY: layoutPositionY.toString(),
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
    .mutation(async ({ input }) => {
      const { id, x, y, rotationDeg, footprintW, footprintD } = input;
      await db.updateMachine(id, {
        layoutPositionX: x.toString(),
        layoutPositionY: y.toString(),
        layout: { x, y, rotationDeg, footprintW, footprintD },
      });
      return { success: true };
    }),
});
