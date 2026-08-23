/**
 * G4.29 (doc 44 W5-A3) — AI Copilot ADVICE-CONTRACT tests.
 *
 * Proves:
 *   (1) ADDITIVE contract — a legacy propose (no contract) yields a DTO with NONE
 *       of the new keys (backward-compatible); a propose WITH a contract surfaces
 *       exactly the set keys.
 *   (2) Confirm-time enforcement (flag ADVICE_CONTRACT_ENABLED ON):
 *       • policy_permit DENY → blocked (POLICY_DENIED), execute NOT run, token NOT
 *         burned (row stays `confirmed`), and a later PERMIT retry executes.
 *       • twin_validation untrusted → blocked (TWIN_UNTRUSTED), execute NOT run.
 *       • guardrail out-of-band → blocked (GUARDRAIL_VIOLATION), token burned.
 *   (3) Flag OFF → legacy flow, byte-for-byte: no enforcement, no `reason` key,
 *       the policy seam is NEVER called; execute runs.
 *
 * Reuses the in-memory ai_pending_actions fake + set_spec_limits sample tool from
 * aiCopilotActions.test.ts. The policy/twin seams are INJECTED (never the real
 * modules) so the assertions are hermetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    // ★★★ 2026-08-23 — xem chú thích cùng tên ở `aiCopilotActions.test.ts`: `where()` vừa await được
    // vừa có `.returning()`, và `run()` được nhớ lại để không áp `patch` hai lần.
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

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

const checkPermission = vi.fn();
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

const updateMeasurementPointDef = vi.fn(async () => {});
const getMeasurementPointDefById = vi.fn();
vi.mock("../db/product", () => ({
  updateMeasurementPointDef: (...a: unknown[]) => updateMeasurementPointDef(...a),
  getMeasurementPointDefById: (...a: unknown[]) => getMeasurementPointDefById(...a),
}));

vi.mock("./thresholdGovernanceService", () => ({
  resolveThresholdEditGate: vi.fn(async () => ({
    decision: "direct", productModelId: 1, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  })),
}));
vi.mock("../db/system", () => ({ createAuditLog: vi.fn(async () => ({ id: 1 })) }));

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
import { proposeAction, confirmAction, ADVICE_REJECT_REASONS, type AdviceContract, type ConfirmContractDeps } from "./aiCopilotActions";

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const ctx = (user: typeof ADMIN) => ({ user, lang: "vi" as const });

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  getMeasurementPointDefById.mockResolvedValue({
    id: 12, code: "MP12", name: "Điểm đo 12",
    upperLimit: "9.0", lowerLimit: "8.0", nominalValue: "8.5",
  });
});
afterEach(() => {
  delete process.env.ADVICE_CONTRACT_ENABLED;
  delete process.env.ADVICE_REQUIRES_STRICT;
});

function tool() {
  const t = getTool("set_spec_limits");
  if (!t) throw new Error("set_spec_limits not registered");
  return t;
}
const okArgs = { measurementPointDefId: 12, usl: 10, lsl: 8, target: 9 };

async function propose(contract?: AdviceContract) {
  const res = await proposeAction(tool(), { ...okArgs }, ctx(ADMIN), contract);
  return res.pendingAction!;
}

// ─── (1) additive contract on the DTO ──────────────────────────────────────────

describe("G4.29 — additive PendingActionDTO", () => {
  it("legacy propose (no contract) → DTO carries NONE of the contract keys", async () => {
    const pa = await propose();
    for (const k of ["guardrail", "requires", "confidence", "expected", "explain"]) {
      expect(pa, k).not.toHaveProperty(k);
    }
    // Legacy fields intact.
    expect(pa.actionId).toBeTruthy();
    expect(pa.preview.changes.length).toBeGreaterThan(0);
  });

  it("propose WITH a contract → DTO surfaces exactly the set keys", async () => {
    const pa = await propose({
      requires: ["policy_permit", "twin_validation"],
      guardrail: { min: 0, max: 100, unit: "%", key: "usl" },
      confidence: 0.7,
      explain: ["mean drift", "within band"],
    });
    expect(pa.requires).toEqual(["policy_permit", "twin_validation"]);
    expect(pa.guardrail).toEqual({ min: 0, max: 100, unit: "%", key: "usl" });
    expect(pa.confidence).toBe(0.7);
    expect(pa.explain).toEqual(["mean drift", "within band"]);
    expect(pa).not.toHaveProperty("expected"); // unset key omitted
  });
});

// ─── (2) confirm-time enforcement (flag ON) ────────────────────────────────────

describe("G4.29 — confirm enforcement (ADVICE_CONTRACT_ENABLED=true)", () => {
  beforeEach(() => {
    process.env.ADVICE_CONTRACT_ENABLED = "true";
  });

  it("policy DENY blocks execute + does NOT burn the token (retry after PERMIT executes)", async () => {
    const pa = await propose({ requires: ["policy_permit"] });
    const deny: ConfirmContractDeps = { evaluatePolicy: () => ({ decision: "DENY", reason_code: "NO_MATCHING_ALLOW_POLICY" }) };

    const first = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, deny);
    expect(first.ok).toBe(false);
    expect(first.status).toBe("denied");
    expect(first.reason).toBe(ADVICE_REJECT_REASONS.POLICY_DENIED);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
    // Token NOT burned → row is still re-confirmable (status confirmed, not denied).
    expect(store.get(pa.actionId)!.status).toBe("confirmed");

    // Policy flips to PERMIT → the SAME action now executes (token was preserved).
    const permit: ConfirmContractDeps = { evaluatePolicy: () => ({ decision: "PERMIT" }) };
    const retry = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, permit);
    expect(retry.status).toBe("executed");
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1);
  });

  it("twin untrusted blocks execute (TWIN_UNTRUSTED)", async () => {
    const pa = await propose({ requires: ["twin_validation"] });
    const deps: ConfirmContractDeps = {
      resolveTwinRef: async () => "line:1",
      isTwinTrusted: async () => false,
    };
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(ADVICE_REJECT_REASONS.TWIN_UNTRUSTED);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
    expect(store.get(pa.actionId)!.status).toBe("confirmed"); // transient → not burned
  });

  it("twin trusted → passes through to execute", async () => {
    const pa = await propose({ requires: ["twin_validation"] });
    const deps: ConfirmContractDeps = { resolveTwinRef: async () => "line:1", isTwinTrusted: async () => true };
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, deps);
    expect(res.status).toBe("executed");
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1);
  });

  it("guardrail out-of-band blocks + BURNS the token (GUARDRAIL_VIOLATION)", async () => {
    // args.target = 9 (from okArgs) is outside the contrived band [0,5].
    const pa = await propose({ guardrail: { min: 0, max: 5, key: "target", unit: "" } });
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(ADVICE_REJECT_REASONS.GUARDRAIL_VIOLATION);
    expect(updateMeasurementPointDef).not.toHaveBeenCalled();
    expect(store.get(pa.actionId)!.status).toBe("denied"); // burned (args immutable)
  });

  it("twin ref unresolvable → not applicable (passes) unless STRICT", async () => {
    const pa = await propose({ requires: ["twin_validation"] });
    const deps: ConfirmContractDeps = { resolveTwinRef: async () => null, isTwinTrusted: async () => false };
    // Default (non-strict): unresolvable twin ⇒ validation not applicable ⇒ executes.
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, deps);
    expect(res.status).toBe("executed");

    // STRICT: unresolvable twin ⇒ blocked.
    process.env.ADVICE_REQUIRES_STRICT = "true";
    const pa2 = await propose({ requires: ["twin_validation"] });
    const res2 = await confirmAction(pa2.actionId, pa2.token, ADMIN, "vi", undefined, deps);
    expect(res2.ok).toBe(false);
    expect(res2.reason).toBe(ADVICE_REJECT_REASONS.TWIN_NOT_RESOLVABLE);
  });
});

// ─── (3) flag OFF → legacy flow, bit-compat ────────────────────────────────────

describe("G4.29 — ADVICE_CONTRACT_ENABLED OFF is byte-for-byte legacy", () => {
  it("a contract that WOULD deny is ignored; execute runs; no reason key; policy seam untouched", async () => {
    // Flag unset (default OFF).
    const pa = await propose({ requires: ["policy_permit"] });
    const evalSpy = vi.fn(() => ({ decision: "DENY" as const }));
    const res = await confirmAction(pa.actionId, pa.token, ADMIN, "vi", undefined, { evaluatePolicy: evalSpy });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("executed");
    expect(res).not.toHaveProperty("reason"); // legacy ConfirmResult shape
    expect(Object.keys(res).sort()).toEqual(["message", "ok", "result", "status"]);
    expect(evalSpy).not.toHaveBeenCalled(); // enforcement fully skipped
    expect(updateMeasurementPointDef).toHaveBeenCalledTimes(1);
  });
});
