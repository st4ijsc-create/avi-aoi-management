/**
 * Task 6 (docs/MACHINE_CONFIG_DESIGN.md §6, migration 0298) — machineApi.reportSettings
 * (POST /api/machine/config-sync/report-settings). A machine reports the operating
 * config it is ACTUALLY running (scoped adjustments + resolved effective set), upserted
 * into `machine_operating_config`. Sibling in spirit to machineConfigSync.test.ts's
 * check/get/ack coverage, but for the REPORT-UP direction and a DIFFERENT table.
 *
 * Pattern: shared in-memory FakeDb (see machineConfigSync.test.ts's header for the
 * three-surface rationale) — here we only need ONE surface: machineApiRouter.reportSettings
 * + machineOperatingConfigService's upsert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc } from "./__otFakeDb";
import { machineOperatingConfig, machineRecipes, parameterGuardrails } from "../../drizzle/schema";

const fake = new FakeDb();

const H = vi.hoisted(() => ({
  MACHINE: { id: 5, code: "SCREW-01", name: "Screw 01", machineType: "SCREWDRIVE", stationId: 1, isActive: true },
  authenticateMachine: vi.fn(),
}));

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
  getAllLicenses: vi.fn(async () => [] as any[]),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
}));

vi.mock("../services/machineAuthService", () => ({
  authenticateMachine: H.authenticateMachine,
  enforceMachineIngestRateLimit: vi.fn(),
  issueMachineKey: vi.fn(),
  rotateMachineKey: vi.fn(),
  revokeMachineKey: vi.fn(),
  listMachineKeys: vi.fn(async () => [] as any[]),
}));

vi.mock("../services/mqttService", () => ({ publishPointsConfigChanged: vi.fn(), publishConfigChanged: vi.fn() }));
vi.mock("../_core/socket", () => ({ emitNGAlert: vi.fn(), emitYieldWarning: vi.fn(), emitDashboardUpdate: vi.fn() }));
vi.mock("../services/integration/outboxProducers", () => ({ publishToOutbox: vi.fn() }));
vi.mock("../services/aiSmartAlertRouter", () => ({ routeAlert: vi.fn(async () => ({})) }));
vi.mock("../services/equipment/recipeVersioningService", () => ({
  recordEvent: vi.fn(async () => ({ id: 1 })),
  listCodeHistory: vi.fn(async () => [] as any[]),
}));
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

import { machineApiRouter } from "./machineApiRouters";
import { TRPCError } from "@trpc/server";

function machineCtx(): any {
  return { user: null, req: { protocol: "https", headers: {} }, res: {} };
}
const machineCaller = machineApiRouter.createCaller(machineCtx());

const FLAG = "MACHINE_OPERATING_CONFIG_REPORT_ENABLED";

beforeEach(() => {
  fake.store.clear();
  // Two PARTIAL unique indexes, per migration 0298 — modelled exactly (§6 header).
  fake.setUnique(machineOperatingConfig, [
    { keys: ["machineId", "configKind"], where: (r) => r.productModelId == null },
    { keys: ["machineId", "configKind", "productModelId"], where: (r) => r.productModelId != null },
  ]);
  vi.clearAllMocks();
  delete process.env[FLAG];
  H.authenticateMachine.mockImplementation(async () => ({ machine: H.MACHINE, method: "shared-key", keyId: null }));
});

const baseInput = () => ({
  apiKey: "K",
  configKind: "screw_program",
  adjustments: { torqueTarget: { value: 1.8, by: "operator", note: "field tune" } },
  effective: [
    { key: "torqueTarget", value: 1.8, source: "machine" as const, baselineValue: 1.5 },
    { key: "torqueTolerance", value: 0.15, source: "baseline" as const, baselineValue: 0.15 },
  ],
  checksum: "ck-1",
  reportedBy: "SCREW-01",
});

describe("reportSettings — flag gate", () => {
  it("throws PRECONDITION_FAILED when MACHINE_OPERATING_CONFIG_REPORT_ENABLED is off (default)", async () => {
    await expect(machineCaller.reportSettings(baseInput() as any))
      .rejects.toThrow(/MACHINE_OPERATING_CONFIG_REPORT_ENABLED|disabled/i);
    // No row written while gated off.
    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(0);
  });

  it("PRECONDITION_FAILED is a genuine TRPCError with that code", async () => {
    await machineCaller.reportSettings(baseInput() as any).catch((err: any) => {
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("PRECONDITION_FAILED");
    });
  });
});

describe("reportSettings — happy path (flag on)", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("machine-scoped report (no productModelCode) upserts one row, scope='machine'", async () => {
    const res: any = await machineCaller.reportSettings(baseInput() as any);
    expect(res).toMatchObject({ success: true, machineId: 5, configKind: "screw_program", scope: "machine", productModelId: null, checksum: "ck-1" });

    const rows = fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ machineId: 5, configKind: "screw_program", productModelId: null, scope: "machine", checksum: "ck-1" });
    expect(rows[0].adjustments).toEqual({ torqueTarget: { value: 1.8, by: "operator", note: "field tune" } });
    expect(rows[0].effective).toEqual({
      torqueTarget: { value: 1.8, source: "machine", baselineValue: 1.5 },
      torqueTolerance: { value: 0.15, source: "baseline", baselineValue: 0.15 },
    });
  });

  it("writes an audit log entry for the report", async () => {
    const db = await import("../db");
    await machineCaller.reportSettings(baseInput() as any);
    expect(db.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "machine.reportOperatingConfig", entityType: "machine_operating_config", status: "success" }),
    );
  });
});

describe("reportSettings — auth rejection", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("rejects when authenticateMachine throws UNAUTHORIZED (invalid mk_ key)", async () => {
    H.authenticateMachine.mockImplementation(async () => {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
    });
    await expect(machineCaller.reportSettings(baseInput() as any)).rejects.toThrow(/Invalid API key/);
    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(0);
  });

  it("rejects with neither apiKey nor machineCode (zod refine)", async () => {
    const { apiKey, ...rest } = baseInput();
    await expect(machineCaller.reportSettings(rest as any)).rejects.toThrow(/apiKey or machineCode/i);
    expect(H.authenticateMachine).not.toHaveBeenCalled();
  });
});

describe("reportSettings — zod validation rejection", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("rejects a missing configKind", async () => {
    const { configKind, ...rest } = baseInput();
    await expect(machineCaller.reportSettings(rest as any)).rejects.toThrow();
    expect(H.authenticateMachine).not.toHaveBeenCalled();
  });

  it("rejects an adjustment entry missing the required `value` field", async () => {
    const input = { ...baseInput(), adjustments: { torqueTarget: { by: "operator" } } };
    await expect(machineCaller.reportSettings(input as any)).rejects.toThrow();
    expect(H.authenticateMachine).not.toHaveBeenCalled();
  });

  it("rejects an effective[] entry missing the required `key` field", async () => {
    const input = { ...baseInput(), effective: [{ value: 1.8 }] };
    await expect(machineCaller.reportSettings(input as any)).rejects.toThrow();
    expect(H.authenticateMachine).not.toHaveBeenCalled();
  });
});

describe("reportSettings — machine-scoped vs product-scoped coexistence", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  it("a machine-scoped and a machine×product-scoped row coexist for the same (machine, configKind)", async () => {
    const db = await import("../db");
    (db.getProductModelByCode as any).mockResolvedValue({ id: 7, code: "MODEL-A" });

    await machineCaller.reportSettings(baseInput() as any); // machine-scoped
    await machineCaller.reportSettings({ ...baseInput(), productModelCode: "MODEL-A", checksum: "ck-product" } as any); // product-scoped

    const rows = fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? [];
    expect(rows).toHaveLength(2);
    const machineRow = rows.find((r) => r.productModelId == null)!;
    const productRow = rows.find((r) => r.productModelId != null)!;
    expect(machineRow).toMatchObject({ scope: "machine", checksum: "ck-1" });
    expect(productRow).toMatchObject({ scope: "machine_product", productModelId: 7, checksum: "ck-product" });
  });

  it("re-reporting the SAME scope updates the row IN PLACE (no duplicate)", async () => {
    await machineCaller.reportSettings(baseInput() as any);
    await machineCaller.reportSettings({ ...baseInput(), checksum: "ck-2" } as any);

    const rows = fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].checksum).toBe("ck-2");
  });

  it("re-reporting the SAME product scope updates that row in place while the machine-scoped row is untouched", async () => {
    const db = await import("../db");
    (db.getProductModelByCode as any).mockResolvedValue({ id: 7, code: "MODEL-A" });

    await machineCaller.reportSettings(baseInput() as any); // machine-scoped, ck-1
    await machineCaller.reportSettings({ ...baseInput(), productModelCode: "MODEL-A", checksum: "ck-product-1" } as any);
    await machineCaller.reportSettings({ ...baseInput(), productModelCode: "MODEL-A", checksum: "ck-product-2" } as any);

    const rows = fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? [];
    expect(rows).toHaveLength(2);
    const machineRow = rows.find((r) => r.productModelId == null)!;
    const productRow = rows.find((r) => r.productModelId != null)!;
    expect(machineRow.checksum).toBe("ck-1"); // untouched by the product-scoped re-reports
    expect(productRow.checksum).toBe("ck-product-2");
  });

  it("404s on an unknown productModelCode and writes nothing", async () => {
    const db = await import("../db");
    (db.getProductModelByCode as any).mockResolvedValue(undefined);
    await expect(machineCaller.reportSettings({ ...baseInput(), productModelCode: "NOPE" } as any)).rejects.toThrow(/not found/i);
    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(0);
  });
});

describe("reportSettings — guardrail cross-check (I-1, mc-feature-review.md)", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("rejects a report whose value falls outside a configured guardrail, and writes nothing", async () => {
    fake.seed(parameterGuardrails, [
      // FakeDb reads RAW rows (no drizzle column→property mapping): the WHERE matches on
      // the DB column names (snake_case) while checkAgainstGuardrail reads the camelCase
      // properties — so seed BOTH shapes for the columns each side touches (same convention
      // as machineConfigSync.test.ts's "guardrail TEETH" describe block).
      { id: 1, scope: "machine", machine_id: 5, machine_type: null, param_key: "torqueTarget", minValue: 0.5, maxValue: 5.0, maxStep: null, unit: "Nm" },
    ]);
    const input = { ...baseInput(), adjustments: { torqueTarget: { value: 50, by: "operator" } } };

    await expect(machineCaller.reportSettings(input as any)).rejects.toThrow(/guardrail|range|nằm ngoài/i);

    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(0);
  });

  it("still succeeds when the reported value is WITHIN a configured guardrail's range", async () => {
    fake.seed(parameterGuardrails, [
      // FakeDb reads RAW rows (no drizzle column→property mapping): the WHERE matches on
      // the DB column names (snake_case) while checkAgainstGuardrail reads the camelCase
      // properties — so seed BOTH shapes for the columns each side touches (same convention
      // as machineConfigSync.test.ts's "guardrail TEETH" describe block).
      { id: 1, scope: "machine", machine_id: 5, machine_type: null, param_key: "torqueTarget", minValue: 0.5, maxValue: 5.0, maxStep: null, unit: "Nm" },
    ]);

    const res: any = await machineCaller.reportSettings(baseInput() as any); // torqueTarget = 1.8, in [0.5, 5.0]
    expect(res.success).toBe(true);
    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(1);
  });

  it("a param with NO configured guardrail is allowed through unchecked (non-strict, matches existing config-sync convention)", async () => {
    // No parameterGuardrails seeded at all — torqueTarget has no row for machine 5.
    const input = { ...baseInput(), adjustments: { torqueTarget: { value: 999_999, by: "operator" } } };
    const res: any = await machineCaller.reportSettings(input as any);
    expect(res.success).toBe(true);
  });

  it("aoi_inspection is NOT cross-checked — a value that WOULD violate a configured guardrail is still accepted (server has no schema for AOI, by design)", async () => {
    fake.seed(parameterGuardrails, [
      { id: 1, scope: "machine", machine_id: 5, machine_type: null, param_key: "exposureUs", minValue: 50, maxValue: 20000, maxStep: null, unit: "us" },
    ]);
    const input = {
      apiKey: "K",
      configKind: "aoi_inspection",
      adjustments: { exposureUs: { value: 999_999, by: "operator" } }, // wildly out of the [50,20000] guardrail above
      effective: [{ key: "exposureUs", value: 999_999, source: "machine" as const, baselineValue: 1500 }],
      checksum: "ck-aoi",
      reportedBy: "AOI-01",
    };

    const res: any = await machineCaller.reportSettings(input as any);
    expect(res.success).toBe(true);
    expect(fake.store.get((machineOperatingConfig as any)[Symbol.for("drizzle:Name")]) ?? []).toHaveLength(1);
  });
});

describe("reportSettings — NEVER touches machine_recipes / any baseline", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("machine_recipes is byte-identical before and after a report call", async () => {
    fake.seed(machineRecipes, [
      { id: 1, code: "RCP-BASE", version: 1, status: "active", machineId: 5, machineType: "SCREWDRIVE", payload: { torqueTarget: 1.5 }, checksum: "base-ck" },
    ]);
    const before = JSON.stringify(fake.store.get((machineRecipes as any)[Symbol.for("drizzle:Name")]));

    await machineCaller.reportSettings(baseInput() as any);
    // Same configKind family, deliberately overlapping "torqueTarget" value — proves
    // the report path never reaches into machine_recipes even when the reported
    // adjustment could plausibly be mistaken for a baseline write.

    const after = JSON.stringify(fake.store.get((machineRecipes as any)[Symbol.for("drizzle:Name")]));
    expect(after).toBe(before);
  });
});
