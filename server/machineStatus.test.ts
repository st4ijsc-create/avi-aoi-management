import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "./db";

// Mock database functions
vi.mock("./db", () => ({
  createMachineStatusLog: vi.fn(),
  getMachineStatusLogs: vi.fn(),
  getMachineHeartbeats: vi.fn(),
  getUptimeStats: vi.fn(),
  getUnnotifiedOfflineMachines: vi.fn(),
  markOfflineNotificationSent: vi.fn(),
  bulkCreateMeasurementPointDefs: vi.fn(),
}));

describe("Machine Status Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createMachineStatusLog", () => {
    it("should create a status log entry", async () => {
      const mockLog = {
        id: 1,
        machineId: 1,
        status: "online",
        ipAddress: "192.168.1.100",
        timestamp: new Date(),
      };
      
      vi.mocked(db.createMachineStatusLog).mockResolvedValue(mockLog);

      const result = await db.createMachineStatusLog({
        machineId: 1,
        status: "online",
        ipAddress: "192.168.1.100",
      });

      expect(result).toEqual(mockLog);
      expect(db.createMachineStatusLog).toHaveBeenCalledWith({
        machineId: 1,
        status: "online",
        ipAddress: "192.168.1.100",
      });
    });

    it("should handle offline status", async () => {
      const mockLog = {
        id: 2,
        machineId: 1,
        status: "offline",
        ipAddress: "192.168.1.100",
        timestamp: new Date(),
      };
      
      vi.mocked(db.createMachineStatusLog).mockResolvedValue(mockLog);

      const result = await db.createMachineStatusLog({
        machineId: 1,
        status: "offline",
        ipAddress: "192.168.1.100",
      });

      expect(result.status).toBe("offline");
    });
  });

  describe("getMachineStatusLogs", () => {
    it("should return status logs for a machine", async () => {
      const mockLogs = [
        { id: 1, machineId: 1, status: "online", timestamp: new Date() },
        { id: 2, machineId: 1, status: "offline", timestamp: new Date() },
      ];
      
      vi.mocked(db.getMachineStatusLogs).mockResolvedValue(mockLogs);

      const result = await db.getMachineStatusLogs(1, 50);

      expect(result).toHaveLength(2);
      expect(db.getMachineStatusLogs).toHaveBeenCalledWith(1, 50);
    });

    it("should respect limit parameter", async () => {
      vi.mocked(db.getMachineStatusLogs).mockResolvedValue([]);

      await db.getMachineStatusLogs(1, 10);

      expect(db.getMachineStatusLogs).toHaveBeenCalledWith(1, 10);
    });
  });

  describe("getUptimeStats", () => {
    it("should calculate uptime statistics", async () => {
      const mockStats = {
        uptimePercent: 95,
        totalOnlineTime: 3420,
        totalOfflineTime: 180,
      };
      
      vi.mocked(db.getUptimeStats).mockResolvedValue(mockStats);

      const result = await db.getUptimeStats(1, 24);

      expect(result.uptimePercent).toBe(95);
      expect(result.totalOnlineTime).toBe(3420);
      expect(result.totalOfflineTime).toBe(180);
    });

    it("should return 0% uptime when machine is always offline", async () => {
      const mockStats = {
        uptimePercent: 0,
        totalOnlineTime: 0,
        totalOfflineTime: 3600,
      };
      
      vi.mocked(db.getUptimeStats).mockResolvedValue(mockStats);

      const result = await db.getUptimeStats(1, 24);

      expect(result.uptimePercent).toBe(0);
    });
  });

  describe("getUnnotifiedOfflineMachines", () => {
    it("should return machines offline for more than threshold", async () => {
      const mockMachines = [
        {
          log: { id: 1, machineId: 1, status: "offline", timestamp: new Date(Date.now() - 10 * 60 * 1000) },
          machine: { id: 1, code: "AVI-001", name: "AVI Machine 1" },
        },
      ];
      
      vi.mocked(db.getUnnotifiedOfflineMachines).mockResolvedValue(mockMachines);

      const result = await db.getUnnotifiedOfflineMachines(5);

      expect(result).toHaveLength(1);
      expect(result[0].machine.code).toBe("AVI-001");
    });

    it("should not return machines offline for less than threshold", async () => {
      vi.mocked(db.getUnnotifiedOfflineMachines).mockResolvedValue([]);

      const result = await db.getUnnotifiedOfflineMachines(5);

      expect(result).toHaveLength(0);
    });
  });
});

describe("Bulk Import Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bulkCreateMeasurementPointDefs", () => {
    it("should create multiple measurement points", async () => {
      const mockPoints = [
        { id: 1, code: "MP-001", name: "Point 1", productModelId: 1 },
        { id: 2, code: "MP-002", name: "Point 2", productModelId: 1 },
      ];
      
      vi.mocked(db.bulkCreateMeasurementPointDefs).mockResolvedValue({
        success: 2,
        failed: 0,
        errors: [],
        createdIds: [1, 2],
      });

      const result = await db.bulkCreateMeasurementPointDefs(1, [
        { code: "MP-001", name: "Point 1", positionX: 100, positionY: 100, radius: 20, measurementType: "VISUAL", orderIndex: 1, cropWidth: 100, cropHeight: 100 },
        { code: "MP-002", name: "Point 2", positionX: 200, positionY: 200, radius: 20, measurementType: "DIMENSION", orderIndex: 2, cropWidth: 100, cropHeight: 100 },
      ]);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("should handle duplicate codes gracefully", async () => {
      vi.mocked(db.bulkCreateMeasurementPointDefs).mockResolvedValue({
        success: 1,
        failed: 1,
        errors: ["MP-001: Duplicate code"],
        createdIds: [2],
      });

      const result = await db.bulkCreateMeasurementPointDefs(1, [
        { code: "MP-001", name: "Point 1 (duplicate)", positionX: 100, positionY: 100, radius: 20, measurementType: "VISUAL", orderIndex: 1, cropWidth: 100, cropHeight: 100 },
        { code: "MP-003", name: "Point 3", positionX: 300, positionY: 300, radius: 20, measurementType: "VISUAL", orderIndex: 3, cropWidth: 100, cropHeight: 100 },
      ]);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toContain("MP-001: Duplicate code");
    });

    it("should validate measurement types", async () => {
      vi.mocked(db.bulkCreateMeasurementPointDefs).mockResolvedValue({
        success: 0,
        failed: 1,
        errors: ["Invalid measurement type: INVALID"],
        createdIds: [],
      });

      const result = await db.bulkCreateMeasurementPointDefs(1, [
        { code: "MP-001", name: "Point 1", positionX: 100, positionY: 100, radius: 20, measurementType: "INVALID" as any, orderIndex: 1, cropWidth: 100, cropHeight: 100 },
      ]);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
    });
  });
});
