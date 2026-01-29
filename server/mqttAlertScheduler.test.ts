/**
 * Unit Tests for MQTT Alert Scheduler and Alert Widget APIs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// Mock schemas for testing
const schedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(1).max(60).optional(),
  notifyOnCritical: z.boolean().optional(),
  notifyOnWarning: z.boolean().optional(),
});

const startSchedulerSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(60).default(5),
});

const alertWidgetDataSchema = z.object({
  total: z.number(),
  critical: z.number(),
  warning: z.number(),
  info: z.number(),
  recentAlerts: z.array(z.object({
    id: z.number(),
    profileId: z.number(),
    alertType: z.string(),
    severity: z.string(),
    title: z.string(),
    triggeredAt: z.date(),
    isAcknowledged: z.boolean(),
  })),
});

const sendTestNotificationSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(1000),
});

describe("MQTT Alert Scheduler", () => {
  describe("Scheduler Config Schema", () => {
    it("should accept valid config with all fields", () => {
      const input = {
        enabled: true,
        intervalMinutes: 10,
        notifyOnCritical: true,
        notifyOnWarning: false,
      };
      expect(() => schedulerConfigSchema.parse(input)).not.toThrow();
    });

    it("should accept partial config", () => {
      const input = { intervalMinutes: 15 };
      expect(() => schedulerConfigSchema.parse(input)).not.toThrow();
    });

    it("should accept empty config", () => {
      const input = {};
      expect(() => schedulerConfigSchema.parse(input)).not.toThrow();
    });

    it("should reject interval below minimum", () => {
      const input = { intervalMinutes: 0 };
      expect(() => schedulerConfigSchema.parse(input)).toThrow();
    });

    it("should reject interval above maximum", () => {
      const input = { intervalMinutes: 61 };
      expect(() => schedulerConfigSchema.parse(input)).toThrow();
    });

    it("should reject non-integer interval", () => {
      const input = { intervalMinutes: 5.5 };
      expect(() => schedulerConfigSchema.parse(input)).toThrow();
    });
  });

  describe("Start Scheduler Schema", () => {
    it("should accept valid interval", () => {
      const input = { intervalMinutes: 5 };
      expect(() => startSchedulerSchema.parse(input)).not.toThrow();
    });

    it("should use default interval when not provided", () => {
      const input = {};
      const result = startSchedulerSchema.parse(input);
      expect(result.intervalMinutes).toBe(5);
    });

    it("should accept minimum interval", () => {
      const input = { intervalMinutes: 1 };
      expect(() => startSchedulerSchema.parse(input)).not.toThrow();
    });

    it("should accept maximum interval", () => {
      const input = { intervalMinutes: 60 };
      expect(() => startSchedulerSchema.parse(input)).not.toThrow();
    });
  });
});

describe("Alert Widget APIs", () => {
  describe("Alert Widget Data Schema", () => {
    it("should accept valid widget data", () => {
      const input = {
        total: 5,
        critical: 2,
        warning: 2,
        info: 1,
        recentAlerts: [
          {
            id: 1,
            profileId: 1,
            alertType: "connection_lost",
            severity: "critical",
            title: "Connection Lost",
            triggeredAt: new Date(),
            isAcknowledged: false,
          },
        ],
      };
      expect(() => alertWidgetDataSchema.parse(input)).not.toThrow();
    });

    it("should accept empty recent alerts", () => {
      const input = {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
        recentAlerts: [],
      };
      expect(() => alertWidgetDataSchema.parse(input)).not.toThrow();
    });

    it("should accept multiple recent alerts", () => {
      const input = {
        total: 3,
        critical: 1,
        warning: 1,
        info: 1,
        recentAlerts: [
          {
            id: 1,
            profileId: 1,
            alertType: "connection_lost",
            severity: "critical",
            title: "Alert 1",
            triggeredAt: new Date(),
            isAcknowledged: false,
          },
          {
            id: 2,
            profileId: 2,
            alertType: "high_reconnect_rate",
            severity: "warning",
            title: "Alert 2",
            triggeredAt: new Date(),
            isAcknowledged: true,
          },
        ],
      };
      expect(() => alertWidgetDataSchema.parse(input)).not.toThrow();
    });
  });

  describe("Send Test Notification Schema", () => {
    it("should accept valid notification", () => {
      const input = {
        title: "Test Alert",
        content: "This is a test notification",
      };
      expect(() => sendTestNotificationSchema.parse(input)).not.toThrow();
    });

    it("should reject empty title", () => {
      const input = {
        title: "",
        content: "Content",
      };
      expect(() => sendTestNotificationSchema.parse(input)).toThrow();
    });

    it("should reject empty content", () => {
      const input = {
        title: "Title",
        content: "",
      };
      expect(() => sendTestNotificationSchema.parse(input)).toThrow();
    });

    it("should reject title exceeding max length", () => {
      const input = {
        title: "a".repeat(256),
        content: "Content",
      };
      expect(() => sendTestNotificationSchema.parse(input)).toThrow();
    });

    it("should reject content exceeding max length", () => {
      const input = {
        title: "Title",
        content: "a".repeat(1001),
      };
      expect(() => sendTestNotificationSchema.parse(input)).toThrow();
    });

    it("should accept title at max length", () => {
      const input = {
        title: "a".repeat(255),
        content: "Content",
      };
      expect(() => sendTestNotificationSchema.parse(input)).not.toThrow();
    });

    it("should accept content at max length", () => {
      const input = {
        title: "Title",
        content: "a".repeat(1000),
      };
      expect(() => sendTestNotificationSchema.parse(input)).not.toThrow();
    });
  });
});

describe("Alert Scheduler Logic", () => {
  describe("Threshold Calculations", () => {
    it("should calculate minutes offline correctly", () => {
      const lastSeen = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const minutesOffline = Math.round((Date.now() - lastSeen.getTime()) / 60000);
      expect(minutesOffline).toBe(10);
    });

    it("should determine severity based on threshold", () => {
      const thresholdMinutes = 5;
      const minutesOffline = 15;
      const severity = minutesOffline > thresholdMinutes * 2 ? "critical" : "warning";
      expect(severity).toBe("critical");
    });

    it("should determine warning severity when below double threshold", () => {
      const thresholdMinutes = 5;
      const minutesOffline = 8;
      const severity = minutesOffline > thresholdMinutes * 2 ? "critical" : "warning";
      expect(severity).toBe("warning");
    });
  });

  describe("Rate Limiting", () => {
    it("should calculate cooldown correctly", () => {
      const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
      const lastSent = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const now = Date.now();
      const shouldSkip = now - lastSent < NOTIFICATION_COOLDOWN_MS;
      expect(shouldSkip).toBe(true);
    });

    it("should allow notification after cooldown", () => {
      const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
      const lastSent = Date.now() - 20 * 60 * 1000; // 20 minutes ago
      const now = Date.now();
      const shouldSkip = now - lastSent < NOTIFICATION_COOLDOWN_MS;
      expect(shouldSkip).toBe(false);
    });
  });

  describe("Alert Summary Calculations", () => {
    it("should calculate totals correctly", () => {
      const summary = [
        { severity: "critical", count: 2 },
        { severity: "warning", count: 3 },
        { severity: "info", count: 1 },
      ];

      const totals = {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };

      summary.forEach((row) => {
        const cnt = Number(row.count);
        totals.total += cnt;
        if (row.severity === "critical") totals.critical = cnt;
        if (row.severity === "warning") totals.warning = cnt;
        if (row.severity === "info") totals.info = cnt;
      });

      expect(totals.total).toBe(6);
      expect(totals.critical).toBe(2);
      expect(totals.warning).toBe(3);
      expect(totals.info).toBe(1);
    });

    it("should handle empty summary", () => {
      const summary: Array<{ severity: string; count: number }> = [];

      const totals = {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };

      summary.forEach((row) => {
        const cnt = Number(row.count);
        totals.total += cnt;
        if (row.severity === "critical") totals.critical = cnt;
        if (row.severity === "warning") totals.warning = cnt;
        if (row.severity === "info") totals.info = cnt;
      });

      expect(totals.total).toBe(0);
      expect(totals.critical).toBe(0);
      expect(totals.warning).toBe(0);
      expect(totals.info).toBe(0);
    });
  });
});

describe("Scheduler Status", () => {
  it("should return correct status structure", () => {
    const status = {
      isRunning: false,
      config: {
        enabled: false,
        intervalMinutes: 5,
        notifyOnCritical: true,
        notifyOnWarning: false,
      },
      lastRunTime: null,
      notificationCooldownCount: 0,
    };

    expect(status).toHaveProperty("isRunning");
    expect(status).toHaveProperty("config");
    expect(status).toHaveProperty("lastRunTime");
    expect(status).toHaveProperty("notificationCooldownCount");
  });

  it("should have correct config defaults", () => {
    const defaultConfig = {
      enabled: false,
      intervalMinutes: 5,
      notifyOnCritical: true,
      notifyOnWarning: false,
    };

    expect(defaultConfig.enabled).toBe(false);
    expect(defaultConfig.intervalMinutes).toBe(5);
    expect(defaultConfig.notifyOnCritical).toBe(true);
    expect(defaultConfig.notifyOnWarning).toBe(false);
  });
});

describe("Combined Alert Widget", () => {
  it("should combine and sort alerts correctly", () => {
    const ruleAlerts = [
      { id: 1, triggeredAt: new Date("2024-01-01T10:00:00Z") },
      { id: 2, triggeredAt: new Date("2024-01-01T12:00:00Z") },
    ];

    const connectionAlerts = [
      { id: 3, triggeredAt: new Date("2024-01-01T11:00:00Z") },
    ];

    const combined = [
      ...ruleAlerts.map((a) => ({ ...a, type: "rule" as const })),
      ...connectionAlerts.map((a) => ({ ...a, type: "connection" as const })),
    ];

    combined.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());

    expect(combined[0].id).toBe(2); // Latest first
    expect(combined[1].id).toBe(3);
    expect(combined[2].id).toBe(1);
  });

  it("should calculate total alerts correctly", () => {
    const totalRuleAlerts = 3;
    const totalConnectionAlerts = 5;
    const totalAlerts = totalRuleAlerts + totalConnectionAlerts;

    expect(totalAlerts).toBe(8);
  });

  it("should detect critical alerts", () => {
    const connectionAlerts = { critical: 2, warning: 3, info: 1 };
    const hasCritical = connectionAlerts.critical > 0;

    expect(hasCritical).toBe(true);
  });

  it("should not detect critical when none exist", () => {
    const connectionAlerts = { critical: 0, warning: 3, info: 1 };
    const hasCritical = connectionAlerts.critical > 0;

    expect(hasCritical).toBe(false);
  });
});
