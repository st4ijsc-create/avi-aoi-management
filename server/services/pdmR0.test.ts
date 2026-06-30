/**
 * R0 (doc 16 §9 Khối 4) — tests for the two closed loops:
 *   R0-1 sensor ingest  → machine_sensor_readings  (sensorIngestService)
 *   R0-2 predictive risk → maintenance_work_orders  (pdmAutoWorkOrderService)
 *
 * Both services dynamic-import ../db/connection + ../../drizzle/schema, so we mock
 * a minimal drizzle-shaped fake DB and assert mapping + idempotency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake DB capturing inserts + driving the idempotency select ───────────────
type Row = Record<string, any>;
const sensorRows: Row[] = [];
const workOrderRows: Row[] = [];
let machinesRows: Row[] = [{ id: 7, code: "CNC-07" }];
// What the idempotency SELECT should return (set per-test).
let existingOpenWoForMachine: Row[] = [];

function makeFakeDb() {
  return {
    insert: (table: any) => ({
      values: async (vals: Row) => {
        if (table?.__name === "machine_sensor_readings") sensorRows.push(vals);
        else if (table?.__name === "maintenance_work_orders") workOrderRows.push(vals);
        return undefined;
      },
    }),
    select: (_cols?: any) => ({
      from: (table: any) => ({
        where: (_pred: any) => ({
          limit: async () => {
            if (table?.__name === "machines") return machinesRows; // resolve machineId
            if (table?.__name === "maintenance_work_orders") return existingOpenWoForMachine;
            return [];
          },
        }),
      }),
    }),
  };
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

// Tag the schema tables our fakes branch on by name.
vi.mock("../../drizzle/schema", () => ({
  machines: { __name: "machines", code: "code", id: "id" },
  machineSensorReadings: { __name: "machine_sensor_readings" },
  maintenanceWorkOrders: {
    __name: "maintenance_work_orders",
    machineId: "machineId",
    type: "type",
    status: "status",
    id: "id",
  },
}));

// drizzle operators are only used to build predicates we ignore in the fake.
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => a,
  eq: (...a: any[]) => a,
  inArray: (...a: any[]) => a,
}));

import {
  parseSensorTopic,
  parseSensorMessage,
  handleSensorMessage,
  clearSensorMachineIdCache,
} from "./sensorIngestService";
import { maybeCreatePredictiveWorkOrder } from "./pdmAutoWorkOrderService";
import type { FailureRiskResult } from "./predictiveMaintenanceService";

beforeEach(() => {
  sensorRows.length = 0;
  workOrderRows.length = 0;
  existingOpenWoForMachine = [];
  machinesRows = [{ id: 7, code: "CNC-07" }];
  clearSensorMachineIdCache();
  delete process.env.PDM_SENSOR_INGEST_ENABLED;
  delete process.env.PDM_AUTO_WORKORDER_ENABLED;
});

// ── R0-1 — sensor ingest ─────────────────────────────────────────────────────

describe("R0-1 parseSensorTopic", () => {
  it("parses the convention topic", () => {
    expect(parseSensorTopic("factory/1/CNC-07/sensor/vibration")).toEqual({
      factoryId: "1",
      machineCode: "CNC-07",
      sensorType: "vibration",
    });
  });
  it("returns null for non-sensor topics", () => {
    expect(parseSensorTopic("avi/client/abc/info")).toBeNull();
    expect(parseSensorTopic("factory/1/CNC-07/status")).toBeNull();
  });
});

describe("R0-1 parseSensorMessage", () => {
  it("parses a bare numeric payload", () => {
    const r = parseSensorMessage("factory/1/CNC-07/sensor/current", "12.5");
    expect(r?.value).toBe(12.5);
    expect(r?.sensorType).toBe("current");
    expect(r?.unit).toBeNull();
  });
  it("parses a JSON payload with unit + timestamp", () => {
    const r = parseSensorMessage(
      "factory/1/CNC-07/sensor/vibration",
      JSON.stringify({ value: 0.42, unit: "mm/s", timestamp: "2026-06-30T10:00:00Z" }),
    );
    expect(r?.value).toBe(0.42);
    expect(r?.unit).toBe("mm/s");
    expect(r?.timestamp.toISOString()).toBe("2026-06-30T10:00:00.000Z");
  });
  it("returns null for non-numeric / malformed payloads", () => {
    expect(parseSensorMessage("factory/1/CNC-07/sensor/temp", "not-a-number")).toBeNull();
    expect(parseSensorMessage("factory/1/CNC-07/sensor/temp", "{bad json")).toBeNull();
    expect(parseSensorMessage("factory/1/CNC-07/sensor/temp", "")).toBeNull();
  });
});

describe("R0-1 handleSensorMessage — row write mapping", () => {
  it("no-op when flag off (no rows written)", async () => {
    const ok = await handleSensorMessage("factory/1/CNC-07/sensor/vibration", "0.42");
    expect(ok).toBe(false);
    expect(sensorRows).toHaveLength(0);
  });

  it("writes a mapped row when flag on + machine resolves", async () => {
    process.env.PDM_SENSOR_INGEST_ENABLED = "true";
    const ok = await handleSensorMessage(
      "factory/1/CNC-07/sensor/vibration",
      JSON.stringify({ value: 3.1, unit: "mm/s" }),
    );
    expect(ok).toBe(true);
    expect(sensorRows).toHaveLength(1);
    expect(sensorRows[0]).toMatchObject({
      machineId: 7,
      sensorType: "vibration",
      value: "3.1", // decimal column → string
      unit: "mm/s",
      source: "mqtt",
    });
    expect(sensorRows[0].timestamp).toBeInstanceOf(Date);
  });

  it("skips unknown machineCode (log + skip, no write, no throw)", async () => {
    process.env.PDM_SENSOR_INGEST_ENABLED = "true";
    machinesRows.length = 0; // machines.code lookup finds nothing → unknown machine
    const ok = await handleSensorMessage("factory/1/UNKNOWN-99/sensor/vibration", "0.5");
    expect(ok).toBe(false);
    expect(sensorRows).toHaveLength(0);
  });
});

// ── R0-2 — predictive risk → work order ──────────────────────────────────────

function riskResult(over: Partial<FailureRiskResult> = {}): FailureRiskResult {
  return {
    machineId: 7,
    failureRisk: 82,
    confidenceScore: 70,
    predictedTimeframe: "within 12 hours",
    predictedTimeframeHours: 12,
    recommendedMaintenanceDate: new Date("2026-07-01T00:00:00Z"),
    maintenanceUrgency: "CRITICAL",
    factors: [{ name: "trend", contribution: 80, description: "declining" }],
    dataPoints: 50,
    ...over,
  };
}

describe("R0-2 maybeCreatePredictiveWorkOrder — idempotency", () => {
  it("no-op when flag off", async () => {
    const created = await maybeCreatePredictiveWorkOrder({ id: 7, code: "CNC-07" }, riskResult());
    expect(created).toBe(false);
    expect(workOrderRows).toHaveLength(0);
  });

  it("creates a PREDICTIVE/OPEN WO when none open exists", async () => {
    process.env.PDM_AUTO_WORKORDER_ENABLED = "true";
    existingOpenWoForMachine = []; // no open WO
    const created = await maybeCreatePredictiveWorkOrder(
      { id: 7, code: "CNC-07" },
      riskResult(),
      { healthScore: 35 },
    );
    expect(created).toBe(true);
    expect(workOrderRows).toHaveLength(1);
    expect(workOrderRows[0]).toMatchObject({
      machineId: 7,
      machineCode: "CNC-07",
      type: "PREDICTIVE",
      status: "OPEN",
      trigger: "PREDICTED_FAILURE",
      predictedFailureRisk: 82,
      healthScore: 35,
      priority: 1, // CRITICAL → 1
    });
    expect(workOrderRows[0].description).toContain("82%");
  });

  it("does NOT create a duplicate when an open predictive WO already exists", async () => {
    process.env.PDM_AUTO_WORKORDER_ENABLED = "true";
    existingOpenWoForMachine = [{ id: 99 }]; // an open WO already exists
    const created = await maybeCreatePredictiveWorkOrder({ id: 7, code: "CNC-07" }, riskResult());
    expect(created).toBe(false);
    expect(workOrderRows).toHaveLength(0);
  });
});
