/**
 * VDA 5050 framework tests (vitest). No broker / no real AGV / no DB needed:
 *   - getDb is mocked (telemetry/connection writes become no-ops we can observe).
 *   - getActiveRobot is mocked so the dispatcher's active-robot gate is satisfied,
 *     letting us prove DRY-RUN: 'simulated', NO mqtt publish unless control enabled.
 *
 * Covers:
 *   1. State JSON → robot_telemetry mapping (position / battery / mode / errors / estop)
 *   2. Connection → online/offline
 *   3. Order builder produces valid VDA 5050 Order JSON
 *   4. Command publish is DRY-RUN (no MQTT publish) unless ROBOT_CONTROL_ENABLED
 *   5. Real publish happens when control enabled
 *   6. flag-off no-op (manager start returns false)
 *   7. fail-safe on bad JSON (onMessage never throws, no telemetry written)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── DB mock ─────────────────────────────────────────────────────────────────
const telemetryInserts: any[] = [];
const robotUpdates: any[] = [];

function makeDbMock() {
  return {
    insert: (_table: any) => ({
      values: (v: any) => {
        telemetryInserts.push(v);
        const p: any = Promise.resolve();
        // dispatcher uses .returning() on its job insert; telemetry ingest does not.
        p.returning = () => Promise.resolve([{ id: 999 }]);
        return p;
      },
    }),
    update: (_table: any) => ({
      set: (v: any) => ({
        where: () => {
          robotUpdates.push(v);
          return Promise.resolve();
        },
      }),
    }),
    // dispatcher idempotency lookup path (no prior job)
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  };
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => makeDbMock()),
}));

// ── robotManager mock: provide an "active + connected" robot for the dispatcher ─
const activeRobot = {
  id: 42,
  code: "ACME:AGV-001",
  driver: {
    isConnected: () => true,
    runJob: vi.fn(async () => ({ ok: true, status: "done" as const, detail: { published: true } })),
  },
};
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: vi.fn((id: number) => (id === 42 ? activeRobot : undefined)),
}));

// ── fake mqtt client capturing publishes ──────────────────────────────────────
const publishes: Array<{ topic: string; payload: string }> = [];
function makeFakeClient() {
  return {
    handlers: {} as Record<string, (...a: any[]) => void>,
    on(ev: string, cb: (...a: any[]) => void) {
      this.handlers[ev] = cb;
    },
    subscribe() {},
    publish(topic: string, payload: string, _opts: any, cb?: (e?: Error | null) => void) {
      publishes.push({ topic, payload });
      cb?.(null);
    },
    end(_f?: boolean, _o?: unknown, cb?: () => void) {
      cb?.();
    },
    connected: true,
  };
}
let fakeClient: ReturnType<typeof makeFakeClient>;
vi.mock("mqtt", () => ({
  connect: vi.fn(() => {
    fakeClient = makeFakeClient();
    return fakeClient;
  }),
}));

import {
  mapStateToRobotTelemetry,
  mapConnectionToOnline,
  buildOrder,
  jobToOrderNodes,
} from "./vda5050Mapping";
import type { Vda5050State } from "./vda5050Messages";
import { buildVda5050Topic, VDA5050_VERSION } from "./vda5050Messages";

function sampleState(over: Partial<Vda5050State> = {}): Vda5050State {
  return {
    headerId: 7,
    timestamp: "2026-06-28T10:00:00.000Z",
    version: "2.0.0",
    manufacturer: "ACME",
    serialNumber: "AGV-001",
    orderId: "ord-1",
    orderUpdateId: 0,
    lastNodeId: "n2",
    lastNodeSequenceId: 4,
    operatingMode: "AUTOMATIC",
    driving: true,
    paused: false,
    agvPosition: { x: 12.5, y: -3.2, theta: 1.57, mapId: "shopfloor", positionInitialized: true },
    velocity: { vx: 1.0, vy: 0, omega: 0.1 },
    batteryState: { batteryCharge: 87.5, charging: false, batteryVoltage: 48.2 },
    errors: [],
    safetyState: { eStop: "NONE", fieldViolation: false },
    ...over,
  };
}

beforeEach(() => {
  telemetryInserts.length = 0;
  robotUpdates.length = 0;
  publishes.length = 0;
  delete process.env.ROBOT_CONTROL_ENABLED;
  delete process.env.VDA5050_ENABLED;
  // Các test này kiểm tra publish MQTT của VDA5050 — mối quan tâm ĐỘC LẬP với robot
  // commissioning gate (CTL-02). Tắt gate để cô lập (robot fixture chưa commissioned).
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
});
afterEach(() => {
  delete process.env.ROBOT_CONTROL_ENABLED;
  delete process.env.VDA5050_ENABLED;
  delete process.env.ROBOT_COMMISSIONING_REQUIRED;
});

describe("VDA5050 State → robot_telemetry mapping", () => {
  it("maps position, mode, busy, battery, no error", () => {
    const rs = mapStateToRobotTelemetry(sampleState());
    expect(rs.mode).toBe("auto"); // AUTOMATIC → auto
    expect(rs.busy).toBe(true); // driving && !paused
    expect(rs.estop).toBe(false);
    expect(rs.pose?.cartesian).toEqual({ x: 12.5, y: -3.2, z: 0, rz: 1.57 });
    expect(rs.pose?.frame).toBe("shopfloor");
    expect(rs.error).toBeUndefined();
    expect(rs.timestamp.toISOString()).toBe("2026-06-28T10:00:00.000Z");
    // velocity 1 m/s of nominal 2 → ~50%
    expect(rs.speedPct).toBe(50);
  });

  it("FATAL error and eStop surface as estop + errorText", () => {
    const rs = mapStateToRobotTelemetry(
      sampleState({
        operatingMode: "MANUAL",
        errors: [{ errorType: "motorOverheat", errorLevel: "FATAL", errorDescription: "left drive" }],
        safetyState: { eStop: "MANUAL", fieldViolation: true },
      }),
    );
    expect(rs.mode).toBe("manual");
    expect(rs.estop).toBe(true);
    expect(rs.error).toMatch(/FATAL/);
    expect(rs.error).toMatch(/motorOverheat/);
    expect(rs.error).toMatch(/field violation/);
  });

  it("paused AGV is not busy", () => {
    const rs = mapStateToRobotTelemetry(sampleState({ driving: false, paused: true }));
    expect(rs.busy).toBe(false);
  });
});

describe("VDA5050 Connection → online/offline", () => {
  it("ONLINE → true; OFFLINE / CONNECTIONBROKEN → false", () => {
    expect(mapConnectionToOnline({ connectionState: "ONLINE" })).toBe(true);
    expect(mapConnectionToOnline({ connectionState: "OFFLINE" })).toBe(false);
    expect(mapConnectionToOnline({ connectionState: "CONNECTIONBROKEN" })).toBe(false);
  });
});

describe("VDA5050 Order builder", () => {
  it("produces valid Order JSON with header, nodes, auto-chained edges", () => {
    const order = buildOrder({
      manufacturer: "ACME",
      serialNumber: "AGV-001",
      orderId: "ord-9",
      headerId: 1,
      nodes: [
        { nodeId: "start", x: 0, y: 0, mapId: "shopfloor" },
        { nodeId: "dock", x: 10, y: 5, theta: 0, mapId: "shopfloor" },
      ],
    });
    expect(order.version).toBe(VDA5050_VERSION);
    expect(order.manufacturer).toBe("ACME");
    expect(order.serialNumber).toBe("AGV-001");
    expect(order.orderId).toBe("ord-9");
    expect(order.orderUpdateId).toBe(0);
    expect(order.nodes).toHaveLength(2);
    expect(order.nodes[0].released).toBe(true);
    expect(order.nodes[0].sequenceId).toBe(0);
    expect(order.nodes[1].sequenceId).toBe(1);
    expect(order.nodes[1].nodePosition).toEqual({ x: 10, y: 5, theta: 0, mapId: "shopfloor" });
    // one auto-chained edge between the two nodes
    expect(order.edges).toHaveLength(1);
    expect(order.edges[0].startNodeId).toBe("start");
    expect(order.edges[0].endNodeId).toBe("dock");
    expect(order.edges[0].released).toBe(true);
    // JSON-serializable
    expect(() => JSON.parse(JSON.stringify(order))).not.toThrow();
  });

  it("jobToOrderNodes parses single {x,y} and nodes[] forms; rejects garbage", () => {
    expect(jobToOrderNodes({ x: 1, y: 2, mapId: "m" })).toEqual([
      { nodeId: "target", x: 1, y: 2, theta: undefined, mapId: "m" },
    ]);
    expect(jobToOrderNodes({ nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toHaveLength(2);
    expect(jobToOrderNodes({ foo: "bar" })).toBeNull();
    expect(jobToOrderNodes(undefined)).toBeNull();
  });

  it("topic builder follows <iface>/v2/<mfr>/<serial>/<topic>", () => {
    expect(buildVda5050Topic("uagv", "ACME", "AGV-001", "order")).toBe("uagv/v2/ACME/AGV-001/order");
  });
});

describe("VDA5050 Adapter command gating (DRY-RUN)", () => {
  async function makeStartedAdapter() {
    const { Vda5050Adapter } = await import("./vda5050Adapter");
    const adapter = new Vda5050Adapter({
      robotId: 42,
      code: "ACME:AGV-001",
      manufacturer: "ACME",
      serialNumber: "AGV-001",
      interfaceName: "uagv",
      brokerUrl: "mqtt://127.0.0.1:1883",
    });
    await adapter.start();
    // simulate broker connect so a client exists
    fakeClient.handlers["connect"]?.();
    return adapter;
  }

  it("dry-run: dispatcher records simulated, NO mqtt publish", async () => {
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder({
      nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
      requestedBy: 1,
      confirmedBy: 1,
    });
    expect(res.status).toBe("simulated");
    expect(res.published).toBe(false);
    expect(res.order).toBeDefined(); // Order JSON still built for inspection
    expect(publishes.length).toBe(0); // NOTHING published to MQTT
  });

  it("HITL gate: no confirmedBy → rejected, no publish", async () => {
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder({
      nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
      requestedBy: 1,
      // confirmedBy omitted → HITL gate rejects
    });
    expect(res.status).toBe("rejected");
    expect(res.published).toBe(false);
    expect(publishes.length).toBe(0);
  });

  it("control enabled: dispatcher runs driver (done) → adapter publishes Order to MQTT", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder({
      nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
      requestedBy: 1,
      confirmedBy: 1,
    });
    expect(res.status).toBe("done");
    expect(res.published).toBe(true);
    expect(publishes.length).toBe(1);
    expect(publishes[0].topic).toBe("uagv/v2/ACME/AGV-001/order");
    const sent = JSON.parse(publishes[0].payload);
    expect(sent.serialNumber).toBe("AGV-001");
    expect(sent.nodes).toHaveLength(1);
  });
});

describe("VDA5050 Adapter read path + fail-safe", () => {
  // Generous timeout: dynamic adapter import + DB-integration insert can
  // exceed vitest's 5s default under full-suite parallel load (observed
  // flaking once the suite grew past ~390 files; passes in 2.4s alone).
  it("State message → telemetry insert via robotIngest", { timeout: 20_000 }, async () => {
    const { Vda5050Adapter } = await import("./vda5050Adapter");
    const adapter = new Vda5050Adapter({
      robotId: 42,
      code: "ACME:AGV-001",
      manufacturer: "ACME",
      serialNumber: "AGV-001",
      interfaceName: "uagv",
      brokerUrl: "mqtt://x",
    });
    await adapter.onMessage("uagv/v2/ACME/AGV-001/state", JSON.stringify(sampleState()));
    expect(telemetryInserts.length).toBe(1);
    expect(telemetryInserts[0].robotId).toBe(42);
    expect(telemetryInserts[0].mode).toBe("auto");
  });

  it("connection message flips online + updates robot row", async () => {
    const { Vda5050Adapter } = await import("./vda5050Adapter");
    const adapter = new Vda5050Adapter({
      robotId: 42,
      code: "ACME:AGV-001",
      manufacturer: "ACME",
      serialNumber: "AGV-001",
      interfaceName: "uagv",
      brokerUrl: "mqtt://x",
    });
    await adapter.onMessage(
      "uagv/v2/ACME/AGV-001/connection",
      JSON.stringify({ connectionState: "ONLINE", manufacturer: "ACME", serialNumber: "AGV-001" }),
    );
    expect(adapter.isOnline()).toBe(true);
    expect(robotUpdates.some((u) => u.status === "online")).toBe(true);
  });

  it("fail-safe: bad JSON does not throw and writes no telemetry", async () => {
    const { Vda5050Adapter } = await import("./vda5050Adapter");
    const adapter = new Vda5050Adapter({
      robotId: 42,
      code: "x",
      manufacturer: "ACME",
      serialNumber: "AGV-001",
      interfaceName: "uagv",
      brokerUrl: "mqtt://x",
    });
    await expect(
      adapter.onMessage("uagv/v2/ACME/AGV-001/state", "{not json"),
    ).resolves.toBeUndefined();
    expect(telemetryInserts.length).toBe(0);
  });
});

describe("VDA5050 manager flag gating", () => {
  it("flag OFF → startVda5050 is a no-op returning false", async () => {
    const { startVda5050 } = await import("./vda5050Manager");
    expect(await startVda5050()).toBe(false);
  });
});
