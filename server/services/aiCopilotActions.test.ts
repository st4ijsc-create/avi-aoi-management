/**
 * GĐ2 — AI Copilot HITL write-action lifecycle tests.
 *
 * Exercises propose → confirm → execute with the set_spec_limits sample tool.
 * The DB (ai_pending_actions) is faked with an in-memory store implementing the
 * exact drizzle chains the service uses. db/product (the actual mutation) and
 * accessControl.checkPermission are mocked so we can assert: preview does NOT
 * mutate; confirm mutates; idempotency; ownership/expiry/RBAC gates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake in-memory ai_pending_actions store + drizzle-like query builder ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: async (vals: Row) => {
        store.set(vals.id, { ...vals });
      },
    }),
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of store.values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: Row) => ({
        where: async (pred: (r: Row) => boolean) => {
          let count = 0;
          for (const r of store.values()) {
            if (pred(r)) {
              Object.assign(r, patch);
              count++;
            }
          }
          return { rowCount: count };
        },
      }),
    }),
  };
}

// Translate the drizzle eq()/and()/lt() helpers into row predicates. Our schema
// columns are referenced as objects; we encode the predicate via these mocks.
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

// Schema: expose only the columns the service touches, tagged with __name so
// the eq/and/lt mocks can resolve them against fake rows.
vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

const checkPermission = vi.fn();
vi.mock("../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermission(...a),
}));

const updateMeasurementPointDef = vi.fn(async () => {});
const getMeasurementPointDefById = vi.fn();
vi.mock("../db/product", () => ({
  updateMeasurementPointDef: (...a: unknown[]) => updateMeasurementPointDef(...a),
  getMeasurementPointDefById: (...a: unknown[]) => getMeasurementPointDefById(...a),
}));

// Silence audit writes (assert they are called, but they don't touch a DB).
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { getTool } from "./aiLocalTools/toolRegistry";
import "./aiLocalTools/writeHandlers"; // registers set_spec_limits
import { proposeAction, confirmAction, cancelAction } from "./aiCopilotActions";

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const OPERATOR = { id: 2, role: "operator", name: "Op" } as const;
const ctx = (user: typeof ADMIN | typeof OPERATOR) => ({ user, lang: "vi" as const });

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  getMeasurementPointDefById.mockResolvedValue({
    id: 12, code: "MP12", name: "Điểm đo 12",
    upperLimit: "9.0", lowerLimit: "8.0", nominalValue: "8.5",
  });
});

function tool() {
  const t = getTool("set_spec_limits");
  if (!t) throw new Error("set_spec_limits not registered");
  return t;
}

describe("propose write-action", () => {
  it("does NOT mutate the DB at propose time (preview only)", async () => {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    expect(res.ok).toBe(true);
    expect(getMeasurementPointDefById).toHaveBeenCalledTimes(1); // preview reads
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();    // execute NOT called
    expect(res.pendingAction?.preview.changes.length).toBeGreaterThan(0);
  });

  it("warns when USL < LSL", async () => {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 5, lsl: 8, target: 7 }, ctx(ADMIN));
    expect(res.pendingAction?.preview.warnings.some((w) => /USL.*LSL/.test(w))).toBe(true);
  });

  it("operator without permission is denied (no propose, audit denied)", async () => {
    checkPermission.mockResolvedValue(false);
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(OPERATOR));
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(store.size).toBe(0); // nothing stored
    expect(logCrudOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_action_denied" }),
    );
  });
});

describe("confirm write-action", () => {
  async function propose(user = ADMIN) {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(user));
    return res.pendingAction!;
  }

  it("admin confirm executes + mutates measurement_point_defs + audits target update", async () => {
    const pa = await propose();
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(res.ok).toBe(true);
    expect(res.status).toBe("executed");
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1);
    // changedBy threaded from session user
    expect(updateMeasurementPointDef).toHaveBeenCalledWith(
      12, expect.anything(), expect.objectContaining({ changedBy: 1, changeReason: "AI Copilot" }),
    );
    expect(logUpdate).toHaveBeenCalledTimes(1); // target-entity before/after audit
  });

  it("confirm with wrong userId is blocked", async () => {
    const pa = await propose();
    const res = await confirmAction(pa.actionId, pa.token, OPERATOR, "vi");
    expect(res.ok).toBe(false);
    expect(res.status).toBe("invalid");
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });

  it("expired proposal is blocked", async () => {
    const pa = await propose();
    store.get(pa.actionId)!.expiresAt = new Date(Date.now() - 1000); // force expiry
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(res.status).toBe("expired");
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });

  it("double-confirm is idempotent (execute runs exactly once)", async () => {
    const pa = await propose();
    const r1 = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    const r2 = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(r1.status).toBe("executed");
    expect(r2.status).toBe("executed");
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1); // not twice
  });

  it("RBAC revoked between propose and confirm → denied at execute gate", async () => {
    const pa = await propose();
    checkPermission.mockResolvedValue(false); // permission lost after propose
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(res.status).toBe("denied");
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });
});

describe("cancel write-action", () => {
  it("cancel blocks subsequent confirm", async () => {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    const pa = res.pendingAction!;
    const c = await cancelAction(pa.actionId, ADMIN);
    expect(c.ok).toBe(true);
    expect(c.status).toBe("cancelled");
    const conf = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(conf.ok).toBe(false);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
  });
});
