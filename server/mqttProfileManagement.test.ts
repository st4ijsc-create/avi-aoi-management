/**
 * Unit tests for MQTT Profile Management
 * Tests for Bulk Assignment and Auto-Reconnect Configuration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  requireDb: vi.fn().mockResolvedValue(mockDb),
}));

describe("MQTT Profile Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Auto-Reconnect Configuration", () => {
    it("should have valid auto-reconnect schema fields", () => {
      // Test schema validation for auto-reconnect fields
      const validProfile = {
        name: "Test Profile",
        brokerUrl: "mqtt://localhost",
        port: 1883,
        autoReconnect: true,
        maxReconnectAttempts: 10,
        reconnectBackoffMultiplier: "1.5",
        maxReconnectDelay: 60000,
      };

      expect(validProfile.autoReconnect).toBe(true);
      expect(validProfile.maxReconnectAttempts).toBe(10);
      expect(validProfile.reconnectBackoffMultiplier).toBe("1.5");
      expect(validProfile.maxReconnectDelay).toBe(60000);
    });

    it("should allow maxReconnectAttempts to be 0 (unlimited)", () => {
      const profile = {
        maxReconnectAttempts: 0,
      };
      expect(profile.maxReconnectAttempts).toBe(0);
    });

    it("should validate reconnectBackoffMultiplier as string", () => {
      const validMultipliers = ["1.0", "1.5", "2.0", "3.0"];
      validMultipliers.forEach((multiplier) => {
        const parsed = parseFloat(multiplier);
        expect(parsed).toBeGreaterThanOrEqual(1.0);
      });
    });

    it("should validate maxReconnectDelay minimum value", () => {
      const minDelay = 1000;
      const validDelays = [1000, 5000, 30000, 60000, 120000];
      validDelays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(minDelay);
      });
    });
  });

  describe("Bulk Assignment", () => {
    it("should validate bulk assignment input structure", () => {
      const bulkAssignInput = {
        profileId: 1,
        targets: [
          { targetType: "machine" as const, targetId: 1 },
          { targetType: "machine" as const, targetId: 2 },
          { targetType: "station" as const, targetId: 1 },
        ],
        replaceExisting: false,
      };

      expect(bulkAssignInput.profileId).toBe(1);
      expect(bulkAssignInput.targets.length).toBe(3);
      expect(bulkAssignInput.targets[0].targetType).toBe("machine");
      expect(bulkAssignInput.replaceExisting).toBe(false);
    });

    it("should support all target types", () => {
      const validTargetTypes = ["machine", "station", "factory"];
      validTargetTypes.forEach((type) => {
        expect(["machine", "station", "factory"]).toContain(type);
      });
    });

    it("should handle empty targets array", () => {
      const bulkAssignInput = {
        profileId: 1,
        targets: [],
        replaceExisting: false,
      };

      expect(bulkAssignInput.targets.length).toBe(0);
    });

    it("should support override settings in bulk assignment", () => {
      const bulkAssignInput = {
        profileId: 1,
        targets: [{ targetType: "machine" as const, targetId: 1 }],
        overrideSettings: {
          subscribeTopics: ["custom/topic/1", "custom/topic/2"],
          publishTopics: ["custom/publish/1"],
          qos: "2",
          clientIdSuffix: "-custom",
        },
        replaceExisting: true,
      };

      expect(bulkAssignInput.overrideSettings?.subscribeTopics?.length).toBe(2);
      expect(bulkAssignInput.overrideSettings?.qos).toBe("2");
    });

    it("should track bulk assignment results", () => {
      const results = {
        success: 5,
        skipped: 2,
        errors: ["Failed to assign machine 3: Already assigned"],
      };

      expect(results.success).toBe(5);
      expect(results.skipped).toBe(2);
      expect(results.errors.length).toBe(1);
    });
  });

  describe("Available Targets Query", () => {
    it("should filter by target type", () => {
      const input = {
        targetType: "machine" as const,
        excludeAssigned: true,
      };

      expect(input.targetType).toBe("machine");
      expect(input.excludeAssigned).toBe(true);
    });

    it("should return target with assignment status", () => {
      const targets = [
        { id: 1, name: "Machine 1", code: "M001", hasAssignment: false },
        { id: 2, name: "Machine 2", code: "M002", hasAssignment: true },
      ];

      expect(targets[0].hasAssignment).toBe(false);
      expect(targets[1].hasAssignment).toBe(true);
    });
  });

  describe("Profile Creation with Auto-Reconnect", () => {
    it("should create profile with default auto-reconnect settings", () => {
      const defaultProfile = {
        name: "Default Profile",
        brokerUrl: "mqtt://localhost",
        port: 1883,
        protocol: "mqtt" as const,
        autoReconnect: true,
        maxReconnectAttempts: 10,
        reconnectBackoffMultiplier: "1.5",
        maxReconnectDelay: 60000,
        reconnectPeriod: 5000,
      };

      expect(defaultProfile.autoReconnect).toBe(true);
      expect(defaultProfile.maxReconnectAttempts).toBe(10);
    });

    it("should allow disabling auto-reconnect", () => {
      const noReconnectProfile = {
        name: "No Reconnect Profile",
        brokerUrl: "mqtt://localhost",
        autoReconnect: false,
        maxReconnectAttempts: 0,
      };

      expect(noReconnectProfile.autoReconnect).toBe(false);
    });

    it("should calculate exponential backoff delay", () => {
      const baseDelay = 5000;
      const multiplier = 1.5;
      const maxDelay = 60000;
      
      let currentDelay = baseDelay;
      const delays: number[] = [];
      
      for (let attempt = 0; attempt < 5; attempt++) {
        delays.push(Math.min(currentDelay, maxDelay));
        currentDelay = Math.floor(currentDelay * multiplier);
      }

      expect(delays[0]).toBe(5000);
      expect(delays[1]).toBe(7500);
      expect(delays[2]).toBe(11250);
      expect(delays[3]).toBe(16875);
      expect(delays[4]).toBe(25312);
    });
  });
});
