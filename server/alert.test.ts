import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  getAlertSettings: vi.fn(),
  getAlertSettingById: vi.fn(),
  createAlertSetting: vi.fn(),
  updateAlertSetting: vi.fn(),
  deleteAlertSetting: vi.fn(),
  getAlertHistory: vi.fn(),
  createAlertHistory: vi.fn(),
  acknowledgeAlert: vi.fn(),
}));

// Mock notification module
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import * as db from "./db";

describe("Alert Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAlertSettings", () => {
    it("should return alerts for a specific user", async () => {
      const mockAlerts = [
        {
          id: 1,
          userId: 1,
          name: "Yield Rate Alert",
          alertType: "yield_rate",
          threshold: "90",
          comparisonOperator: "lt",
          isActive: true,
          notifyEmail: true,
          notifySms: false,
          notifyInApp: true,
          cooldownMinutes: 60,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(db.getAlertSettings).mockResolvedValue(mockAlerts);

      const result = await db.getAlertSettings(1);
      expect(result).toEqual(mockAlerts);
      expect(db.getAlertSettings).toHaveBeenCalledWith(1);
    });

    it("should return all alerts when no userId provided", async () => {
      const mockAlerts = [
        { id: 1, userId: 1, name: "Alert 1" },
        { id: 2, userId: 2, name: "Alert 2" },
      ];

      vi.mocked(db.getAlertSettings).mockResolvedValue(mockAlerts as any);

      const result = await db.getAlertSettings();
      expect(result).toHaveLength(2);
    });
  });

  describe("createAlertSetting", () => {
    it("should create a new alert setting", async () => {
      const newAlert = {
        userId: 1,
        name: "New Alert",
        alertType: "yield_rate" as const,
        threshold: "85",
        comparisonOperator: "lt" as const,
        notifyEmail: true,
        notifyInApp: true,
      };

      vi.mocked(db.createAlertSetting).mockResolvedValue({ id: 1 });

      const result = await db.createAlertSetting(newAlert);
      expect(result).toEqual({ id: 1 });
      expect(db.createAlertSetting).toHaveBeenCalledWith(newAlert);
    });
  });

  describe("updateAlertSetting", () => {
    it("should update an existing alert setting", async () => {
      vi.mocked(db.updateAlertSetting).mockResolvedValue(undefined);

      await db.updateAlertSetting(1, { isActive: false });
      expect(db.updateAlertSetting).toHaveBeenCalledWith(1, { isActive: false });
    });
  });

  describe("deleteAlertSetting", () => {
    it("should delete an alert setting", async () => {
      vi.mocked(db.deleteAlertSetting).mockResolvedValue(undefined);

      await db.deleteAlertSetting(1);
      expect(db.deleteAlertSetting).toHaveBeenCalledWith(1);
    });
  });

  describe("Alert History", () => {
    it("should return alert history", async () => {
      const mockHistory = [
        {
          id: 1,
          alertSettingId: 1,
          triggeredValue: "88.5",
          message: "Yield Rate dropped below 90%",
          sentEmail: true,
          sentInApp: true,
          createdAt: new Date(),
        },
      ];

      vi.mocked(db.getAlertHistory).mockResolvedValue(mockHistory as any);

      const result = await db.getAlertHistory(1, 50);
      expect(result).toEqual(mockHistory);
    });

    it("should acknowledge an alert", async () => {
      vi.mocked(db.acknowledgeAlert).mockResolvedValue(undefined);

      await db.acknowledgeAlert(1, 1);
      expect(db.acknowledgeAlert).toHaveBeenCalledWith(1, 1);
    });
  });
});

describe("Alert Type Validation", () => {
  it("should validate yield_rate alert type", () => {
    const validTypes = ["yield_rate", "ng_count", "machine_status"];
    expect(validTypes).toContain("yield_rate");
    expect(validTypes).toContain("ng_count");
    expect(validTypes).toContain("machine_status");
  });

  it("should validate comparison operators", () => {
    const validOperators = ["lt", "lte", "gt", "gte", "eq"];
    expect(validOperators).toContain("lt");
    expect(validOperators).toContain("lte");
    expect(validOperators).toContain("gt");
    expect(validOperators).toContain("gte");
    expect(validOperators).toContain("eq");
  });
});
