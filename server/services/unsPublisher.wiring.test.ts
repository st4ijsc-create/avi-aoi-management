/**
 * Sprint F4 HITL — unsPublisher ↔ SparkplugCommandHandler WIRING.
 *
 * Covers the two NEW pure mapping deps the publisher injects into the (already
 * tested) SparkplugCommandHandler:
 *   - resolveSparkplugTarget(group,node,device) → {machineId, adapterId} | null:
 *       device "Station{N}" → machines.stationId=N (active) → enabled adapter.
 *       null when device shape unknown / no machine / no enabled adapter.
 *   - sparkplugMetricToWrite(metric) → {tagKey,value,commandType} | null:
 *       metric NAME becomes the dispatcher tagKey (dispatch enforces tag.writable);
 *       Rebirth + nameless metrics are ignored.
 *
 * DB + drizzle + schema + dispatcher are mocked (offline, no broker, no server).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory fixtures the fake db reads from.
let data: { machines?: any[]; adapters?: any[] } = {};

function terminal(rows: any[]): any {
  return {
    limit: async (_n: number) => rows,
    then: (resolve: (v: any[]) => void) => resolve(rows),
  };
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: (_cols?: unknown) => ({
      from: (t: any) => ({
        where: (_pred: unknown) =>
          terminal(t.__table === "machines" ? data.machines ?? [] : data.adapters ?? []),
      }),
    }),
  })),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => () => true,
  and: () => () => true,
}));

vi.mock("../../drizzle/schema", () => ({
  machines: { __table: "machines", id: {}, stationId: {}, isActive: {} },
  deviceAdapters: { __table: "deviceAdapters", id: {}, machineId: {}, isEnabled: {} },
}));

// The command dispatcher pulls in heavy OT deps; stub it (this test never dispatches).
vi.mock("./ot/commandDispatcher", () => ({
  dispatch: vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] })),
}));

// mqtt is imported at module top of unsPublisher; stub so import is side-effect free.
vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));

import { resolveSparkplugTarget, sparkplugMetricToWrite } from "./unsPublisher";

beforeEach(() => {
  data = {};
});

describe("resolveSparkplugTarget — Station{N} → {machineId, adapterId}", () => {
  it("resolves a known active station with an enabled adapter", async () => {
    data.machines = [{ id: 7 }];
    data.adapters = [{ id: 3 }];
    const t = await resolveSparkplugTarget("avi", "avi-aoi-ot", "Station45");
    expect(t).toEqual({ machineId: 7, adapterId: 3 });
  });

  it("returns null when the device id is not Station{N}", async () => {
    expect(await resolveSparkplugTarget("avi", "avi-aoi-ot", "Press1")).toBeNull();
    expect(await resolveSparkplugTarget("avi", "avi-aoi-ot", undefined)).toBeNull();
  });

  it("returns null when no active machine maps to the station", async () => {
    data.machines = [];
    data.adapters = [{ id: 3 }];
    expect(await resolveSparkplugTarget("avi", "avi-aoi-ot", "Station45")).toBeNull();
  });

  it("returns null when the machine has no enabled adapter", async () => {
    data.machines = [{ id: 7 }];
    data.adapters = [];
    expect(await resolveSparkplugTarget("avi", "avi-aoi-ot", "Station45")).toBeNull();
  });
});

describe("sparkplugMetricToWrite — metric → dispatcher write", () => {
  it("maps a named metric to a write keyed by the metric name", () => {
    expect(sparkplugMetricToWrite({ name: "cmd_stop", type: "Boolean", value: true })).toEqual({
      tagKey: "cmd_stop",
      value: true,
      commandType: "sparkplug_dcmd",
    });
  });

  it("ignores the well-known Rebirth metric (handled by onRebirth)", () => {
    expect(
      sparkplugMetricToWrite({ name: "Node Control/Rebirth", type: "Boolean", value: true }),
    ).toBeNull();
  });

  it("ignores nameless / alias-only metrics", () => {
    expect(sparkplugMetricToWrite({ alias: 5, type: "Int64", value: 1 })).toBeNull();
    expect(sparkplugMetricToWrite({ name: "  ", type: "Int64", value: 1 })).toBeNull();
  });
});
