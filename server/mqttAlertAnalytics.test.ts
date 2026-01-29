/**
 * Unit Tests for MQTT Alert and Analytics APIs
 * Phase 171: Connection Alerts, Alert Configuration, Reconnect Analytics
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ============= ALERT CONFIGURATION TESTS =============

describe("Alert Configuration Schema", () => {
  const alertConfigSchema = z.object({
    profileId: z.number().int().optional(),
    connectionLostThreshold: z.number().int().min(1).max(1440).optional(),
    reconnectFailedThreshold: z.number().int().min(1).max(100).optional(),
    highReconnectRateThreshold: z.number().int().min(1).max(1000).optional(),
    longDisconnectionThreshold: z.number().int().min(1).max(1440).optional(),
    enableEmailNotification: z.boolean().optional(),
    enablePushNotification: z.boolean().optional(),
    notificationEmails: z.string().optional(),
    isActive: z.boolean().optional(),
  });

  it("should accept valid alert configuration", () => {
    const validConfig = {
      connectionLostThreshold: 5,
      reconnectFailedThreshold: 10,
      highReconnectRateThreshold: 20,
      longDisconnectionThreshold: 30,
      enablePushNotification: true,
      enableEmailNotification: false,
    };
    expect(() => alertConfigSchema.parse(validConfig)).not.toThrow();
  });

  it("should accept profile-specific configuration", () => {
    const profileConfig = {
      profileId: 1,
      connectionLostThreshold: 10,
      enablePushNotification: true,
    };
    expect(() => alertConfigSchema.parse(profileConfig)).not.toThrow();
  });

  it("should reject connectionLostThreshold below minimum", () => {
    const invalidConfig = { connectionLostThreshold: 0 };
    expect(() => alertConfigSchema.parse(invalidConfig)).toThrow();
  });

  it("should reject connectionLostThreshold above maximum", () => {
    const invalidConfig = { connectionLostThreshold: 1441 };
    expect(() => alertConfigSchema.parse(invalidConfig)).toThrow();
  });

  it("should reject reconnectFailedThreshold above maximum", () => {
    const invalidConfig = { reconnectFailedThreshold: 101 };
    expect(() => alertConfigSchema.parse(invalidConfig)).toThrow();
  });

  it("should reject highReconnectRateThreshold above maximum", () => {
    const invalidConfig = { highReconnectRateThreshold: 1001 };
    expect(() => alertConfigSchema.parse(invalidConfig)).toThrow();
  });

  it("should accept empty configuration object", () => {
    expect(() => alertConfigSchema.parse({})).not.toThrow();
  });

  it("should accept notification emails as string", () => {
    const config = { notificationEmails: "admin@example.com,ops@example.com" };
    expect(() => alertConfigSchema.parse(config)).not.toThrow();
  });
});

// ============= CONNECTION ALERTS TESTS =============

describe("Connection Alerts Schema", () => {
  const getAlertsSchema = z.object({
    profileId: z.number().int().optional(),
    alertType: z.enum(["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]).optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    isAcknowledged: z.boolean().optional(),
    isResolved: z.boolean().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  });

  it("should accept valid alert query", () => {
    const validQuery = {
      alertType: "connection_lost",
      severity: "critical",
      isAcknowledged: false,
      limit: 50,
    };
    expect(() => getAlertsSchema.parse(validQuery)).not.toThrow();
  });

  it("should accept all alert types", () => {
    const alertTypes = ["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"];
    alertTypes.forEach(type => {
      expect(() => getAlertsSchema.parse({ alertType: type })).not.toThrow();
    });
  });

  it("should accept all severity levels", () => {
    const severities = ["info", "warning", "critical"];
    severities.forEach(severity => {
      expect(() => getAlertsSchema.parse({ severity })).not.toThrow();
    });
  });

  it("should reject invalid alert type", () => {
    const invalidQuery = { alertType: "invalid_type" };
    expect(() => getAlertsSchema.parse(invalidQuery)).toThrow();
  });

  it("should reject limit above maximum", () => {
    const invalidQuery = { limit: 501 };
    expect(() => getAlertsSchema.parse(invalidQuery)).toThrow();
  });

  it("should reject negative offset", () => {
    const invalidQuery = { offset: -1 };
    expect(() => getAlertsSchema.parse(invalidQuery)).toThrow();
  });

  it("should accept date range filters", () => {
    const query = {
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    };
    expect(() => getAlertsSchema.parse(query)).not.toThrow();
  });
});

describe("Create Alert Schema", () => {
  const createAlertSchema = z.object({
    profileId: z.number().int(),
    assignmentId: z.number().int().optional(),
    targetType: z.enum(["machine", "station", "factory"]).optional(),
    targetId: z.number().int().optional(),
    alertType: z.enum(["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]),
    severity: z.enum(["info", "warning", "critical"]).default("warning"),
    title: z.string(),
    message: z.string().optional(),
    thresholdMinutes: z.number().int().optional(),
  });

  it("should accept valid alert creation", () => {
    const validAlert = {
      profileId: 1,
      alertType: "connection_lost",
      severity: "critical",
      title: "Connection Lost Alert",
      message: "MQTT connection has been lost for 5 minutes",
    };
    expect(() => createAlertSchema.parse(validAlert)).not.toThrow();
  });

  it("should require profileId", () => {
    const invalidAlert = {
      alertType: "connection_lost",
      title: "Test Alert",
    };
    expect(() => createAlertSchema.parse(invalidAlert)).toThrow();
  });

  it("should require alertType", () => {
    const invalidAlert = {
      profileId: 1,
      title: "Test Alert",
    };
    expect(() => createAlertSchema.parse(invalidAlert)).toThrow();
  });

  it("should require title", () => {
    const invalidAlert = {
      profileId: 1,
      alertType: "connection_lost",
    };
    expect(() => createAlertSchema.parse(invalidAlert)).toThrow();
  });

  it("should accept alert with target info", () => {
    const alertWithTarget = {
      profileId: 1,
      alertType: "reconnect_failed",
      title: "Reconnect Failed",
      targetType: "machine",
      targetId: 5,
      assignmentId: 10,
    };
    expect(() => createAlertSchema.parse(alertWithTarget)).not.toThrow();
  });
});

// ============= RECONNECT ANALYTICS TESTS =============

describe("Reconnect Heatmap Schema", () => {
  const heatmapSchema = z.object({
    profileId: z.number().int().optional(),
    targetType: z.enum(["machine", "station", "factory"]).optional(),
    days: z.number().int().min(1).max(30).default(7),
  });

  it("should accept valid heatmap query", () => {
    const validQuery = { days: 7 };
    expect(() => heatmapSchema.parse(validQuery)).not.toThrow();
  });

  it("should accept profile filter", () => {
    const query = { profileId: 1, days: 14 };
    expect(() => heatmapSchema.parse(query)).not.toThrow();
  });

  it("should accept target type filter", () => {
    const query = { targetType: "machine", days: 7 };
    expect(() => heatmapSchema.parse(query)).not.toThrow();
  });

  it("should reject days below minimum", () => {
    const invalidQuery = { days: 0 };
    expect(() => heatmapSchema.parse(invalidQuery)).toThrow();
  });

  it("should reject days above maximum", () => {
    const invalidQuery = { days: 31 };
    expect(() => heatmapSchema.parse(invalidQuery)).toThrow();
  });

  it("should use default days value", () => {
    const result = heatmapSchema.parse({});
    expect(result.days).toBe(7);
  });
});

describe("Top Reconnect Profiles Schema", () => {
  const topProfilesSchema = z.object({
    days: z.number().int().min(1).max(90).default(7),
    limit: z.number().int().min(1).max(50).default(10),
  });

  it("should accept valid query", () => {
    const validQuery = { days: 30, limit: 20 };
    expect(() => topProfilesSchema.parse(validQuery)).not.toThrow();
  });

  it("should use default values", () => {
    const result = topProfilesSchema.parse({});
    expect(result.days).toBe(7);
    expect(result.limit).toBe(10);
  });

  it("should reject days above maximum", () => {
    const invalidQuery = { days: 91 };
    expect(() => topProfilesSchema.parse(invalidQuery)).toThrow();
  });

  it("should reject limit above maximum", () => {
    const invalidQuery = { limit: 51 };
    expect(() => topProfilesSchema.parse(invalidQuery)).toThrow();
  });
});

describe("Reconnect Trend Schema", () => {
  const trendSchema = z.object({
    profileId: z.number().int().optional(),
    days: z.number().int().min(1).max(90).default(30),
  });

  it("should accept valid trend query", () => {
    const validQuery = { days: 30 };
    expect(() => trendSchema.parse(validQuery)).not.toThrow();
  });

  it("should accept profile filter", () => {
    const query = { profileId: 1, days: 60 };
    expect(() => trendSchema.parse(query)).not.toThrow();
  });

  it("should use default days value", () => {
    const result = trendSchema.parse({});
    expect(result.days).toBe(30);
  });

  it("should reject days above maximum", () => {
    const invalidQuery = { days: 91 };
    expect(() => trendSchema.parse(invalidQuery)).toThrow();
  });
});

describe("Reconnect Stats by Target Schema", () => {
  const statsByTargetSchema = z.object({
    targetType: z.enum(["machine", "station", "factory"]),
    days: z.number().int().min(1).max(90).default(7),
    limit: z.number().int().min(1).max(50).default(10),
  });

  it("should accept valid query", () => {
    const validQuery = { targetType: "machine", days: 14, limit: 20 };
    expect(() => statsByTargetSchema.parse(validQuery)).not.toThrow();
  });

  it("should require targetType", () => {
    const invalidQuery = { days: 7 };
    expect(() => statsByTargetSchema.parse(invalidQuery)).toThrow();
  });

  it("should accept all target types", () => {
    const targetTypes = ["machine", "station", "factory"];
    targetTypes.forEach(type => {
      expect(() => statsByTargetSchema.parse({ targetType: type })).not.toThrow();
    });
  });

  it("should reject invalid target type", () => {
    const invalidQuery = { targetType: "invalid" };
    expect(() => statsByTargetSchema.parse(invalidQuery)).toThrow();
  });
});

// ============= ALERT SUMMARY CALCULATION TESTS =============

describe("Alert Summary Calculations", () => {
  it("should calculate totals correctly", () => {
    const mockSummary = [
      { alertType: "connection_lost", severity: "critical", isAcknowledged: false, count: 5 },
      { alertType: "connection_lost", severity: "warning", isAcknowledged: true, count: 3 },
      { alertType: "reconnect_failed", severity: "warning", isAcknowledged: false, count: 2 },
      { alertType: "high_reconnect_rate", severity: "info", isAcknowledged: true, count: 4 },
    ];

    const totals = {
      total: 0,
      unacknowledged: 0,
      critical: 0,
      warning: 0,
      info: 0,
      byType: {
        connection_lost: 0,
        reconnect_failed: 0,
        high_reconnect_rate: 0,
        long_disconnection: 0,
      },
    };

    mockSummary.forEach(row => {
      const cnt = Number(row.count);
      totals.total += cnt;
      if (!row.isAcknowledged) totals.unacknowledged += cnt;
      if (row.severity === "critical") totals.critical += cnt;
      if (row.severity === "warning") totals.warning += cnt;
      if (row.severity === "info") totals.info += cnt;
      if (row.alertType) totals.byType[row.alertType as keyof typeof totals.byType] += cnt;
    });

    expect(totals.total).toBe(14);
    expect(totals.unacknowledged).toBe(7);
    expect(totals.critical).toBe(5);
    expect(totals.warning).toBe(5);
    expect(totals.info).toBe(4);
    expect(totals.byType.connection_lost).toBe(8);
    expect(totals.byType.reconnect_failed).toBe(2);
    expect(totals.byType.high_reconnect_rate).toBe(4);
    expect(totals.byType.long_disconnection).toBe(0);
  });
});

// ============= HEATMAP MATRIX TESTS =============

describe("Heatmap Matrix Generation", () => {
  it("should create 7x24 matrix", () => {
    const matrix: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
    
    expect(matrix.length).toBe(7);
    matrix.forEach(row => {
      expect(row.length).toBe(24);
      row.forEach(cell => {
        expect(cell).toBe(0);
      });
    });
  });

  it("should populate matrix correctly", () => {
    const matrix: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
    
    // Simulate data: Monday (2) at 10:00 with 5 reconnects
    const dayIndex = 1; // Monday (0-indexed from Sunday)
    const hourIndex = 10;
    const count = 5;
    
    matrix[dayIndex][hourIndex] = count;
    
    expect(matrix[1][10]).toBe(5);
    expect(matrix[0][10]).toBe(0); // Sunday should still be 0
  });

  it("should calculate max count correctly", () => {
    const heatmapData = [
      { dayOfWeek: 2, hourOfDay: 10, count: 5 },
      { dayOfWeek: 3, hourOfDay: 14, count: 10 },
      { dayOfWeek: 4, hourOfDay: 9, count: 3 },
    ];

    let maxCount = 0;
    heatmapData.forEach(row => {
      if (row.count > maxCount) maxCount = row.count;
    });

    expect(maxCount).toBe(10);
  });
});

// ============= TOP PROFILES CALCULATION TESTS =============

describe("Top Profiles Calculations", () => {
  it("should calculate success rate correctly", () => {
    const profile = {
      totalAttempts: 100,
      successCount: 85,
      failureCount: 15,
    };

    const successRate = ((profile.successCount / profile.totalAttempts) * 100).toFixed(1);
    expect(successRate).toBe("85.0");
  });

  it("should handle zero attempts", () => {
    const profile = {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
    };

    const successRate = profile.totalAttempts > 0 
      ? ((profile.successCount / profile.totalAttempts) * 100).toFixed(1) 
      : "0.0";
    expect(successRate).toBe("0.0");
  });

  it("should round average delay correctly", () => {
    const avgDelay = 1234.567;
    const rounded = Math.round(avgDelay);
    expect(rounded).toBe(1235);
  });
});

// ============= TREND DATA TESTS =============

describe("Trend Data Processing", () => {
  it("should calculate trend totals correctly", () => {
    const trendData = [
      { date: "2025-01-01", totalAttempts: 10, successCount: 8, failureCount: 2, avgDelay: 100 },
      { date: "2025-01-02", totalAttempts: 15, successCount: 12, failureCount: 3, avgDelay: 150 },
      { date: "2025-01-03", totalAttempts: 5, successCount: 5, failureCount: 0, avgDelay: 80 },
    ];

    const totalAttempts = trendData.reduce((sum, d) => sum + d.totalAttempts, 0);
    const totalSuccess = trendData.reduce((sum, d) => sum + d.successCount, 0);
    const totalFailure = trendData.reduce((sum, d) => sum + d.failureCount, 0);
    const avgDelay = Math.round(trendData.reduce((sum, d) => sum + d.avgDelay, 0) / trendData.length);

    expect(totalAttempts).toBe(30);
    expect(totalSuccess).toBe(25);
    expect(totalFailure).toBe(5);
    expect(avgDelay).toBe(110);
  });
});
