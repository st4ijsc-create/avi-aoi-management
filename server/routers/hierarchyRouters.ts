import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "../db";
import { storagePut } from "../storage";

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

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteFactory(input.id);
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
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteWorkshop(input.id);
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
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductionLine(input.id);
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
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteStation(input.id);
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
      machineType: z.enum(["AOI", "AVI", "AUTOMATION"]),
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
      machineType: z.enum(["AVI", "AOI", "AUTOMATION"]),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const apiKey = `mach_${nanoid(32)}`;
      const id = await db.createMachine({ ...input, apiKey });
      return { id, apiKey };
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

  // Update machine layout position
  updateLayoutPosition: protectedProcedure
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
});
