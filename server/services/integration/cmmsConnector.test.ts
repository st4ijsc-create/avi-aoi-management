/**
 * CMMS connector tests — doc 44 W6-5 (G5.24).
 *
 * Covers: OUTBOUND predictive-recommendation idempotency + reuse of the PdM work
 * orders, PURE anti-corruption schedule mapping, INBOUND schedule upsert (machine
 * resolution + id-map), skip on unresolved machine, and AUTONOMY on a dead CMMS.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./erpOutbox", () => {
  const store = new Map<string, number>();
  let id = 0;
  return {
    enqueueOutbox: vi.fn(async (input: any) => {
      if (input.idempotencyKey && store.has(input.idempotencyKey)) return { ok: true, id: store.get(input.idempotencyKey), duplicate: true };
      id += 1;
      if (input.idempotencyKey) store.set(input.idempotencyKey, id);
      return { ok: true, id };
    }),
  };
});

vi.mock("../../db/connection", () => ({
  getDb: async () => (await import("./enterpriseIntegration.testkit")).makeFakeDb(),
}));

import {
  pushMaintenanceRecommendation, syncPredictiveWorkOrdersToCmms,
  mapCmmsSchedule, mapCmmsScheduleType, upsertMaintenanceSchedule, ingestCmmsSchedule, pullSchedules,
} from "./cmmsConnector";
import { maintenanceWorkOrders, maintenanceSchedules, machines, enterpriseIdMap, enterpriseSyncLog } from "../../../drizzle/schema";
import { resetFakeDb, queueSelect, fakeDbState } from "./enterpriseIntegration.testkit";
import { enqueueOutbox } from "./erpOutbox";

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  process.env.CMMS_INTEGRATION_ENABLED = "true";
  process.env.CMMS_OUTBOUND_ENDPOINT = "https://cmms.test/hook";
});

describe("outbound (push PdM/RUL recommendations, idempotent)", () => {
  it("pushMaintenanceRecommendation dedupes per work-order number", async () => {
    const a = await pushMaintenanceRecommendation({ workOrderNumber: "WO-PDM-1", machineId: 9, failureRisk: 88 });
    const b = await pushMaintenanceRecommendation({ workOrderNumber: "WO-PDM-1", machineId: 9, failureRisk: 91 });
    expect(a.ok).toBe(true);
    expect(b.duplicate).toBe(true);
    expect((enqueueOutbox as any).mock.calls[0][0].payload.kind).toBe("cmms.maintenance.recommendation");
  });

  it("syncPredictiveWorkOrdersToCmms reuses the PdM work orders and pushes each", async () => {
    queueSelect(maintenanceWorkOrders, [
      { workOrderNumber: "WO-PDM-SYNC-42", machineId: 9, machineCode: "MC-01", predictedFailureRisk: "88", priority: 2, title: "t", description: "d", scheduledFor: null },
    ]);
    const r = await syncPredictiveWorkOrdersToCmms();
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(r.pushed).toBe(1);
    expect(enqueueOutbox).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the CMMS flag is OFF", async () => {
    process.env.CMMS_INTEGRATION_ENABLED = "false";
    const r = await syncPredictiveWorkOrdersToCmms();
    expect(r.disabled).toBe(true);
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });
});

describe("anti-corruption schedule mapping (pure)", () => {
  it("mapCmmsScheduleType maps CMMS bases onto the canonical enum", () => {
    expect(mapCmmsScheduleType("time")).toBe("TIME_BASED");
    expect(mapCmmsScheduleType("runtime hours")).toBe("USAGE_BASED");
    expect(mapCmmsScheduleType("condition")).toBe("CONDITION_BASED");
    expect(mapCmmsScheduleType("predictive")).toBe("PREDICTIVE");
    expect(mapCmmsScheduleType(undefined)).toBe("TIME_BASED");
  });

  it("mapCmmsSchedule translates fields, dropping CMMS-only ones", () => {
    const sched = mapCmmsSchedule({ id: "PM-1", taskName: "Lube spindle", assetCode: "MC-01", pmType: "time", frequencyDays: 30, cmmsInternalPriority: "ZZZ" });
    expect(sched).toEqual({
      externalId: "PM-1", machineExternalId: null, machineCode: "MC-01", taskName: "Lube spindle",
      description: null, scheduleType: "TIME_BASED", intervalDays: 30, nextDueAt: null,
    });
    expect(JSON.stringify(sched)).not.toContain("cmmsInternalPriority");
  });
});

describe("inbound schedule upsert", () => {
  it("resolves the machine by code, inserts the schedule + id-map", async () => {
    queueSelect(machines, [{ id: 9 }]); // machineCode resolve
    queueSelect(enterpriseIdMap, []); // resolveInternalId(maintenance_schedule) → none
    queueSelect(maintenanceSchedules, []); // find-by-(machine,task) → none
    queueSelect(enterpriseIdMap, []); // upsertIdMap existing lookup
    const r = await upsertMaintenanceSchedule({
      externalId: "PM-1", machineExternalId: null, machineCode: "MC-01", taskName: "Lube spindle",
      description: null, scheduleType: "TIME_BASED", intervalDays: 30, nextDueAt: null,
    });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === maintenanceSchedules)).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === enterpriseIdMap)).toBe(true);
  });

  it("skips (not error) when the machine can't be resolved", async () => {
    queueSelect(machines, []); // unresolved
    const r = await upsertMaintenanceSchedule({
      externalId: "PM-2", machineExternalId: null, machineCode: "NOPE", taskName: "t",
      description: null, scheduleType: "TIME_BASED", intervalDays: null, nextDueAt: null,
    });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === maintenanceSchedules)).toBe(false);
  });

  it("ingestCmmsSchedule maps + upserts + records the sync", async () => {
    queueSelect(machines, [{ id: 9 }]);
    queueSelect(enterpriseIdMap, []);
    queueSelect(maintenanceSchedules, []);
    queueSelect(enterpriseIdMap, []);
    const r = await ingestCmmsSchedule({ id: "PM-1", taskName: "Lube spindle", assetCode: "MC-01", pmType: "time", frequencyDays: 30 });
    expect(r.ok).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === enterpriseSyncLog)).toBe(true);
  });
});

describe("autonomy when the CMMS is down", () => {
  it("pullSchedules fails-safe (ok:false, no throw)", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const r = await pullSchedules({ url: "https://cmms.test/pm", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNRESET/);
  });
});
