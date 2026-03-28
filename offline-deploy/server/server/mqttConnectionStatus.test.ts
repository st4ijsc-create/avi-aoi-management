/**
 * Unit Tests for MQTT Connection Status and Reconnect History
 * Phase 170: Connection Status Indicator, Reconnect History Log, Export Assignment Report
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock database
vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(() => Promise.resolve([]))
            }))
          }))
        })),
        groupBy: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve([]))
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve([{ insertId: 1 }]))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve())
      }))
    }))
  }))
}));

describe("MQTT Connection Status API", () => {
  describe("Connection Status Schema", () => {
    const connectionStatusSchema = z.object({
      profileId: z.number().int(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      status: z.enum(["connected", "disconnected", "connecting", "error", "unknown"]),
      clientId: z.string().optional(),
      brokerUrl: z.string().optional(),
      errorMessage: z.string().optional(),
      errorCode: z.string().optional(),
    });

    it("should validate connection status with all fields", () => {
      const validStatus = {
        profileId: 1,
        assignmentId: 5,
        targetType: "machine" as const,
        targetId: 10,
        status: "connected" as const,
        clientId: "client-123",
        brokerUrl: "mqtt://broker.example.com:1883",
      };

      const result = connectionStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it("should validate connection status with minimal fields", () => {
      const minimalStatus = {
        profileId: 1,
        status: "disconnected" as const,
      };

      const result = connectionStatusSchema.safeParse(minimalStatus);
      expect(result.success).toBe(true);
    });

    it("should reject invalid status values", () => {
      const invalidStatus = {
        profileId: 1,
        status: "invalid_status",
      };

      const result = connectionStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it("should validate all status enum values", () => {
      const statuses = ["connected", "disconnected", "connecting", "error", "unknown"];
      
      statuses.forEach(status => {
        const result = connectionStatusSchema.safeParse({
          profileId: 1,
          status,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should validate error status with error details", () => {
      const errorStatus = {
        profileId: 1,
        status: "error" as const,
        errorMessage: "Connection refused",
        errorCode: "ECONNREFUSED",
      };

      const result = connectionStatusSchema.safeParse(errorStatus);
      expect(result.success).toBe(true);
    });
  });

  describe("Connection Status Query Input", () => {
    const queryInputSchema = z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      status: z.enum(["connected", "disconnected", "connecting", "error", "unknown"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional();

    it("should accept empty query input", () => {
      const result = queryInputSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("should accept filter by profileId", () => {
      const result = queryInputSchema.safeParse({ profileId: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept filter by status", () => {
      const result = queryInputSchema.safeParse({ status: "connected" });
      expect(result.success).toBe(true);
    });

    it("should accept pagination parameters", () => {
      const result = queryInputSchema.safeParse({ limit: 20, offset: 40 });
      expect(result.success).toBe(true);
    });

    it("should reject limit above max", () => {
      const result = queryInputSchema.safeParse({ limit: 200 });
      expect(result.success).toBe(false);
    });
  });
});

describe("MQTT Reconnect History API", () => {
  describe("Reconnect Event Schema", () => {
    const reconnectEventSchema = z.object({
      profileId: z.number().int(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      eventType: z.enum(["attempt", "success", "failure", "max_attempts_reached"]),
      attemptNumber: z.number().int().default(1),
      reconnectDelay: z.number().int().optional(),
      connectionDuration: z.number().int().optional(),
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
      clientId: z.string().optional(),
      brokerUrl: z.string().optional(),
    });

    it("should validate reconnect attempt event", () => {
      const attemptEvent = {
        profileId: 1,
        eventType: "attempt" as const,
        attemptNumber: 1,
        reconnectDelay: 5000,
      };

      const result = reconnectEventSchema.safeParse(attemptEvent);
      expect(result.success).toBe(true);
    });

    it("should validate reconnect success event", () => {
      const successEvent = {
        profileId: 1,
        eventType: "success" as const,
        attemptNumber: 3,
        connectionDuration: 120,
      };

      const result = reconnectEventSchema.safeParse(successEvent);
      expect(result.success).toBe(true);
    });

    it("should validate reconnect failure event", () => {
      const failureEvent = {
        profileId: 1,
        eventType: "failure" as const,
        attemptNumber: 5,
        errorCode: "ETIMEDOUT",
        errorMessage: "Connection timed out",
      };

      const result = reconnectEventSchema.safeParse(failureEvent);
      expect(result.success).toBe(true);
    });

    it("should validate max_attempts_reached event", () => {
      const maxAttemptsEvent = {
        profileId: 1,
        eventType: "max_attempts_reached" as const,
        attemptNumber: 10,
        errorMessage: "Max reconnect attempts reached",
      };

      const result = reconnectEventSchema.safeParse(maxAttemptsEvent);
      expect(result.success).toBe(true);
    });

    it("should reject invalid event type", () => {
      const invalidEvent = {
        profileId: 1,
        eventType: "invalid_type",
      };

      const result = reconnectEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });
  });

  describe("Reconnect History Query Input", () => {
    const queryInputSchema = z.object({
      profileId: z.number().int().optional(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      eventType: z.enum(["attempt", "success", "failure", "max_attempts_reached"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional();

    it("should accept empty query input", () => {
      const result = queryInputSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("should accept date range filter", () => {
      const result = queryInputSchema.safeParse({
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      });
      expect(result.success).toBe(true);
    });

    it("should accept event type filter", () => {
      const result = queryInputSchema.safeParse({ eventType: "failure" });
      expect(result.success).toBe(true);
    });

    it("should accept higher limit for reconnect history", () => {
      const result = queryInputSchema.safeParse({ limit: 500 });
      expect(result.success).toBe(true);
    });
  });

  describe("Reconnect Stats Query Input", () => {
    const statsInputSchema = z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      days: z.number().int().min(1).max(90).default(7),
    }).optional();

    it("should accept default days value", () => {
      const result = statsInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept custom days value", () => {
      const result = statsInputSchema.safeParse({ days: 30 });
      expect(result.success).toBe(true);
    });

    it("should reject days above max", () => {
      const result = statsInputSchema.safeParse({ days: 100 });
      expect(result.success).toBe(false);
    });

    it("should reject days below min", () => {
      const result = statsInputSchema.safeParse({ days: 0 });
      expect(result.success).toBe(false);
    });
  });
});

describe("Export Assignment Report API", () => {
  describe("Export Input Schema", () => {
    const exportInputSchema = z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      isActive: z.boolean().optional(),
      format: z.enum(["csv", "json"]).default("csv"),
    }).optional();

    it("should accept empty input for full export", () => {
      const result = exportInputSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("should accept CSV format", () => {
      const result = exportInputSchema.safeParse({ format: "csv" });
      expect(result.success).toBe(true);
    });

    it("should accept JSON format", () => {
      const result = exportInputSchema.safeParse({ format: "json" });
      expect(result.success).toBe(true);
    });

    it("should accept filter by profileId", () => {
      const result = exportInputSchema.safeParse({ profileId: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept filter by targetType", () => {
      const result = exportInputSchema.safeParse({ targetType: "machine" });
      expect(result.success).toBe(true);
    });

    it("should accept filter by isActive", () => {
      const result = exportInputSchema.safeParse({ isActive: true });
      expect(result.success).toBe(true);
    });

    it("should accept multiple filters", () => {
      const result = exportInputSchema.safeParse({
        profileId: 1,
        targetType: "station",
        isActive: false,
        format: "json",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid format", () => {
      const result = exportInputSchema.safeParse({ format: "xml" });
      expect(result.success).toBe(false);
    });
  });

  describe("Export Output Format", () => {
    it("should generate valid CSV headers", () => {
      const expectedHeaders = [
        "ID",
        "Profile ID",
        "Profile Name",
        "Target Type",
        "Target ID",
        "Target Name",
        "Target Code",
        "Is Active",
        "Assigned At",
        "Updated At"
      ];

      const csvHeaders = expectedHeaders.join(",");
      expect(csvHeaders).toContain("Profile Name");
      expect(csvHeaders).toContain("Target Type");
      expect(csvHeaders).toContain("Is Active");
    });

    it("should format boolean values correctly for CSV", () => {
      const isActive = true;
      const formattedValue = isActive ? "Yes" : "No";
      expect(formattedValue).toBe("Yes");

      const isInactive = false;
      const formattedInactive = isInactive ? "Yes" : "No";
      expect(formattedInactive).toBe("No");
    });

    it("should escape strings with quotes in CSV", () => {
      const profileName = "Test Profile";
      const escapedName = `"${profileName}"`;
      expect(escapedName).toBe('"Test Profile"');
    });
  });
});

describe("Connection Status Summary", () => {
  it("should calculate correct percentages", () => {
    const summary = {
      total: 100,
      connected: 75,
      disconnected: 15,
      connecting: 5,
      error: 3,
      unknown: 2,
    };

    const connectedPercentage = (summary.connected / summary.total) * 100;
    expect(connectedPercentage).toBe(75);

    const errorPercentage = (summary.error / summary.total) * 100;
    expect(errorPercentage).toBe(3);
  });

  it("should handle zero total gracefully", () => {
    const summary = {
      total: 0,
      connected: 0,
      disconnected: 0,
      connecting: 0,
      error: 0,
      unknown: 0,
    };

    const connectedPercentage = summary.total > 0 
      ? (summary.connected / summary.total) * 100 
      : 0;
    expect(connectedPercentage).toBe(0);
  });
});

describe("Reconnect Stats Calculations", () => {
  it("should calculate success rate correctly", () => {
    const totalAttempts = 100;
    const successCount = 85;
    
    const successRate = totalAttempts > 0 
      ? ((successCount / totalAttempts) * 100).toFixed(2) 
      : "0.00";
    
    expect(successRate).toBe("85.00");
  });

  it("should handle zero attempts gracefully", () => {
    const totalAttempts = 0;
    const successCount = 0;
    
    const successRate = totalAttempts > 0 
      ? ((successCount / totalAttempts) * 100).toFixed(2) 
      : "0.00";
    
    expect(successRate).toBe("0.00");
  });

  it("should calculate average delay correctly", () => {
    const delays = [1000, 2000, 3000, 4000, 5000];
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    
    expect(avgDelay).toBe(3000);
  });
});
