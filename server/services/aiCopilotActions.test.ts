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
    // ★★★ 2026-08-23 — `where(...)` nay là một THENABLE **và** có `.returning()`: `confirmAction`
    // giành quyền bằng `UPDATE … WHERE status=<đã quan sát>` rồi ĐẾM hàng trả về. `run()` được nhớ
    // lại (memo) để một lượt gọi không bao giờ áp `patch` hai lần dù người gọi `await` hay `.returning()`.
    update: (_table: unknown) => ({
      set: (patch: Row) => ({
        where: (pred: (r: Row) => boolean) => {
          let daChay: Row[] | null = null;
          const run = (): Row[] => {
            if (daChay) return daChay;
            const trung: Row[] = [];
            for (const r of store.values()) {
              if (pred(r)) {
                Object.assign(r, patch);
                trung.push(r);
              }
            }
            daChay = trung;
            return trung;
          };
          return {
            then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
              Promise.resolve({ rowCount: run().length }).then(ok, ng),
            returning: async (_cols?: unknown) => run().map((r) => ({ id: r.id })),
          };
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

// Doc 31 B.6 — set_spec_limits now consults the lifecycle gate before writing.
// Return a permissive (development/direct) decision so these HITL-flow tests still
// exercise the write path; and stub the audit sink the tool writes on allow.
vi.mock("./thresholdGovernanceService", () => ({
  resolveThresholdEditGate: vi.fn(async () => ({
    decision: "direct", productModelId: 1, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  })),
}));
vi.mock("../db/system", () => ({ createAuditLog: vi.fn(async () => ({ id: 1 })) }));

// Silence audit writes (assert they are called, but they don't touch a DB).
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
// ── E2-4 — spy on the realtime nudge; proposeAction/confirmAction call this as
// their LAST step (after their own DB persist). Mocked here so these existing
// behavioral tests stay decoupled from the realtime channel; aiAgentRealtime.
// test.ts covers the publish/bridge mechanics themselves.
const publishAiAgentEvent = vi.fn();
vi.mock("./aiAgentRealtime", () => ({
  publishAiAgentEvent: (...a: unknown[]) => publishAiAgentEvent(...a),
}));

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

describe("E2-4 — realtime nudge at the propose/confirm choke points", () => {
  it("proposeAction publishes 'action_proposed' AFTER the row is persisted", async () => {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    expect(publishAiAgentEvent).toHaveBeenCalledWith("action_proposed");
    // the row must already exist in the store by the time we publish
    expect(store.has(res.pendingAction!.actionId)).toBe(true);
  });

  it("a DENIED propose (RBAC) does NOT publish (no state change)", async () => {
    checkPermission.mockResolvedValue(false);
    await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(OPERATOR));
    expect(publishAiAgentEvent).not.toHaveBeenCalled();
  });

  it("confirmAction publishes 'action_confirmed' AFTER execute persists (not on denied/expired)", async () => {
    const proposed = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    const pa = proposed.pendingAction!;
    publishAiAgentEvent.mockClear();
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(res.status).toBe("executed");
    expect(publishAiAgentEvent).toHaveBeenCalledWith("action_confirmed");
  });

  it("a wrong-owner confirm (blocked before execute) does NOT publish 'action_confirmed'", async () => {
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    const pa = res.pendingAction!;
    publishAiAgentEvent.mockClear();
    const conf = await confirmAction(pa.actionId, pa.token, OPERATOR, "vi");
    expect(conf.status).toBe("invalid");
    expect(publishAiAgentEvent).not.toHaveBeenCalled();
  });

  it("the published payload carries NO plan/args/secret fields — event name only", async () => {
    await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    const call = publishAiAgentEvent.mock.calls.find((c) => c[0] === "action_proposed")!;
    expect(call).toBeTruthy();
    // proposeAction calls publishAiAgentEvent(event) — a single positional arg,
    // never args/preview/secret data.
    expect(call).toHaveLength(1);
  });

  it("a THROWING publishAiAgentEvent never breaks proposeAction/confirmAction", async () => {
    publishAiAgentEvent.mockImplementation(() => {
      throw new Error("nudge boom");
    });
    const res = await proposeAction(tool(), { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 }, ctx(ADMIN));
    expect(res.ok).toBe(true);
    const confirmRes = await confirmAction(res.pendingAction!.actionId, res.pendingAction!.token, ADMIN, "vi");
    expect(confirmRes.ok).toBe(true);
    expect(confirmRes.status).toBe("executed");
  });
});
