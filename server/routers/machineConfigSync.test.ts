/**
 * doc 56 Đ4 — GENERIC config-sync + governance tests.
 *
 * Three surfaces, one shared in-memory FakeDb:
 *   (1) configDriftService     — computeDriftState (pure), resolve active recipe
 *       PER-MACHINE→PER-TYPE→by-code, and the desired→reported→drift shadow transitions.
 *   (2) machineApiRouter        — checkConfigVersion / getActiveConfig / ackConfigApplied
 *       (flag-gated) + the points ALIAS being byte-identical to checkPointsVersion +
 *       two-way drift via heartbeat `running[]`.
 *   (3) machineRecipeRouter     — deploy→desired shadow + retained notify, typed-schema
 *       enforce at create, and guardrail TEETH at approve.
 *
 * Every behaviour change is gated OFF by default; the OFF assertions prove byte-identity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import {
  machineConfigState,
  machineRecipes,
  machines,
  parameterGuardrails,
} from "../../drizzle/schema";

const fake = new FakeDb();

// Shared fixtures referenced INSIDE hoisted vi.mock factories → must be hoisted too.
const H = vi.hoisted(() => ({
  MACHINE: { id: 5, code: "SCREW-01", name: "Screw 01", machineType: "SCREWDRIVE", stationId: 1, isActive: true },
  recipeMock: {
    getActiveRecipe: vi.fn(),
    getRecipeById: vi.fn(),
    createRecipe: vi.fn(),
    approveRecipe: vi.fn(),
    deployRecipe: vi.fn(),
    rollbackRecipe: vi.fn(),
    archiveRecipe: vi.fn(),
    listRecipeVersions: vi.fn(),
    setGoldenRecipe: vi.fn(),
  },
  publishConfigChanged: vi.fn(),
  routeAlert: vi.fn(async () => ({})),
}));

// FakeDb needs drizzle's eq/and/isNull/desc as JS predicate builders (sql etc. kept real).
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: makeEq,
    and: makeAnd,
    desc: makeDesc,
    isNull: (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null,
  };
});

// configDriftService + parameterGuardrailService read `../db/connection`; the router
// helpers read the `../db` barrel. Point BOTH at the same FakeDb so state is shared.
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => fake),
  getMachineByApiKey: vi.fn(),
  getMachineByCode: vi.fn(),
  getMachineById: vi.fn(),
  updateMachineHeartbeat: vi.fn(async () => undefined),
  getProductModelByCode: vi.fn(async () => undefined),
  getMappingsByMachine: vi.fn(async () => [] as any[]),
  getVariantByCode: vi.fn(async () => undefined),
  getBaseVariant: vi.fn(async () => undefined),
  getVariantsByModel: vi.fn(async () => [] as any[]),
  // license/audit middleware on the actuation procedures (fail-safe if absent).
  getAllLicenses: vi.fn(async () => [] as any[]),
  createAuditLog: vi.fn(async () => undefined),
}));

vi.mock("../db/machineRecipe", () => H.recipeMock);

// Auth: stub so no auth-internal query runs; method 'shared-key' short-circuits the
// key-rotation signal (no DB). machineApiRouters imports the whole surface.
vi.mock("../services/machineAuthService", () => ({
  authenticateMachine: vi.fn(async () => ({ machine: H.MACHINE, method: "shared-key", keyId: null })),
  enforceMachineIngestRateLimit: vi.fn(),
  issueMachineKey: vi.fn(),
  rotateMachineKey: vi.fn(),
  revokeMachineKey: vi.fn(),
  listMachineKeys: vi.fn(async () => [] as any[]),
}));

vi.mock("../services/mqttService", () => ({
  publishPointsConfigChanged: vi.fn(),
  publishConfigChanged: H.publishConfigChanged,
}));
vi.mock("../_core/socket", () => ({ emitNGAlert: vi.fn(), emitYieldWarning: vi.fn(), emitDashboardUpdate: vi.fn() }));
vi.mock("../services/integration/outboxProducers", () => ({ publishToOutbox: vi.fn() }));
vi.mock("../services/aiSmartAlertRouter", () => ({ routeAlert: H.routeAlert }));

// Recipe-router genealogy + RBAC (allow-all).
vi.mock("../services/equipment/recipeVersioningService", () => ({
  recordEvent: vi.fn(async () => ({ id: 1 })),
  listCodeHistory: vi.fn(async () => [] as any[]),
}));
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const recipeMock = H.recipeMock;
const publishConfigChanged = H.publishConfigChanged;
const routeAlert = H.routeAlert;

import * as configDrift from "../services/configDriftService";
import { machineApiRouter, _resetHeartbeatRateLimit } from "./machineApiRouters";
import { machineRecipeRouter } from "./machineRecipeRouter";

function machineCtx(): any {
  return { user: null, req: { protocol: "https", headers: {} }, res: {} };
}
const machineCaller = machineApiRouter.createCaller(machineCtx());
// actuation (deploy/approve) — privileged supervisor with 2FA.
const recipeCtx = { user: { id: 7, role: "supervisor", name: "Sup", twoFactorEnabled: true } } as any;
const recipeCaller = machineRecipeRouter.createCaller(recipeCtx);

const CONFIG_FLAGS = ["CONFIG_SYNC_GENERIC_ENABLED", "CONFIG_DRIFT_REPORT_ENABLED", "RECIPE_TYPED_SCHEMA_MODE"];

beforeEach(() => {
  fake.store.clear();
  fake.setUnique(machineConfigState, [["machineId", "configKind"]]);
  resetSeq();
  vi.clearAllMocks();
  _resetHeartbeatRateLimit();
  for (const f of CONFIG_FLAGS) delete process.env[f];
  recipeMock.getActiveRecipe.mockResolvedValue(undefined as any);
  recipeMock.getRecipeById.mockResolvedValue(undefined as any);
  recipeMock.createRecipe.mockImplementation(async (input: any) => ({ id: 1, version: 1, status: "draft", ...input }));
  recipeMock.approveRecipe.mockImplementation(async (input: any) => ({ id: input.recipeId, approvedBy: input.approvedBy, status: "draft" }));
  recipeMock.deployRecipe.mockImplementation(async (input: any) => ({
    id: 999, recipeId: input.recipeId, machineId: input.machineId, previousRecipeId: null, status: "deployed", notes: input.notes ?? null,
  }));
  recipeMock.listRecipeVersions.mockResolvedValue([] as any);
});

// ════════════════════════════════════════════════════════════════════════════
// (1) configDriftService — pure drift + resolution + shadow transitions
// ════════════════════════════════════════════════════════════════════════════
describe("computeDriftState (pure)", () => {
  it("unknown when either side has no data", () => {
    expect(configDrift.computeDriftState(null, null)).toBe("unknown");
    expect(configDrift.computeDriftState({ checksum: "a" }, null)).toBe("unknown");
    expect(configDrift.computeDriftState(null, { checksum: "a" })).toBe("unknown");
  });
  it("checksum is authoritative when both present", () => {
    expect(configDrift.computeDriftState({ checksum: "a" }, { checksum: "a" })).toBe("in_sync");
    expect(configDrift.computeDriftState({ checksum: "a" }, { checksum: "b" })).toBe("drift");
  });
  it("falls back to (code,version) equality when no checksum pair", () => {
    expect(configDrift.computeDriftState({ code: "R", version: "2" }, { code: "R", version: "2" })).toBe("in_sync");
    expect(configDrift.computeDriftState({ code: "R", version: "2" }, { code: "R", version: "3" })).toBe("drift");
  });
});

describe("resolveActiveRecipe — per-machine → per-type → by-code", () => {
  it("resolves PER-MACHINE first (machineId bound)", async () => {
    recipeMock.getActiveRecipe.mockImplementation(async (opts: any) =>
      opts.machineId === 5 ? { code: "RCP-M", version: 3, checksum: "cm", machineId: 5, machineType: "SCREWDRIVE" } : undefined,
    );
    const desc = await configDrift.resolveRecipeConfigDescriptor({ id: 5, machineType: "SCREWDRIVE" });
    expect(desc).toEqual({ code: "RCP-M", version: "3", checksum: "cm", resolvedBy: "machine" });
  });

  it("falls back to the PER-MACHINE-TYPE default (machineId NULL)", async () => {
    recipeMock.getActiveRecipe.mockResolvedValue(undefined as any); // no per-machine binding
    fake.seed(machineRecipes, [
      { id: 1, code: "RCP-T", version: 1, checksum: "ct", machineId: null, machineType: "SCREWDRIVE", status: "active" },
    ]);
    const desc = await configDrift.resolveRecipeConfigDescriptor({ id: 5, machineType: "SCREWDRIVE" });
    expect(desc).toEqual({ code: "RCP-T", version: "1", checksum: "ct", resolvedBy: "machineType" });
  });

  it("an explicit configCode wins but only if it belongs to this machine", async () => {
    recipeMock.getActiveRecipe.mockImplementation(async (opts: any) =>
      opts.code === "RCP-X" ? { code: "RCP-X", version: 9, checksum: "cx", machineId: 5, machineType: "SCREWDRIVE" } : undefined,
    );
    const desc = await configDrift.resolveRecipeConfigDescriptor({ id: 5, machineType: "SCREWDRIVE" }, "RCP-X");
    expect(desc?.code).toBe("RCP-X");
    expect(desc?.resolvedBy).toBe("machine");
  });

  it("returns null when nothing active resolves", async () => {
    recipeMock.getActiveRecipe.mockResolvedValue(undefined as any);
    const desc = await configDrift.resolveRecipeConfigDescriptor({ id: 5, machineType: "SCREWDRIVE" });
    expect(desc).toBeNull();
  });
});

describe("shadow transitions — desired → reported → drift", () => {
  it("desired then matching reported ⇒ in_sync; mismatching ⇒ drift", async () => {
    await configDrift.upsertDesiredConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "ck-desired" });
    let row = await configDrift.readConfigState(5, "recipe");
    expect(row?.desiredChecksum).toBe("ck-desired");
    expect(row?.driftState).toBe("unknown"); // nothing reported yet

    const matched = await configDrift.recordReportedConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "ck-desired" });
    expect(matched.driftState).toBe("in_sync");
    row = await configDrift.readConfigState(5, "recipe");
    expect(row?.reportedChecksum).toBe("ck-desired");
    expect(row?.driftState).toBe("in_sync");

    const drifted = await configDrift.recordReportedConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "ck-OTHER" });
    expect(drifted.driftState).toBe("drift");
    row = await configDrift.readConfigState(5, "recipe");
    expect(row?.driftState).toBe("drift");
  });

  it("upsert keeps ONE row per (machine, configKind) — second write updates in place", async () => {
    await configDrift.upsertDesiredConfig({ machineId: 5, configKind: "recipe", code: "R", version: 1, checksum: "a" });
    await configDrift.upsertDesiredConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "b" });
    const rows = (fake as any).store.get((machineConfigState as any)[Symbol.for("drizzle:Name")]) ?? [];
    expect(rows).toHaveLength(1);
    const state = await configDrift.readConfigState(5, "recipe");
    expect(state?.desiredChecksum).toBe("b");
    expect(state?.desiredVersion).toBe("2");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) machineApiRouter — check / get / ack / heartbeat drift
// ════════════════════════════════════════════════════════════════════════════
describe("machineApi config-sync — flag gate", () => {
  it("checkConfigVersion throws PRECONDITION_FAILED when CONFIG_SYNC_GENERIC_ENABLED is off", async () => {
    await expect(machineCaller.checkConfigVersion({ configKind: "recipe", apiKey: "K" } as any))
      .rejects.toThrow(/CONFIG_SYNC_GENERIC_ENABLED|disabled/i);
  });
});

describe("machineApi config-sync — resolve + payload", () => {
  beforeEach(() => { process.env.CONFIG_SYNC_GENERIC_ENABLED = "true"; });

  it("checkConfigVersion recipe returns the resolved descriptor", async () => {
    recipeMock.getActiveRecipe.mockImplementation(async (opts: any) =>
      opts.machineId === 5 ? { code: "RCP-M", version: 3, checksum: "cm", machineId: 5, machineType: "SCREWDRIVE", payload: { torqueTarget: 1.5 } } : undefined,
    );
    const res: any = await machineCaller.checkConfigVersion({ configKind: "recipe", apiKey: "K" } as any);
    expect(res).toMatchObject({ configKind: "recipe", code: "RCP-M", version: "3", checksum: "cm", resolvedBy: "machine" });
  });

  it("getActiveConfig recipe returns the full payload + checksum", async () => {
    recipeMock.getActiveRecipe.mockImplementation(async (opts: any) =>
      opts.machineId === 5 ? { code: "RCP-M", version: 3, checksum: "cm", machineId: 5, machineType: "SCREWDRIVE", name: "Prog", payload: { torqueTarget: 1.5 } } : undefined,
    );
    const res: any = await machineCaller.getActiveConfig({ configKind: "recipe", apiKey: "K" } as any);
    expect(res.payload).toEqual({ torqueTarget: 1.5 });
    expect(res.checksum).toBe("cm");
  });

  it("checkConfigVersion points is BYTE-IDENTICAL to checkPointsVersion (alias)", async () => {
    const db = await import("../db");
    (db.getProductModelByCode as any).mockResolvedValue({ id: 7, code: "MODEL-A", pointsConfigVersion: 3, imageWidth: 100, imageHeight: 80 });

    const legacy: any = await machineCaller.checkPointsVersion({ apiKey: "K", productModelCode: "MODEL-A" } as any);
    const generic: any = await machineCaller.checkConfigVersion({ configKind: "points", apiKey: "K", productModelCode: "MODEL-A" } as any);
    expect(generic.productModels).toEqual(legacy.productModels);
    expect(generic.configKind).toBe("points");
  });

  it("ackConfigApplied writes the reported shadow + returns driftState", async () => {
    const res: any = await machineCaller.ackConfigApplied({ configKind: "recipe", apiKey: "K", code: "R", version: 2, checksum: "ck" } as any);
    expect(res).toMatchObject({ configKind: "recipe", driftState: "unknown" }); // no desired yet
    const state = await configDrift.readConfigState(5, "recipe");
    expect(state?.reportedChecksum).toBe("ck");
  });
});

describe("heartbeat — two-way drift (CONFIG_DRIFT_REPORT_ENABLED)", () => {
  it("byte-identical when no running[] is sent (no drift field, no alert, no shadow write)", async () => {
    process.env.CONFIG_DRIFT_REPORT_ENABLED = "true";
    const res: any = await machineCaller.heartbeat({ apiKey: "K" } as any);
    expect(res.success).toBe(true);
    expect(res.machineId).toBe(5);
    expect(res.configDrift).toBeUndefined();
    expect(routeAlert).not.toHaveBeenCalled();
    expect(await configDrift.readConfigState(5, "recipe")).toBeNull();
  });

  it("running[] mismatching the desired ⇒ drift verdict + ONE Andon alert", async () => {
    process.env.CONFIG_DRIFT_REPORT_ENABLED = "true";
    await configDrift.upsertDesiredConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "ck-desired" });

    const res: any = await machineCaller.heartbeat({
      apiKey: "K",
      running: [{ configKind: "recipe", code: "R", version: "2", checksum: "ck-RUNNING" }],
    } as any);
    expect(res.configDrift).toEqual([{ configKind: "recipe", driftState: "drift" }]);
    expect(routeAlert).toHaveBeenCalledTimes(1);
    const state = await configDrift.readConfigState(5, "recipe");
    expect(state?.driftState).toBe("drift");
    expect(state?.reportedChecksum).toBe("ck-RUNNING");
  });

  it("running[] matching the desired ⇒ in_sync, NO alert", async () => {
    process.env.CONFIG_DRIFT_REPORT_ENABLED = "true";
    await configDrift.upsertDesiredConfig({ machineId: 5, configKind: "recipe", code: "R", version: 2, checksum: "same" });
    const res: any = await machineCaller.heartbeat({
      apiKey: "K",
      running: [{ configKind: "recipe", code: "R", version: "2", checksum: "same" }],
    } as any);
    expect(res.configDrift).toEqual([{ configKind: "recipe", driftState: "in_sync" }]);
    expect(routeAlert).not.toHaveBeenCalled();
  });

  it("running[] is IGNORED when the drift flag is off (byte-identical)", async () => {
    // flag intentionally unset
    const res: any = await machineCaller.heartbeat({
      apiKey: "K",
      running: [{ configKind: "recipe", code: "R", version: "2", checksum: "x" }],
    } as any);
    expect(res.configDrift).toBeUndefined();
    expect(await configDrift.readConfigState(5, "recipe")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (3) machineRecipeRouter — deploy notify + governance
// ════════════════════════════════════════════════════════════════════════════
describe("recipes.deploy → desired shadow + retained notify (CONFIG-SYNC-3)", () => {
  it("OFF (default) ⇒ no shadow write, no notify (byte-identical)", async () => {
    recipeMock.getRecipeById.mockResolvedValue({ id: 1, code: "RCP", version: 4, checksum: "s4", machineType: "SCREWDRIVE", machineId: 100, payload: {} });
    await recipeCaller.recipes.deploy({ recipeId: 1, machineId: 100 });
    expect(publishConfigChanged).not.toHaveBeenCalled();
    expect(await configDrift.readConfigState(100, "recipe")).toBeNull();
  });

  it("ON ⇒ writes desired* and publishes a retained notify with the descriptor", async () => {
    process.env.CONFIG_SYNC_GENERIC_ENABLED = "true";
    fake.seed(machines, [{ id: 100, code: "SCREW-100", name: "S100", machineType: "SCREWDRIVE" }]);
    recipeMock.getRecipeById.mockResolvedValue({ id: 1, code: "RCP", version: 4, checksum: "s4", machineType: "SCREWDRIVE", machineId: 100, payload: {} });

    await recipeCaller.recipes.deploy({ recipeId: 1, machineId: 100 });

    expect(publishConfigChanged).toHaveBeenCalledWith("SCREW-100", "recipe", { code: "RCP", version: 4, checksum: "s4" });
    const state = await configDrift.readConfigState(100, "recipe");
    expect(state?.desiredCode).toBe("RCP");
    expect(state?.desiredVersion).toBe("4");
    expect(state?.desiredChecksum).toBe("s4");
  });
});

describe("recipe typed-schema governance (RECIPE_TYPED_SCHEMA_MODE)", () => {
  it("enforce REJECTS an invalid screw payload at create", async () => {
    process.env.RECIPE_TYPED_SCHEMA_MODE = "enforce";
    await expect(
      recipeCaller.recipes.create({ code: "S1", name: "s", payload: { torqueTolerance: 0.2 }, machineType: "SCREWDRIVE" } as any),
    ).rejects.toThrow(/không hợp lệ|torqueTarget/i);
  });

  it("enforce ACCEPTS a valid screw payload at create", async () => {
    process.env.RECIPE_TYPED_SCHEMA_MODE = "enforce";
    const r = await recipeCaller.recipes.create({
      code: "S2", name: "s", payload: { torqueTarget: 1.5, torqueTolerance: 0.2 }, machineType: "SCREWDRIVE",
    } as any);
    expect(r.code).toBe("S2");
  });

  it("off (default) ⇒ create never validates (byte-identical)", async () => {
    const r = await recipeCaller.recipes.create({ code: "S3", name: "s", payload: { garbage: true }, machineType: "SCREWDRIVE" } as any);
    expect(r.code).toBe("S3");
  });
});

describe("recipes.approve — guardrail TEETH (CONFIG-SYNC-5)", () => {
  beforeEach(() => {
    process.env.RECIPE_TYPED_SCHEMA_MODE = "enforce"; // teeth only engage when typed mode != off
    // FakeDb reads RAW rows (no drizzle column→property mapping): the WHERE matches on
    // the DB column names (snake_case) while checkAgainstGuardrail reads the camelCase
    // properties — so seed BOTH shapes for the columns each side touches.
    fake.seed(parameterGuardrails, [
      { id: 1, scope: "machine_type", machine_id: null, machine_type: "SCREWDRIVE", param_key: "torque_nm", minValue: 1.0, maxValue: 2.0, maxStep: null, unit: "Nm" },
    ]);
  });

  it("REJECTS approve when a mapped setpoint is out of the guardrail range", async () => {
    recipeMock.getRecipeById.mockResolvedValue({ id: 1, code: "RCP", version: 1, machineType: "SCREWDRIVE", machineId: null, payload: { torqueTarget: 5.0, torqueTolerance: 0.2 } });
    await expect(recipeCaller.recipes.approve({ recipeId: 1 } as any)).rejects.toThrow(/Guardrail|dải/i);
    expect(recipeMock.approveRecipe).not.toHaveBeenCalled();
  });

  it("ALLOWS approve when the setpoint is within range", async () => {
    recipeMock.getRecipeById.mockResolvedValue({ id: 2, code: "RCP", version: 1, machineType: "SCREWDRIVE", machineId: null, payload: { torqueTarget: 1.5, torqueTolerance: 0.2 } });
    await recipeCaller.recipes.approve({ recipeId: 2 } as any);
    expect(recipeMock.approveRecipe).toHaveBeenCalled();
  });
});
