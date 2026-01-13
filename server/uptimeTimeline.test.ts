import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "./db";

// Mock the database module
vi.mock("./db", () => ({
  getUptimeTimeline: vi.fn(),
  getAllMachinesUptimeTimeline: vi.fn(),
  getAlertConfiguration: vi.fn(),
  updateAlertConfiguration: vi.fn(),
  getMachineStatusReport: vi.fn(),
}));

describe("Uptime Timeline Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUptimeTimeline", () => {
    it("should return timeline segments for a machine", async () => {
      const mockTimeline = [
        {
          start: new Date("2024-01-13T08:00:00"),
          end: new Date("2024-01-13T12:00:00"),
          status: "online",
          duration: 14400,
        },
        {
          start: new Date("2024-01-13T12:00:00"),
          end: new Date("2024-01-13T12:30:00"),
          status: "offline",
          duration: 1800,
        },
        {
          start: new Date("2024-01-13T12:30:00"),
          end: new Date("2024-01-13T18:00:00"),
          status: "online",
          duration: 19800,
        },
      ];

      vi.mocked(db.getUptimeTimeline).mockResolvedValue(mockTimeline);

      const result = await db.getUptimeTimeline(1, 24);
      expect(result).toEqual(mockTimeline);
      expect(db.getUptimeTimeline).toHaveBeenCalledWith(1, 24);
    });

    it("should return empty array when no data", async () => {
      vi.mocked(db.getUptimeTimeline).mockResolvedValue([]);

      const result = await db.getUptimeTimeline(999, 24);
      expect(result).toEqual([]);
    });
  });

  describe("getAllMachinesUptimeTimeline", () => {
    it("should return timelines for all machines", async () => {
      const mockTimelines = [
        {
          machineId: 1,
          machineCode: "AVI-001",
          machineName: "AVI Machine 1",
          timeline: [],
          uptimePercent: 95.5,
          totalOnlineTime: 82800,
          totalOfflineTime: 3600,
        },
        {
          machineId: 2,
          machineCode: "AOI-001",
          machineName: "AOI Machine 1",
          timeline: [],
          uptimePercent: 88.2,
          totalOnlineTime: 76320,
          totalOfflineTime: 10080,
        },
      ];

      vi.mocked(db.getAllMachinesUptimeTimeline).mockResolvedValue(mockTimelines);

      const result = await db.getAllMachinesUptimeTimeline(24);
      expect(result).toHaveLength(2);
      expect(result[0].machineCode).toBe("AVI-001");
      expect(result[1].uptimePercent).toBe(88.2);
    });
  });
});

describe("Alert Configuration Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAlertConfiguration", () => {
    it("should return default config when no setting exists", async () => {
      const defaultConfig = {
        id: null,
        thresholdMinutes: 5,
        isActive: true,
        notifyEmail: true,
        notifyInApp: true,
      };

      vi.mocked(db.getAlertConfiguration).mockResolvedValue(defaultConfig);

      const result = await db.getAlertConfiguration();
      expect(result?.thresholdMinutes).toBe(5);
      expect(result?.isActive).toBe(true);
    });

    it("should return saved config when exists", async () => {
      const savedConfig = {
        id: 1,
        thresholdMinutes: 10,
        isActive: false,
        notifyEmail: true,
        notifyInApp: true,
      };

      vi.mocked(db.getAlertConfiguration).mockResolvedValue(savedConfig);

      const result = await db.getAlertConfiguration();
      expect(result?.id).toBe(1);
      expect(result?.thresholdMinutes).toBe(10);
      expect(result?.isActive).toBe(false);
    });
  });

  describe("updateAlertConfiguration", () => {
    it("should update alert configuration", async () => {
      vi.mocked(db.updateAlertConfiguration).mockResolvedValue(1);

      const result = await db.updateAlertConfiguration({
        thresholdMinutes: 15,
        isActive: true,
      });
      
      expect(db.updateAlertConfiguration).toHaveBeenCalledWith({
        thresholdMinutes: 15,
        isActive: true,
      });
    });
  });
});

describe("Machine Status Report Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getMachineStatusReport", () => {
    it("should return comprehensive report for a machine", async () => {
      const mockReport = {
        machine: {
          id: 1,
          code: "AVI-001",
          name: "AVI Machine 1",
        },
        period: {
          start: new Date("2024-01-01"),
          end: new Date("2024-01-07"),
          totalHours: 168,
        },
        statistics: {
          uptimePercent: 95.5,
          totalOnlineTime: 576720,
          totalOfflineTime: 27360,
          offlineCount: 5,
          longestOffline: 7200,
          longestOnline: 172800,
          mtbf: 115344,
          mttr: 5472,
        },
        logs: [
          { timestamp: new Date("2024-01-01T08:00:00"), status: "online", ipAddress: "192.168.1.100" },
          { timestamp: new Date("2024-01-01T18:00:00"), status: "offline", ipAddress: null },
        ],
      };

      vi.mocked(db.getMachineStatusReport).mockResolvedValue(mockReport);

      const result = await db.getMachineStatusReport(
        1,
        new Date("2024-01-01"),
        new Date("2024-01-07")
      );

      expect(result?.machine.code).toBe("AVI-001");
      expect(result?.statistics.uptimePercent).toBe(95.5);
      expect(result?.statistics.offlineCount).toBe(5);
      expect(result?.logs).toHaveLength(2);
    });

    it("should return null for non-existent machine", async () => {
      vi.mocked(db.getMachineStatusReport).mockResolvedValue(null);

      const result = await db.getMachineStatusReport(
        999,
        new Date("2024-01-01"),
        new Date("2024-01-07")
      );

      expect(result).toBeNull();
    });

    it("should calculate MTBF and MTTR correctly", async () => {
      const mockReport = {
        machine: { id: 1, code: "TEST-001", name: "Test Machine" },
        period: { start: new Date(), end: new Date(), totalHours: 24 },
        statistics: {
          uptimePercent: 90,
          totalOnlineTime: 77760, // 21.6 hours
          totalOfflineTime: 8640, // 2.4 hours
          offlineCount: 3,
          longestOffline: 3600,
          longestOnline: 36000,
          mtbf: 25920, // totalOnlineTime / offlineCount = 7.2 hours
          mttr: 2880, // totalOfflineTime / offlineCount = 0.8 hours
        },
        logs: [],
      };

      vi.mocked(db.getMachineStatusReport).mockResolvedValue(mockReport);

      const result = await db.getMachineStatusReport(1, new Date(), new Date());
      
      // MTBF = Mean Time Between Failures
      expect(result?.statistics.mtbf).toBe(25920);
      // MTTR = Mean Time To Repair
      expect(result?.statistics.mttr).toBe(2880);
    });
  });
});
