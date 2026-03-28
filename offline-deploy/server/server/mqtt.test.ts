import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("mqttClient router", () => {
  describe("status", () => {
    it("returns MQTT broker status", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.status();

      expect(result).toHaveProperty("enabled");
      expect(result).toHaveProperty("external");
      expect(result.external).toHaveProperty("enabled");
      expect(result.external).toHaveProperty("connected");
    });
  });

  describe("dashboardStats", () => {
    it("returns dashboard statistics", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.dashboardStats();

      expect(result).toHaveProperty("clients");
      expect(result.clients).toHaveProperty("total");
      expect(result.clients).toHaveProperty("online");
      expect(result.clients).toHaveProperty("offline");
      expect(result).toHaveProperty("messages");
      expect(result.messages).toHaveProperty("total");
      expect(result.messages).toHaveProperty("delivered");
      expect(result).toHaveProperty("breakdown");
    });
  });

  describe("messageTrend", () => {
    it("returns message trend for default 7 days", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.messageTrend({ days: 7 });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("date");
        expect(result[0]).toHaveProperty("total");
        expect(result[0]).toHaveProperty("delivered");
        expect(result[0]).toHaveProperty("failed");
        expect(result[0]).toHaveProperty("ngAlerts");
      }
    });
  });

  describe("recentMessages", () => {
    it("returns recent messages list", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.recentMessages({ limit: 10 });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("realtimeStats", () => {
    it("returns realtime MQTT statistics", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.realtimeStats();

      expect(result).toHaveProperty("localBroker");
      expect(result.localBroker).toHaveProperty("enabled");
      expect(result.localBroker).toHaveProperty("port");
      
      expect(result).toHaveProperty("externalBroker");
      expect(result.externalBroker).toHaveProperty("enabled");
      expect(result.externalBroker).toHaveProperty("broker");
      expect(result.externalBroker).toHaveProperty("connected");
      expect(result.externalBroker).toHaveProperty("useTLS");
      expect(result.externalBroker).toHaveProperty("hasCredentials");
      
      expect(result).toHaveProperty("throughput");
      expect(result.throughput).toHaveProperty("lastMinute");
      expect(result.throughput).toHaveProperty("last5Minutes");
      expect(result.throughput).toHaveProperty("lastHour");
      
      expect(result).toHaveProperty("latency");
      expect(result.latency).toHaveProperty("avgMs");
      expect(result.latency).toHaveProperty("minMs");
      expect(result.latency).toHaveProperty("maxMs");
      expect(result.latency).toHaveProperty("p95Ms");
      
      expect(result).toHaveProperty("messages");
      expect(result).toHaveProperty("timestamp");
    });
  });

  describe("testNGAlert", () => {
    it("publishes test NG alert successfully", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.testNGAlert({
        machineName: "Test Machine",
        serialNumber: "SN-TEST-001",
        ngPointName: "Test Point",
        ngValue: 0.5,
      });

      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("data");
      expect(result.data).toHaveProperty("machineName", "Test Machine");
      expect(result.data).toHaveProperty("serialNumber", "SN-TEST-001");
      expect(result).toHaveProperty("mqttEnabled");
    });

    it("generates unique inspection ID for each call", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result1 = await caller.mqttClient.testNGAlert({
        machineName: "Test Machine 1",
        serialNumber: "SN-001",
      });

      const result2 = await caller.mqttClient.testNGAlert({
        machineName: "Test Machine 2",
        serialNumber: "SN-002",
      });

      expect(result1.data.inspectionId).not.toBe(result2.data.inspectionId);
    });
  });

  describe("list", () => {
    it("returns list of MQTT clients", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.list({});

      expect(Array.isArray(result)).toBe(true);
    });

    it("filters by approval status", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.list({
        approvalStatus: "APPROVED",
      });

      expect(Array.isArray(result)).toBe(true);
      result.forEach((client: { approvalStatus: string }) => {
        expect(client.approvalStatus).toBe("APPROVED");
      });
    });
  });
});


describe("mqttAlert router", () => {
  describe("list", () => {
    it("returns list of alert rules", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttAlert.list();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("create", () => {
    it("creates a new alert rule", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttAlert.create({
        name: "Test Latency Alert",
        description: "Alert when latency exceeds 1000ms",
        ruleType: "LATENCY_THRESHOLD",
        thresholdValue: 1000,
        thresholdUnit: "ms",
        comparisonOperator: "GT",
        timeWindowMinutes: 5,
        notifyOwner: true,
        notifyEmail: false,
        notifyMqtt: false,
        cooldownMinutes: 15,
      });

      expect(result).toHaveProperty("id");
      expect(typeof result?.id).toBe("number");
    });
  });

  describe("history", () => {
    it("returns alert history", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttAlert.history({ limit: 10 });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("unresolved", () => {
    it("returns unresolved alerts", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttAlert.unresolved();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("throughputHistory", () => {
    it("returns throughput history data", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.mqttClient.throughputHistory({ minutes: 60 });

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("time");
        expect(result[0]).toHaveProperty("count");
        expect(result[0]).toHaveProperty("delivered");
        expect(result[0]).toHaveProperty("failed");
        expect(result[0]).toHaveProperty("ngAlerts");
      }
    });
  });
});


describe("Alert Evaluation Service", () => {
  describe("evaluateAllAlertRules", () => {
    it("returns empty array when no enabled rules", async () => {
      const { evaluateAllAlertRules } = await import("./services/alertEvaluationService");
      
      const results = await evaluateAllAlertRules();
      
      expect(Array.isArray(results)).toBe(true);
    }, 60000); // Increased timeout for Redis connection and cache warming
  });

  describe("alert rule CRUD", () => {
    it("creates and retrieves alert rule", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.mqttAlert.create({
        name: "Test Alert Rule",
        description: "Test description",
        ruleType: "LATENCY_THRESHOLD",
        thresholdValue: 500,
        thresholdUnit: "ms",
        comparisonOperator: "GT",
        timeWindowMinutes: 5,
        notifyOwner: true,
        notifyEmail: false,
        notifyMqtt: false,
        cooldownMinutes: 10,
      });

      expect(created).toHaveProperty("id");

      const rules = await caller.mqttAlert.list();
      const found = rules.find((r: any) => r.id === created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Test Alert Rule");
    });

    it("toggles alert rule enabled status", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.mqttAlert.create({
        name: "Toggle Test",
        description: "Test",
        ruleType: "BROKER_DISCONNECT",
        thresholdValue: 5,
        thresholdUnit: "minutes",
        comparisonOperator: "GT",
        timeWindowMinutes: 5,
        notifyOwner: true,
        notifyEmail: false,
        notifyMqtt: false,
        cooldownMinutes: 10,
      });

      await caller.mqttAlert.toggle({ id: created.id, isEnabled: false });

      const rules = await caller.mqttAlert.list();
      const found = rules.find((r: any) => r.id === created.id);
      expect(found?.isEnabled).toBe(false);
    });

    it("deletes alert rule", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const created = await caller.mqttAlert.create({
        name: "Delete Test",
        description: "Test",
        ruleType: "MESSAGE_FAILURE_RATE",
        thresholdValue: 10,
        thresholdUnit: "%",
        comparisonOperator: "GT",
        timeWindowMinutes: 5,
        notifyOwner: true,
        notifyEmail: false,
        notifyMqtt: false,
        cooldownMinutes: 10,
      });

      await caller.mqttAlert.delete({ id: created.id });

      const rules = await caller.mqttAlert.list();
      const found = rules.find((r: any) => r.id === created.id);
      expect(found).toBeUndefined();
    });
  });
});
