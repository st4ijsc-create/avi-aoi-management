/**
 * doc 80 Task 3 (FLOW-01/INT-02, INT-01) — equipmentIntegrationRouter tests.
 *
 * Prior to this task the router had ZERO tests (doc 80 Phụ lục F TST-01). Covers:
 *   • release/rollback now require the SAME guarantee as /recipes: `actuationProcedure`
 *     (role-floor admin/supervisor/engineer + 2FA) + machine_control/canEdit — was a bare
 *     canCreate with no role floor. Proven by DENYING a canCreate-only / non-actuation-role
 *     / no-2FA caller that used to be allowed through.
 *   • INT-01 SSRF: `euromapOpcuaSnapshot` no longer accepts a client-supplied endpoint —
 *     it ALWAYS uses the server env config, even when a caller smuggles one into the input.
 *   • `testEuromapOpcuaConnection`: adminProcedure-only, endpoint host must match the
 *     allowlist (registered opcua device_adapters ∪ EUROMAP_OPCUA_ALLOWLIST), and NEVER
 *     raises Andon (it never touches EuromapAdapter.pollOverOpcua / adapterAlarmBridge).
 *
 * The approvedBy PRECONDITION_FAILED gate itself is unit-tested in
 * recipeVersioningService.test.ts — here recipeVersioningService is MOCKED so this file
 * tests the ROUTER's gating in isolation, matching the sibling machineRecipeRouter.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc } from "./__otFakeDb";
import { deviceAdapters } from "../../drizzle/schema";
import { registerDriver, _clearRegistry } from "../services/ot/driverRegistry";
import type { OtDriver, OtSample, OtTagAddress } from "../services/ot/otDriver";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
// `phaiDoiMatKhau` is read by the GLOBAL root middleware (server/_core/trpc.ts,
// `chanKhiPhaiDoiMatKhau`) on EVERY authenticated procedure call, ahead of RBAC — it must be
// present on this mock (a bare `{ getDb }` mock makes Vitest throw "No 'phaiDoiMatKhau' export
// is defined on the mock" the moment a non-exempt role calls any procedure).
vi.mock("../db", () => ({ getDb: vi.fn(async () => fake), phaiDoiMatKhau: vi.fn(async () => false) }));

// ── recipeVersioningService: mocked so router RBAC/SSRF is tested in ISOLATION from the
// service's own approvedBy gate (covered separately in recipeVersioningService.test.ts).
const calls: any[] = [];
vi.mock("../services/equipment/recipeVersioningService", () => ({
  isEqIntegEnabled: () => true,
  createVersion: vi.fn(async () => ({ recipe: {}, event: {} })),
  releaseVersion: vi.fn(async (recipeId: number, performedBy: number) => {
    calls.push({ op: "release", recipeId, performedBy });
    return { recipe: { id: recipeId, code: "R1", version: 1, status: "active" }, event: { id: 1, action: "release" } };
  }),
  archiveVersion: vi.fn(async () => ({ recipe: {}, event: {} })),
  rollbackToVersion: vi.fn(async (toRecipeId: number, performedBy: number) => {
    calls.push({ op: "rollback", toRecipeId, performedBy });
    return { recipe: { id: toRecipeId, code: "R1", version: 1, status: "active" }, event: { id: 2, action: "rollback" } };
  }),
  recordLoad: vi.fn(async () => ({ recipe: {}, event: {}, deploymentId: null })),
  listVersions: vi.fn(async () => []),
  listLoadHistory: vi.fn(async () => []),
  listCodeHistory: vi.fn(async () => []),
}));

// ── requirePermission: a controllable per-(module,action) grant set so the test can prove
// canCreate no longer suffices and canEdit does. The REAL requirePermission hits the DB
// (permissions table) via checkPermission — mocking it keeps this a pure unit test, same
// convention as machineRecipeRouter.test.ts.
const granted = new Set<string>();
vi.mock("../_core/accessControl", () => ({
  requirePermission: (moduleName: string, action: string) => async ({ ctx, next }: any) => {
    if (ctx.user?.role === "admin" || granted.has(`${moduleName}:${action}`)) return next({ ctx });
    const { TRPCError } = await import("@trpc/server");
    throw new TRPCError({ code: "FORBIDDEN", message: `no ${moduleName}/${action}` });
  },
}));

import { equipmentIntegrationRouter } from "./equipmentIntegrationRouter";

function callerAs(user: any) {
  return equipmentIntegrationRouter.createCaller({ user } as any);
}

/** Minimal OtDriver whose connect() records the endpoint it was called with. */
function fakeDriver(opts: { onConnect?: (endpoint: string) => void; values?: Record<string, unknown> } = {}): OtDriver {
  const { onConnect, values = {} } = opts;
  return {
    protocol: "opcua",
    connect: vi.fn(async (cfg: any) => { onConnect?.(cfg.endpoint); }),
    disconnect: vi.fn(async () => undefined),
    isConnected: () => true,
    readTags: vi.fn(async (tags: OtTagAddress[]): Promise<OtSample[]> =>
      tags.map((t) => ({
        tagKey: t.tagKey,
        raw: values[t.tagKey] ?? 1,
        value: values[t.tagKey] ?? 1,
        quality: "good",
        timestamp: new Date(),
      })),
    ),
    subscribe: vi.fn(),
    writeTags: vi.fn(async () => []),
    health: vi.fn(async () => ({ protocol: "opcua" as const, connected: true })),
  } as unknown as OtDriver;
}

beforeEach(() => {
  calls.length = 0;
  granted.clear();
  fake.store.clear();
  process.env.EQ_INTEG_ENABLED = "true";
});
afterEach(() => {
  delete process.env.EQ_INTEG_ENABLED;
  delete process.env.EUROMAP_OPCUA_ENDPOINT;
  delete process.env.EUROMAP_OPCUA_NODEMAP;
  delete process.env.EUROMAP_OPCUA_VENDOR;
  delete process.env.EUROMAP_OPCUA_ALLOWLIST;
  _clearRegistry();
  vi.clearAllMocks();
});

describe("release/rollback — same gate as /recipes (actuationProcedure + canEdit)", () => {
  it("engineer with canCreate ONLY (the OLD gate) is now DENIED — canEdit is required", async () => {
    granted.add("machine_control:canCreate"); // old behaviour would have passed
    const caller = callerAs({ id: 1, role: "engineer", twoFactorEnabled: true });
    await expect(caller.releaseRecipeVersion({ recipeId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.rollbackRecipeVersion({ toRecipeId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toHaveLength(0);
  });

  it("engineer with canEdit + 2FA succeeds (role-floor + permission both satisfied)", async () => {
    granted.add("machine_control:canEdit");
    const caller = callerAs({ id: 1, role: "engineer", twoFactorEnabled: true });
    const res = await caller.releaseRecipeVersion({ recipeId: 5 });
    expect(res.recipe.status).toBe("active");
    expect(calls[0]).toMatchObject({ op: "release", recipeId: 5, performedBy: 1 });

    const rb = await caller.rollbackRecipeVersion({ toRecipeId: 5 });
    expect(rb.recipe.status).toBe("active");
    expect(calls[1]).toMatchObject({ op: "rollback", toRecipeId: 5, performedBy: 1 });
  });

  it("operator (outside admin/supervisor/engineer) is DENIED by the role floor even with canEdit", async () => {
    granted.add("machine_control:canEdit");
    const caller = callerAs({ id: 2, role: "operator", twoFactorEnabled: true });
    await expect(caller.releaseRecipeVersion({ recipeId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("engineer with canEdit but 2FA NOT enabled is DENIED (actuationProcedure requires 2FA)", async () => {
    granted.add("machine_control:canEdit");
    const caller = callerAs({ id: 3, role: "engineer", twoFactorEnabled: false });
    await expect(caller.releaseRecipeVersion({ recipeId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a service PRECONDITION_FAILED (unapproved recipe) passes through toTrpc UNCHANGED — never downgraded to BAD_REQUEST", async () => {
    // FLOW-01/INT-02: recipeVersioningService.releaseVersion/rollbackToVersion now reject an
    // unapproved version with a pre-classified appError("PRECONDITION_FAILED", ...). Before
    // toTrpc() learned to pass a TRPCError through unchanged, its message-regex fallback
    // (only recognizes "not found" / "disabled") would have downgraded this to a generic
    // BAD_REQUEST, hiding the real reason from the client.
    granted.add("machine_control:canEdit");
    const { appError } = await import("../_core/appError");
    const svc = await import("../services/equipment/recipeVersioningService");
    (svc.releaseVersion as any).mockRejectedValueOnce(
      appError("PRECONDITION_FAILED", "OPERATION_FAILED", { operation: "releaseRecipeVersion" }, "Recipe #9 (R1 v1) has not been approved"),
    );
    const caller = callerAs({ id: 1, role: "engineer", twoFactorEnabled: true });
    await expect(caller.releaseRecipeVersion({ recipeId: 9 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("INT-01 SSRF — euromapOpcuaSnapshot never accepts a client endpoint", () => {
  it("uses ONLY the server env endpoint, ignoring an endpoint/nodeMap/vendor smuggled into the input", async () => {
    granted.add("machine_monitoring:canView");
    process.env.EUROMAP_OPCUA_ENDPOINT = "opc.tcp://trusted-plc:4840";
    process.env.EUROMAP_OPCUA_NODEMAP = JSON.stringify({ shotCounter: "ns=4;s=ShotCounter" });
    let seenEndpoint: string | undefined;
    registerDriver("opcua", () => fakeDriver({ onConnect: (ep) => { seenEndpoint = ep; } }));
    const caller = callerAs({ id: 1, role: "engineer" });
    const res = await caller.euromapOpcuaSnapshot({
      machineCode: "IMM-01",
      // Attacker-controlled fields the OLD input schema accepted — the new schema no
      // longer declares them, so they must be IGNORED, never forwarded to the driver.
      ...({ endpoint: "http://169.254.169.254/latest/meta-data/", vendor: "attacker", nodeMapJson: "{}" } as any),
    } as any);
    expect(seenEndpoint).toBe("opc.tcp://trusted-plc:4840");
    expect((res as any).source).toBe("live");
  });

  it("no server-configured endpoint ⇒ BAD_REQUEST, even if the caller supplies one", async () => {
    granted.add("machine_monitoring:canView");
    delete process.env.EUROMAP_OPCUA_ENDPOINT;
    const caller = callerAs({ id: 1, role: "engineer" });
    await expect(
      caller.euromapOpcuaSnapshot({ machineCode: "IMM-01", ...({ endpoint: "opc.tcp://attacker:4840" } as any) } as any),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("testEuromapOpcuaConnection — admin-only, allowlisted, never Andon (INT-01)", () => {
  const NODE_MAP_JSON = JSON.stringify({ shotCounter: "ns=4;s=ShotCounter", alarmNodes: [{ nodeId: "ns=4;s=Alarm", code: "E1" }] });

  it("non-admin caller is FORBIDDEN (role floor is 'admin', not just actuation roles)", async () => {
    const caller = callerAs({ id: 1, role: "engineer", twoFactorEnabled: true });
    await expect(
      caller.testEuromapOpcuaConnection({ machineCode: "IMM-01", endpoint: "opc.tcp://sim-plc.local:4840", nodeMapJson: NODE_MAP_JSON }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("endpoint host NOT in the allowlist ⇒ rejected, driver.connect is NEVER called", async () => {
    const connect = vi.fn(async () => undefined);
    registerDriver("opcua", () => ({
      protocol: "opcua", connect, disconnect: vi.fn(async () => undefined), isConnected: () => true,
      readTags: vi.fn(async () => []), subscribe: vi.fn(), writeTags: vi.fn(async () => []),
      health: vi.fn(async () => ({ protocol: "opcua" as const, connected: true })),
    } as unknown as OtDriver));
    const caller = callerAs({ id: 1, role: "admin", twoFactorEnabled: true });
    await expect(
      caller.testEuromapOpcuaConnection({ machineCode: "IMM-01", endpoint: "opc.tcp://evil.example.com:4840", nodeMapJson: NODE_MAP_JSON }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("endpoint host IN EUROMAP_OPCUA_ALLOWLIST ⇒ succeeds, Andon is NEVER raised", async () => {
    process.env.EUROMAP_OPCUA_ALLOWLIST = "sim-plc.local";
    const raiseFromEuromapAlarm = vi.fn();
    vi.doMock("../services/equipment/adapterAlarmBridge", () => ({ raiseFromEuromapAlarm }));
    registerDriver("opcua", () => fakeDriver({ values: { "alarm:0": true } }));
    const caller = callerAs({ id: 1, role: "admin", twoFactorEnabled: true });
    const res = await caller.testEuromapOpcuaConnection({
      machineCode: "IMM-01",
      endpoint: "opc.tcp://sim-plc.local:4840",
      nodeMapJson: NODE_MAP_JSON,
    });
    expect(res.ok).toBe(true);
    expect(raiseFromEuromapAlarm).not.toHaveBeenCalled();
  });

  it("endpoint host matching a REGISTERED opcua device_adapters row ⇒ allowed (no env allowlist needed)", async () => {
    fake.seed(deviceAdapters, [
      { id: 1, code: "OPCUA-1", name: "Sim PLC", protocol: "opcua", endpoint: "opc.tcp://registered-plc:4840", pollIntervalMs: 5000, isEnabled: false },
    ]);
    registerDriver("opcua", () => fakeDriver());
    const caller = callerAs({ id: 1, role: "admin", twoFactorEnabled: true });
    const res = await caller.testEuromapOpcuaConnection({
      machineCode: "IMM-01",
      endpoint: "opc.tcp://registered-plc:4840",
      nodeMapJson: NODE_MAP_JSON,
    });
    expect(res.ok).toBe(true);
  });

  it("a DISABLED but REGISTERED adapter still counts as allowlisted (registered ≠ polling)", async () => {
    fake.seed(deviceAdapters, [
      { id: 2, code: "OPCUA-2", name: "Sim PLC 2", protocol: "opcua", endpoint: "opc.tcp://disabled-plc:4840", pollIntervalMs: 5000, isEnabled: false },
    ]);
    registerDriver("opcua", () => fakeDriver());
    const caller = callerAs({ id: 1, role: "admin", twoFactorEnabled: true });
    const res = await caller.testEuromapOpcuaConnection({
      machineCode: "IMM-01",
      endpoint: "opc.tcp://disabled-plc:4840",
      nodeMapJson: NODE_MAP_JSON,
    });
    expect(res.ok).toBe(true);
  });

  it("a registered adapter of a DIFFERENT protocol does NOT allowlist its host for OPC-UA", async () => {
    fake.seed(deviceAdapters, [
      { id: 3, code: "MB-1", name: "Modbus PLC", protocol: "modbus", endpoint: "10.0.0.5:502", pollIntervalMs: 5000, isEnabled: true },
    ]);
    registerDriver("opcua", () => fakeDriver());
    const caller = callerAs({ id: 1, role: "admin", twoFactorEnabled: true });
    await expect(
      caller.testEuromapOpcuaConnection({ machineCode: "IMM-01", endpoint: "opc.tcp://10.0.0.5:4840", nodeMapJson: NODE_MAP_JSON }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
