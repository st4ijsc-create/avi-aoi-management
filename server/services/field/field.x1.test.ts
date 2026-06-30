/**
 * X1 (doc 16 Khối 1 §5) — Field & Device Abstraction backend tests.
 *
 * Layers (mirrors fleet.g1 / twin.t1 style — pure-fn + flag-off, no real DB):
 *   • PURE: heartbeat liveness classifier (TTL → live/stale/lost_connection),
 *     tiered sampling (tierForMetric + isDue + coalesce), command-authz permission
 *     parse + descriptor resolution, UDM battery wire-through (vda5050 mapping).
 *   • FLAG-OFF: recordHeartbeat / sweepFieldHealth / discoverDevices / authorizeCommand
 *     are all no-ops / pass-throughs unless FIELD_V2_ENABLED.
 *   • DISCOVERY honesty: opcua=real-shape, mdns/others=seam (no fabricated results).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("X1-b — heartbeat TTL liveness classifier (pure)", () => {
  it("classifies by heartbeat age against TTL + lost factor", async () => {
    const { classifyLiveness } = await import("./fieldHealthService");
    const now = new Date("2026-06-30T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    // TTL=2000ms, lostFactor=5 → live<=2s, stale<=10s, lost>10s.
    expect(classifyLiveness(null, now, 2000, 5)).toBe("unknown");
    expect(classifyLiveness(ago(500), now, 2000, 5)).toBe("live");
    expect(classifyLiveness(ago(2000), now, 2000, 5)).toBe("live"); // boundary inclusive
    expect(classifyLiveness(ago(3000), now, 2000, 5)).toBe("stale");
    expect(classifyLiveness(ago(10000), now, 2000, 5)).toBe("stale"); // boundary inclusive
    expect(classifyLiveness(ago(10001), now, 2000, 5)).toBe("lost_connection");
    expect(classifyLiveness(ago(60000), now, 2000, 5)).toBe("lost_connection");
  });

  it("uses fail-safe defaults for bad ttl/multiplier", async () => {
    const { classifyLiveness } = await import("./fieldHealthService");
    const now = new Date();
    // ttl<=0 → defaults to 2000; mult<1 → 1 (lost == stale boundary).
    expect(classifyLiveness(new Date(now.getTime() - 1000), now, 0, 0.5)).toBe("live");
    expect(classifyLiveness(new Date(now.getTime() - 5000), now, 2000, 0.5)).toBe("lost_connection");
  });
});

describe("X1-c — tiered sampling (pure)", () => {
  beforeEach(() => {
    delete process.env.FIELD_STREAM_HZ_POSITION;
    delete process.env.FIELD_STREAM_HZ_STATE;
    delete process.env.FIELD_STREAM_HZ_SLOW;
    delete process.env.FIELD_STREAM_HZ_DEFAULT;
  });

  it("maps metric names to tiers", async () => {
    const { tierForMetric } = await import("./deviceStream");
    expect(tierForMetric("position_x")).toBe("position");
    expect(tierForMetric("pose")).toBe("position");
    expect(tierForMetric("state")).toBe("state");
    expect(tierForMetric("estop")).toBe("state");
    expect(tierForMetric("temperature")).toBe("slow");
    expect(tierForMetric("yield")).toBe("default");
  });

  it("isDue enforces per-tier rate windows", async () => {
    const { isDue } = await import("./deviceStream");
    const t0 = 1_000_000;
    // position 10Hz → 100ms window
    expect(isDue("position", t0, undefined)).toBe(true); // never emitted → due
    expect(isDue("position", t0 + 50, t0)).toBe(false); // 50ms < 100ms
    expect(isDue("position", t0 + 120, t0)).toBe(true); // 120ms >= 100ms
    // state 1Hz → 1000ms window
    expect(isDue("state", t0 + 500, t0)).toBe(false);
    expect(isDue("state", t0 + 1000, t0)).toBe(true);
    // slow 0.1Hz → 10000ms window
    expect(isDue("slow", t0 + 5000, t0)).toBe(false);
    expect(isDue("slow", t0 + 11000, t0)).toBe(true);
  });

  it("coalesces a burst to the latest value per metric within the tier window", async () => {
    const mod = await import("./deviceStream");
    process.env.FIELD_V2_ENABLED = "true";
    mod._reset();
    const now = 2_000_000;
    // 3 rapid position_x samples for the same device → last value wins, ONE emit.
    mod._ingestForTest([
      { machineId: 7, metric: "position_x", numValue: 1, textValue: null, boolValue: null, protocol: "opcua", ts: new Date() } as any,
      { machineId: 7, metric: "position_x", numValue: 2, textValue: null, boolValue: null, protocol: "opcua", ts: new Date() } as any,
      { machineId: 7, metric: "position_x", numValue: 5, textValue: null, boolValue: null, protocol: "opcua", ts: new Date() } as any,
    ]);
    const first = mod._collectFlush(now);
    expect(first).toHaveLength(1);
    expect(first[0].deviceId).toBe("machine:7");
    expect(first[0].metrics.position_x).toBe(5); // coalesced to latest
    // Immediately re-ingest + flush within the 100ms window → rate-limited, no emit.
    mod._ingestForTest([
      { machineId: 7, metric: "position_x", numValue: 9, textValue: null, boolValue: null, protocol: "opcua", ts: new Date() } as any,
    ]);
    const second = mod._collectFlush(now + 50);
    expect(second).toHaveLength(0); // within tier window → suppressed
    // After the window elapses → emits again.
    const third = mod._collectFlush(now + 200);
    expect(third).toHaveLength(1);
    expect(third[0].metrics.position_x).toBe(9);
    mod._reset();
    delete process.env.FIELD_V2_ENABLED;
  });

  it("ingest is a no-op when FIELD_V2_ENABLED is off", async () => {
    const mod = await import("./deviceStream");
    delete process.env.FIELD_V2_ENABLED;
    mod._reset();
    mod._ingestForTest([
      { machineId: 1, metric: "position_x", numValue: 1, textValue: null, boolValue: null, protocol: "opcua", ts: new Date() } as any,
    ]);
    expect(mod._pendingCount()).toBe(0);
  });
});

describe("X1-a — UDM battery wire-through (vda5050 mapping, pure)", () => {
  it("surfaces AGV batteryCharge as RobotState.batteryPct", async () => {
    const { mapStateToRobotTelemetry } = await import("../vda5050/vda5050Mapping");
    const state: any = {
      timestamp: "2026-06-30T12:00:00Z",
      operatingMode: "AUTOMATIC",
      driving: true,
      paused: false,
      agvPosition: { x: 1, y: 2, theta: 0, mapId: "map" },
      batteryState: { batteryCharge: 73.5, charging: false, batteryVoltage: 48 },
      errors: [],
      safetyState: { eStop: "NONE", fieldViolation: false },
    };
    const rs = mapStateToRobotTelemetry(state);
    expect(rs.batteryPct).toBe(73.5);
    // and it remains in pose JSON for the fleet allocator's existing reader
    expect((rs.pose as any)?.battery?.charge).toBe(73.5);
  });

  it("leaves batteryPct undefined (honest) when no batteryState present", async () => {
    const { mapStateToRobotTelemetry } = await import("../vda5050/vda5050Mapping");
    const state: any = {
      timestamp: "2026-06-30T12:00:00Z",
      operatingMode: "MANUAL",
      driving: false,
      paused: false,
      agvPosition: { x: 0, y: 0, theta: 0, mapId: "m" },
      errors: [],
      safetyState: { eStop: "NONE" },
    };
    const rs = mapStateToRobotTelemetry(state);
    expect(rs.batteryPct).toBeUndefined();
  });
});

describe("X1-e — command-level authorization", () => {
  beforeEach(() => { delete process.env.FIELD_V2_ENABLED; });
  afterEach(() => { delete process.env.FIELD_V2_ENABLED; });

  it("parses a descriptor requiredPermission tuple", async () => {
    const { parsePermission } = await import("./commandAuthz");
    expect(parsePermission("machine_control/canCreate")).toEqual({ module: "machine_control", action: "canCreate" });
    expect(parsePermission("bad")).toBeNull();
    expect(parsePermission("mod/notAnAction")).toBeNull();
    expect(parsePermission(undefined)).toBeNull();
  });

  it("resolves requiredPermission from the capability descriptor (run_job/e_stop = control)", async () => {
    const { requiredPermissionForVerb } = await import("./commandAuthz");
    expect(requiredPermissionForVerb("ROBOT", "run_job")).toEqual({ module: "machine_control", action: "canCreate" });
    expect(requiredPermissionForVerb("ROBOT", "e_stop")).toEqual({ module: "machine_control", action: "canCreate" });
    // a verb the class doesn't declare → null (nothing extra to enforce)
    expect(requiredPermissionForVerb("ROBOT", "nonexistent_verb")).toBeNull();
  });

  it("flag OFF → pass-through (skipped:true, never denies)", async () => {
    const { authorizeCommand } = await import("./commandAuthz");
    const r = await authorizeCommand({ equipmentClass: "ROBOT", verb: "run_job", userId: 42, userRole: "user" });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it("flag ON → admin passes; non-admin without perm is DENIED", async () => {
    process.env.FIELD_V2_ENABLED = "true";
    const { authorizeCommand } = await import("./commandAuthz");
    // admin always passes (checkPermission short-circuits on role 'admin' without DB).
    const admin = await authorizeCommand({ equipmentClass: "ROBOT", verb: "run_job", userId: 1, userRole: "admin" });
    expect(admin.ok).toBe(true);
    expect(admin.skipped).toBe(false);
    // non-admin: checkPermission needs a DB; in this headless test there is none →
    // checkPermission returns false → DENIED (fail-closed under the strict flag).
    const denied = await authorizeCommand({ equipmentClass: "ROBOT", verb: "run_job", userId: 42, userRole: "user" });
    expect(denied.ok).toBe(false);
    expect(denied.requiredPermission).toBe("machine_control/canCreate");
  });
});

describe("X1-d — hot-plug discovery honesty + flag gating", () => {
  beforeEach(() => { delete process.env.FIELD_V2_ENABLED; });
  afterEach(() => { delete process.env.FIELD_V2_ENABLED; });

  it("declares which protocols are real probes vs honest seams", async () => {
    const { probeSupport } = await import("./discoveryService");
    const s = probeSupport();
    expect(s.opcua).toBe("real");
    expect(s.mdns).toBe("seam");
    expect(s.modbus).toBe("seam");
  });

  it("flag OFF → discover is a no-op (ok:false, no candidates)", async () => {
    const { discoverDevices } = await import("./discoveryService");
    const r = await discoverDevices({ protocol: "opcua", endpoint: "opc.tcp://localhost:4840" });
    expect(r.ok).toBe(false);
    expect(r.candidates).toHaveLength(0);
    expect(r.reason).toMatch(/FIELD_V2_ENABLED off/);
  });

  it("flag ON + mDNS → honest SEAM (seam:true, NO fabricated candidates)", async () => {
    process.env.FIELD_V2_ENABLED = "true";
    const { discoverDevices } = await import("./discoveryService");
    const r = await discoverDevices({ protocol: "mdns", endpoint: "_opcua._tcp.local" });
    expect(r.ok).toBe(false);
    expect(r.seam).toBe(true);
    expect(r.candidates).toHaveLength(0);
    expect(r.reason).toMatch(/seam/i);
  });

  it("flag ON + opcua against unreachable endpoint → honest failure, NO fabrication", async () => {
    process.env.FIELD_V2_ENABLED = "true";
    const { discoverDevices } = await import("./discoveryService");
    // node-opcua absent OR endpoint unreachable → ok:false, candidates empty, a reason.
    const r = await discoverDevices({ protocol: "opcua", endpoint: "opc.tcp://127.0.0.1:1/none", timeoutMs: 500 });
    expect(r.ok).toBe(false);
    expect(r.seam).toBe(false); // opcua is a REAL probe, not a seam — it just failed
    expect(r.candidates).toHaveLength(0);
    expect(typeof r.reason).toBe("string");
  });
});

describe("X1-b — flag-off no-ops (services)", () => {
  beforeEach(() => { delete process.env.FIELD_V2_ENABLED; });

  it("recordHeartbeat + sweepFieldHealth are no-ops when flag off", async () => {
    const { recordHeartbeat, sweepFieldHealth } = await import("./fieldHealthService");
    await expect(recordHeartbeat({ deviceKey: "robot:1" })).resolves.toBeUndefined();
    const r = await sweepFieldHealth();
    expect(r.enabled).toBe(false);
    expect(r.scanned).toBe(0);
  });

  it("registerDiscoveredDevice is a no-op when flag off", async () => {
    const { registerDiscoveredDevice } = await import("./discoveryService");
    const r = await registerDiscoveredDevice({ candidate: { protocol: "opcua", endpoint: "x", name: "n" } });
    expect(r.ok).toBe(false);
    expect(r.enabled).toBe(false);
  });
});
