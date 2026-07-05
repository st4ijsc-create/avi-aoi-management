/**
 * GĐ3a — write-tool catalog (Nhóm A + B) + client tools (navigate/prefill) +
 * LLM single-tool routing.
 *
 * Asserts, reusing the GĐ2 HITL lifecycle (proposeAction/confirmAction):
 *   - preview does NOT mutate the DB (only reads via getById helpers)
 *   - execute calls the real db fn with changedBy = ctx.user.id
 *   - missing permission → propose denied + audit, nothing stored
 *   - zod strict (unknown keys / missing required args rejected)
 *   - cross-field warnings (USL<LSL, duplicate code)
 *   - navigate route whitelist (unknown route refused, no directive)
 *   - LLM routing picks the right WRITE tool (generateJSON mocked)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake ai_pending_actions store + drizzle-like builder (mirrors GĐ2 test) ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: () => ({ values: async (vals: Row) => { store.set(vals.id, { ...vals }); } }),
    select: () => ({
      from: () => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async () => { for (const r of store.values()) if (pred(r)) return [r]; return []; },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let c = 0; for (const r of store.values()) if (pred(r)) { Object.assign(r, patch); c++; } return { rowCount: c };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
// Schema mock — include the tables touched by aiCopilotActions AND by the real
// db modules (in case module-graph dedupe across files loads a real db helper).
function schemaFactory() {
  return {
    aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
    predictiveAlerts: { id: { __name: "id" } },
    yieldAlertThresholds: { id: { __name: "id" }, metricType: { __name: "metricType" } },
    yieldThresholdHistory: { id: { __name: "id" } },
    alertHistory: { id: { __name: "id" } },
    alertSettings: { id: { __name: "id" } },
    measurementPointDefs: { id: { __name: "id" } },
  };
}
vi.mock("../../../drizzle/schema", () => schemaFactory());
// aiCopilotActions imports schema via "../../drizzle/schema" (one level up).
vi.mock("../../drizzle/schema", () => schemaFactory());

const checkPermission = vi.fn();
vi.mock("../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

// db/product — measurement point helpers.
// writeHandlers.ts (set_spec_limits) imports "../../db/product"; the GĐ3a
// subfolder modules import "../../../db/product". Mock BOTH specifiers to the
// same fns so all write tools resolve.
const createMeasurementPointDef = vi.fn(async () => 99);
const updateMeasurementPointDef = vi.fn(async () => {});
const getMeasurementPointDefById = vi.fn();
const getMeasurementPointDefByCode = vi.fn();
// NOTE: vi.mock paths are resolved relative to THIS test file
// (server/services/aiLocalTools/), so db modules are "../../db/*" even though
// the tool source files (in writeHandlers/) import them as "../../../db/*".
vi.mock("../../db/product", () => ({
  createMeasurementPointDef: (...a: unknown[]) => createMeasurementPointDef(...a),
  updateMeasurementPointDef: (...a: unknown[]) => updateMeasurementPointDef(...a),
  getMeasurementPointDefById: (...a: unknown[]) => getMeasurementPointDefById(...a),
  getMeasurementPointDefByCode: (...a: unknown[]) => getMeasurementPointDefByCode(...a),
}));

// db/alerts — alert + yield helpers.
const getAlertHistoryById = vi.fn();
const acknowledgeAlert = vi.fn(async () => {});
const getYieldAlertThresholdById = vi.fn();
const getYieldAlertThresholdByType = vi.fn();
const updateYieldAlertThreshold = vi.fn(async () => {});
const createYieldThresholdHistory = vi.fn(async () => ({ id: 1 }));
vi.mock("../../db/alerts", () => ({
  getAlertHistoryById: (...a: unknown[]) => getAlertHistoryById(...a),
  acknowledgeAlert: (...a: unknown[]) => acknowledgeAlert(...a),
  getYieldAlertThresholdById: (...a: unknown[]) => getYieldAlertThresholdById(...a),
  getYieldAlertThresholdByType: (...a: unknown[]) => getYieldAlertThresholdByType(...a),
  updateYieldAlertThreshold: (...a: unknown[]) => updateYieldAlertThreshold(...a),
  createYieldThresholdHistory: (...a: unknown[]) => createYieldThresholdHistory(...a),
}));

// db/ai — predictive alert helpers.
const getPredictiveAlertById = vi.fn();
const acknowledgePredictiveAlert = vi.fn(async () => {});
const resolvePredictiveAlert = vi.fn(async () => {});
vi.mock("../../db/ai", () => ({
  getPredictiveAlertById: (...a: unknown[]) => getPredictiveAlertById(...a),
  acknowledgePredictiveAlert: (...a: unknown[]) => acknowledgePredictiveAlert(...a),
  resolvePredictiveAlert: (...a: unknown[]) => resolvePredictiveAlert(...a),
}));

// audit — silence
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed", AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied", AI_ACTION_CANCELLED: "ai_action_cancelled" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

// Doc 31 B.6 — set_spec_limits lifecycle gate. Mock the gate resolver so we can
// drive the development-allow / active-block branches deterministically, and the
// audit sink so we can assert the direct-edit audit row on allow.
const resolveThresholdEditGate = vi.fn();
vi.mock("../thresholdGovernanceService", () => ({
  resolveThresholdEditGate: (...a: unknown[]) => resolveThresholdEditGate(...a),
}));
const systemCreateAuditLog = vi.fn(async () => ({ id: 1 }));
vi.mock("../../db/system", () => ({ createAuditLog: (...a: unknown[]) => systemCreateAuditLog(...a) }));

import { getTool } from "./toolRegistry";
import "./writeHandlers"; // registers all GĐ2 + GĐ3a tools
import { proposeAction, confirmAction } from "../aiCopilotActions";

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const OPERATOR = { id: 2, role: "operator", name: "Op" } as const;
const ctx = (user: typeof ADMIN | typeof OPERATOR) => ({ user, lang: "vi" as const });

function tool(name: string) {
  const t = getTool(name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  getAlertHistoryById.mockResolvedValue({ id: 5, message: "NG cao", acknowledgedAt: null, acknowledgedBy: null });
  getPredictiveAlertById.mockResolvedValue({ id: 7, title: "Yield drop", status: "ACTIVE", acknowledgedBy: null, resolvedBy: null, resolutionNotes: null });
  getMeasurementPointDefById.mockResolvedValue({ id: 12, code: "MP12", name: "Điểm đo 12", upperLimit: "9.0", lowerLimit: "8.0", nominalValue: "8.5", unit: "mm" });
  getMeasurementPointDefByCode.mockResolvedValue(undefined);
  getYieldAlertThresholdByType.mockResolvedValue({ id: 3, metricType: "FPY", warningThreshold: "95", criticalThreshold: "90", targetValue: "98", comparisonOperator: "gte" });
});

describe("acknowledge_alert", () => {
  it("preview reads, does NOT mutate; execute calls db with userId", async () => {
    const t = tool("acknowledge_alert");
    const p = await proposeAction(t, { id: 5 }, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(getAlertHistoryById).toHaveBeenCalledTimes(1);
    expect(acknowledgeAlert).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(acknowledgeAlert).toHaveBeenCalledWith(5, 1);
  });

  it("denied without permission → nothing stored + audit denied", async () => {
    checkPermission.mockResolvedValue(false);
    const p = await proposeAction(tool("acknowledge_alert"), { id: 5 }, ctx(OPERATOR));
    expect(p.ok).toBe(false);
    expect(p.denied).toBe(true);
    expect(store.size).toBe(0);
    expect(logCrudOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_action_denied" }));
  });

  it("zod rejects unknown keys (strict)", () => {
    const r = (tool("acknowledge_alert").parameters as any).safeParse({ id: 5, bogus: 1 });
    expect(r.success).toBe(false);
  });
});

describe("resolve_predictive_alert", () => {
  it("execute calls db.resolvePredictiveAlert with userId + notes", async () => {
    const p = await proposeAction(tool("resolve_predictive_alert"), { predictiveAlertId: 7, resolutionNotes: "Đã thay cảm biến" }, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(resolvePredictiveAlert).not.toHaveBeenCalled(); // preview only
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(resolvePredictiveAlert).toHaveBeenCalledWith(7, 1, "Đã thay cảm biến");
  });

  it("zod requires resolutionNotes", () => {
    const r = (tool("resolve_predictive_alert").parameters as any).safeParse({ predictiveAlertId: 7 });
    expect(r.success).toBe(false);
  });
});

describe("create_measurement_point", () => {
  it("warns on USL<LSL and on duplicate code", async () => {
    getMeasurementPointDefByCode.mockResolvedValue({ id: 50 }); // duplicate
    const p = await proposeAction(
      tool("create_measurement_point"),
      { productModelId: 1, code: "MP_NEW", name: "New", measurementTypeCode: "DIM_LENGTH", usl: 5, lsl: 8 },
      ctx(ADMIN),
    );
    const w = p.pendingAction!.preview.warnings.join(" ");
    expect(w).toMatch(/đã tồn tại/);
    expect(w).toMatch(/USL.*LSL/);
    expect(createMeasurementPointDef).not.toHaveBeenCalled();
  });

  it("execute creates point (preview did not mutate)", async () => {
    const p = await proposeAction(
      tool("create_measurement_point"),
      { productModelId: 1, code: "MP_NEW", name: "New", measurementTypeCode: "DIM_LENGTH", nominalValue: 10 },
      ctx(ADMIN),
    );
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(createMeasurementPointDef).toHaveBeenCalledTimes(1);
  });
});

describe("update_measurement_point", () => {
  it("execute calls db with changedBy + changeReason", async () => {
    const p = await proposeAction(tool("update_measurement_point"), { id: 12, name: "Đổi tên", upperLimit: 10 }, ctx(ADMIN));
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(updateMeasurementPointDef).toHaveBeenCalledWith(12, expect.objectContaining({ name: "Đổi tên", upperLimit: "10" }), expect.objectContaining({ changedBy: 1, changeReason: "AI Copilot" }));
  });

  it("zod requires at least one updatable field", () => {
    const r = (tool("update_measurement_point").parameters as any).safeParse({ id: 12 });
    expect(r.success).toBe(false);
  });
});

describe("set_spec_limits — Doc 31 B.6 lifecycle gate", () => {
  const specCtx = ctx(ADMIN);

  it("development product → applies the limit edit + writes a directEdit audit row", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "direct", productModelId: 5, lifecycleStatus: "development",
      hasReleasedProgram: false, enforced: true,
    });
    const res = await tool("set_spec_limits").execute!({ measurementPointDefId: 12, usl: 9, lsl: 8, target: 8.5 }, specCtx);
    expect((res.data as any).ok).toBe(true);
    expect(updateMeasurementPointDef).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ upperLimit: "9", lowerLimit: "8", nominalValue: "8.5" }),
      expect.objectContaining({ changedBy: 1, changeReason: "AI Copilot" }),
    );
    expect(systemCreateAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "threshold.directEdit",
      details: expect.objectContaining({ source: "aiCopilot.set_spec_limits", gateDecision: "direct" }),
    }));
  });

  it("active product → BLOCKS: returns ok:false with an honest message, NO db write, NO throw", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: true,
    });
    const res = await tool("set_spec_limits").execute!({ measurementPointDefId: 12, usl: 9, lsl: 8, target: 8.5 }, specCtx);
    expect((res.data as any).ok).toBe(false);
    expect(res.note ?? res.textSummary).toMatch(/approval|duyệt/i);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
    // A block is NOT audited as a successful direct edit.
    expect(systemCreateAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "threshold.directEdit" }));
  });

  it("released dev product → also blocks (gate enforced)", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "development",
      hasReleasedProgram: true, enforced: true,
    });
    const res = await tool("set_spec_limits").execute!({ measurementPointDefId: 12, usl: 9, lsl: 8, target: 8.5 }, specCtx);
    expect((res.data as any).ok).toBe(false);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });

  it("break-glass (enforced=false) → passes through even on an active product", async () => {
    resolveThresholdEditGate.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: false,
    });
    const res = await tool("set_spec_limits").execute!({ measurementPointDefId: 12, usl: 9, lsl: 8, target: 8.5 }, specCtx);
    expect((res.data as any).ok).toBe(true);
    expect(updateMeasurementPointDef).toHaveBeenCalled();
  });
});

describe("set_yield_threshold", () => {
  it("resolves by scope, execute updates threshold + history", async () => {
    const p = await proposeAction(tool("set_yield_threshold"), { scope: "FPY", field: "warning", value: 96 }, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(updateYieldAlertThreshold).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(updateYieldAlertThreshold).toHaveBeenCalledWith(3, { warningThreshold: "96" });
    expect(createYieldThresholdHistory).toHaveBeenCalledTimes(1);
  });
});

describe("client tools — navigate / prefill", () => {
  it("navigate to an allowed route returns a directive", () => {
    const d = tool("navigate").buildClientAction!({ route: "/dashboard" }, ctx(ADMIN) as any);
    expect(d).not.toBeNull();
    expect(d!.action).toBe("navigate");
    expect(d!.route).toBe("/dashboard");
  });

  it("navigate to an unknown route is refused (null directive)", () => {
    const d = tool("navigate").buildClientAction!({ route: "/secret-admin-backdoor" }, ctx(ADMIN) as any);
    expect(d).toBeNull();
  });

  it("prefill carries values for an allowed route", () => {
    const d = tool("prefill_form").buildClientAction!({ route: "/products", values: { code: "X1" } }, ctx(ADMIN) as any);
    expect(d!.action).toBe("prefill_form");
    expect(d!.values).toEqual({ code: "X1" });
  });

  it("client tools have no write permission / preview / execute", () => {
    const nav = tool("navigate");
    expect(nav.kind).toBe("client");
    expect(nav.requiredPermission).toBeUndefined();
    expect(nav.execute).toBeUndefined();
  });
});
