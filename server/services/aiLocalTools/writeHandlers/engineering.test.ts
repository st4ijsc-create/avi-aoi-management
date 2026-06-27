/**
 * Phase B1 — ENGINEERING write-tools safety suite.
 *
 * SAFETY-CRITICAL invariant under test: every write goes through the HITL
 * propose→confirm flow; nothing mutates without a confirmAction. Asserts, for
 * each new tool (adjust_ng_threshold / configure_inspection_param /
 * create_ng_threshold / update_product_quality_target):
 *   (a) propose creates a pending row but does NOT execute (no DB mutation);
 *   (b) execute only happens after confirm;
 *   (c) denied permission → no row + audit deny;
 *   (d) TTL-expired confirm → rejected, no execute;
 *   (e) RBAC re-checked at confirm (role revoked between phases → denied);
 *   (f) zod min/max bounds reject out-of-range values;
 *   (g) preview does NOT mutate.
 *
 * Mocking mirrors writeHandlers.gd3.test.ts + machineControl.tools.test.ts:
 * a fake ai_pending_actions store + a drizzle-like builder, with the config
 * tables (mqtt_ng_rate_thresholds, product_models) backed by in-memory rows so
 * we can observe whether preview/execute mutated them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>(); // ai_pending_actions
// Config tables (mutation observed here — preview must NOT touch them).
let ngThresholds: Row[] = [];
let products: Row[] = [];
const inserted: Row[] = []; // create_ng_threshold inserts land here

function freshData() {
  ngThresholds = [
    { id: 1, name: "NG MP001", stationId: 5, warningThreshold: "5.00", criticalThreshold: "10.00", minSampleSize: 10, cooldownMinutes: 30 },
  ];
  products = [
    { id: 2, code: "PM2", name: "Sản phẩm 2", targetYieldRate: "98.00", minYieldRate: "95.00" },
  ];
  inserted.length = 0;
}

function tableFor(table: any): Row[] {
  const t = table?.__table;
  if (t === "mqtt_ng_rate_thresholds") return ngThresholds;
  if (t === "product_models") return products;
  return Array.from(store.values());
}

// insert().values() must support BOTH call styles used in the codebase:
//   - aiCopilotActions: `await db.insert(t).values(v)`            (awaits directly)
//   - create_ng_threshold: `await db.insert(t).values(v).returning(...)`
// So values() returns a thenable: awaiting it performs the insert once; calling
// .returning() performs the insert once and returns the new id. An `applied`
// guard prevents a double insert if both are exercised on the same builder.
function makeFakeDb() {
  return {
    insert: (table: any) => ({
      values: (vals: Row) => {
        let applied = false;
        const apply = () => {
          if (applied) return undefined;
          applied = true;
          if (table?.__table === "mqtt_ng_rate_thresholds") {
            const id = 100 + ngThresholds.length;
            const row = { id, ...vals };
            ngThresholds.push(row);
            inserted.push(row);
            return id;
          }
          store.set(vals.id, { ...vals }); // ai_pending_actions
          return undefined;
        };
        return {
          then: (res: (v: unknown) => void) => { apply(); res(undefined); },
          returning: async () => { const id = apply(); return [{ id }]; },
        };
      },
    }),
    select: () => ({
      from: (table: any) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async () => {
            for (const r of tableFor(table)) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: (table: any) => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let c = 0;
          for (const r of tableFor(table)) if (pred(r)) { Object.assign(r, patch); c++; }
          return { rowCount: c };
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
// NOTE: vi.mock specifiers resolve relative to THIS test file
// (server/services/aiLocalTools/writeHandlers/). aiCopilotActions imports
// "../db/connection" (server/db/connection) and engineering.ts imports
// "../../../db/connection" — both resolve to the SAME absolute file, so the
// canonical specifier from here is "../../../db/connection".
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

function schemaFactory() {
  return {
    aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
    mqttNgRateThresholds: { __table: "mqtt_ng_rate_thresholds", id: { __name: "id" } },
    productModels: { __table: "product_models", id: { __name: "id" } },
  };
}
// aiCopilotActions: "../../drizzle/schema"; engineering.ts: "../../../../drizzle/schema".
vi.mock("../../../../drizzle/schema", () => schemaFactory());

const checkPermission = vi.fn();
// aiCopilotActions imports "../_core/accessControl" (server/_core/accessControl).
vi.mock("../../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

// `import "../writeHandlers"` self-registers ALL sibling write-tools. The non-
// engineering siblings import db helper barrels that (transitively) pull the
// full drizzle schema (server/db/integration.ts) — which our partial schema mock
// can't satisfy. Stub those db helpers so the barrel never loads. (engineering.ts
// itself uses ONLY getDb + the two tables we mock above.)
vi.mock("../../../db/product", () => ({
  getMeasurementPointDefById: vi.fn(async () => null),
  getMeasurementPointDefByCode: vi.fn(async () => undefined),
  createMeasurementPointDef: vi.fn(async () => 1),
  updateMeasurementPointDef: vi.fn(async () => {}),
}));
vi.mock("../../../db/alerts", () => ({
  getAlertHistoryById: vi.fn(async () => null),
  acknowledgeAlert: vi.fn(async () => {}),
  getYieldAlertThresholdById: vi.fn(async () => null),
  getYieldAlertThresholdByType: vi.fn(async () => null),
  updateYieldAlertThreshold: vi.fn(async () => {}),
  createYieldThresholdHistory: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../../../db/ai", () => ({
  getPredictiveAlertById: vi.fn(async () => null),
  acknowledgePredictiveAlert: vi.fn(async () => {}),
  resolvePredictiveAlert: vi.fn(async () => {}),
}));
vi.mock("../../../db/machineRecipe", () => ({ getActiveRecipe: vi.fn(async () => null) }));
vi.mock("../../ot/commandDispatcher", () => ({ dispatch: vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] })), isOtControlEnabled: () => false }));

// audit — silence. aiCopilotActions imports "./auditTrailService"
// (server/services/auditTrailService) → "../../auditTrailService" from here.
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../../auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed", AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied", AI_ACTION_CANCELLED: "ai_action_cancelled" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { getTool } from "../toolRegistry";
import "../writeHandlers"; // registers all write-tools incl. engineering
import { proposeAction, confirmAction } from "../../aiCopilotActions";

const ENGINEER = { id: 3, role: "engineer", name: "Eng" } as const;
const OPERATOR = { id: 2, role: "operator", name: "Op" } as const;
const ctx = (user: typeof ENGINEER | typeof OPERATOR) => ({ user, lang: "vi" as const });

function tool(name: string) {
  const t = getTool(name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

beforeEach(() => {
  store.clear();
  freshData();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
});

// ─── registration + RBAC declarations ─────────────────────────────────────────
describe("engineering tools — registration + requiredPermission", () => {
  it("all 4 tools registered as kind:write with engineering permissions", () => {
    expect(tool("adjust_ng_threshold").requiredPermission).toEqual({ module: "settings_alerts", action: "canEdit" });
    expect(tool("configure_inspection_param").requiredPermission).toEqual({ module: "settings_alerts", action: "canEdit" });
    expect(tool("create_ng_threshold").requiredPermission).toEqual({ module: "settings_alerts", action: "canCreate" });
    expect(tool("update_product_quality_target").requiredPermission).toEqual({ module: "settings_products", action: "canEdit" });
    for (const n of ["adjust_ng_threshold", "configure_inspection_param", "create_ng_threshold", "update_product_quality_target"]) {
      expect(tool(n).kind).toBe("write");
    }
  });
});

// ─── (a)+(b)+(g) propose → preview-only → confirm → execute ───────────────────
describe("adjust_ng_threshold — HITL propose/confirm", () => {
  it("(a)(g) propose stores a pending row but does NOT mutate the threshold", async () => {
    const before = ngThresholds[0].warningThreshold;
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 7 }, ctx(ENGINEER));
    expect(p.ok).toBe(true);
    expect(store.size).toBe(1);
    expect(ngThresholds[0].warningThreshold).toBe(before); // preview did NOT write
    expect(p.pendingAction!.preview.changes.some((c) => c.field === "warningThreshold")).toBe(true);
  });

  it("(b) execute only happens after confirm", async () => {
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 7, criticalThreshold: 12 }, ctx(ENGINEER));
    expect(ngThresholds[0].warningThreshold).toBe("5.00"); // still unchanged pre-confirm
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("executed");
    expect(ngThresholds[0].warningThreshold).toBe("7");
    expect(ngThresholds[0].criticalThreshold).toBe("12");
  });

  it("preview warns when critical < warning (cross-field sanity)", async () => {
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 20, criticalThreshold: 10 }, ctx(ENGINEER));
    expect(p.pendingAction!.preview.warnings.join(" ")).toMatch(/nghiêm trọng|critical/i);
  });
});

// ─── (c) denied permission → no row + audit deny ──────────────────────────────
describe("RBAC — propose denial", () => {
  it("(c) operator without permission → denied, nothing stored, audit deny", async () => {
    checkPermission.mockResolvedValue(false);
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 7 }, ctx(OPERATOR));
    expect(p.ok).toBe(false);
    expect(p.denied).toBe(true);
    expect(store.size).toBe(0);
    expect(ngThresholds[0].warningThreshold).toBe("5.00");
    expect(logCrudOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_action_denied" }));
  });
});

// ─── (d) TTL-expired confirm → rejected, no execute ───────────────────────────
describe("TTL expiry", () => {
  it("(d) expired pending row → confirm rejected, no mutation", async () => {
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 7 }, ctx(ENGINEER));
    // Force-expire the stored row.
    const row = store.get(p.pendingAction!.actionId)!;
    row.expiresAt = new Date(Date.now() - 1000);
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("expired");
    expect(ngThresholds[0].warningThreshold).toBe("5.00"); // no execute
  });
});

// ─── (e) RBAC re-checked at confirm (role revoked between phases) ─────────────
describe("RBAC #2 at confirm", () => {
  it("(e) permission revoked between propose and confirm → denied, no mutation", async () => {
    const p = await proposeAction(tool("adjust_ng_threshold"), { thresholdId: 1, warningThreshold: 7 }, ctx(ENGINEER));
    checkPermission.mockResolvedValue(false); // role downgraded
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("denied");
    expect(ngThresholds[0].warningThreshold).toBe("5.00");
  });
});

// ─── (f) zod min/max bounds ───────────────────────────────────────────────────
describe("zod bounds reject out-of-range values", () => {
  it("(f) adjust_ng_threshold rejects >100 and <0 percentages", () => {
    const schema = tool("adjust_ng_threshold").parameters as any;
    expect(schema.safeParse({ thresholdId: 1, warningThreshold: 150 }).success).toBe(false);
    expect(schema.safeParse({ thresholdId: 1, warningThreshold: -1 }).success).toBe(false);
    expect(schema.safeParse({ thresholdId: 1, warningThreshold: 50 }).success).toBe(true);
  });

  it("(f) adjust_ng_threshold rejects empty patch + unknown keys (strict)", () => {
    const schema = tool("adjust_ng_threshold").parameters as any;
    expect(schema.safeParse({ thresholdId: 1 }).success).toBe(false); // refine: need a field
    expect(schema.safeParse({ thresholdId: 1, warningThreshold: 5, bogus: 1 }).success).toBe(false);
  });

  it("(f) configure_inspection_param bounds minSampleSize/cooldown", () => {
    const schema = tool("configure_inspection_param").parameters as any;
    expect(schema.safeParse({ thresholdId: 1, minSampleSize: 0 }).success).toBe(false);
    expect(schema.safeParse({ thresholdId: 1, cooldownMinutes: 5000 }).success).toBe(false);
    expect(schema.safeParse({ thresholdId: 1, minSampleSize: 25, cooldownMinutes: 60 }).success).toBe(true);
  });

  it("(f) create_ng_threshold bounds thresholds 0–100 and requires name", () => {
    const schema = tool("create_ng_threshold").parameters as any;
    expect(schema.safeParse({ stationId: 5, name: "X", warningThreshold: 5, criticalThreshold: 200 }).success).toBe(false);
    expect(schema.safeParse({ stationId: 5, warningThreshold: 5, criticalThreshold: 10 }).success).toBe(false); // missing name
    expect(schema.safeParse({ stationId: 5, name: "X", warningThreshold: 5, criticalThreshold: 10 }).success).toBe(true);
  });

  it("(f) update_product_quality_target bounds FPY 0–100", () => {
    const schema = tool("update_product_quality_target").parameters as any;
    expect(schema.safeParse({ productModelId: 2, targetYieldRate: 120 }).success).toBe(false);
    expect(schema.safeParse({ productModelId: 2 }).success).toBe(false); // refine: need a field
    expect(schema.safeParse({ productModelId: 2, targetYieldRate: 99, minYieldRate: 95 }).success).toBe(true);
  });
});

// ─── configure_inspection_param — execute path ────────────────────────────────
describe("configure_inspection_param — execute after confirm", () => {
  it("preview reads only; execute updates minSampleSize + cooldown", async () => {
    const p = await proposeAction(tool("configure_inspection_param"), { thresholdId: 1, minSampleSize: 50, cooldownMinutes: 15 }, ctx(ENGINEER));
    expect(ngThresholds[0].minSampleSize).toBe(10); // preview did not write
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("executed");
    expect(ngThresholds[0].minSampleSize).toBe(50);
    expect(ngThresholds[0].cooldownMinutes).toBe(15);
  });
});

// ─── create_ng_threshold — add-new path ───────────────────────────────────────
describe("create_ng_threshold — setup/add-new after confirm", () => {
  it("preview does NOT insert; execute inserts with createdBy = userId", async () => {
    const p = await proposeAction(
      tool("create_ng_threshold"),
      { stationId: 5, name: "NG MP002 > 6%", warningThreshold: 6, criticalThreshold: 11, minSampleSize: 20, cooldownMinutes: 45 },
      ctx(ENGINEER),
    );
    expect(p.ok).toBe(true);
    expect(inserted.length).toBe(0); // preview did not insert
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("executed");
    expect(inserted.length).toBe(1);
    expect(inserted[0].createdBy).toBe(3);
    expect(inserted[0].warningThreshold).toBe("6");
    expect((c.result as any).data.id).toBeGreaterThan(0);
  });
});

// ─── update_product_quality_target — update path ──────────────────────────────
describe("update_product_quality_target — update after confirm", () => {
  it("preview reads only; execute updates target/min FPY", async () => {
    const p = await proposeAction(tool("update_product_quality_target"), { productModelId: 2, targetYieldRate: 99, minYieldRate: 96 }, ctx(ENGINEER));
    expect(products[0].targetYieldRate).toBe("98.00"); // preview did not write
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ENGINEER, "vi");
    expect(c.status).toBe("executed");
    expect(products[0].targetYieldRate).toBe("99");
    expect(products[0].minYieldRate).toBe("96");
  });

  it("preview warns when min FPY > target FPY", async () => {
    const p = await proposeAction(tool("update_product_quality_target"), { productModelId: 2, targetYieldRate: 90, minYieldRate: 95 }, ctx(ENGINEER));
    expect(p.pendingAction!.preview.warnings.join(" ")).toMatch(/min FPY|target FPY/i);
  });
});
