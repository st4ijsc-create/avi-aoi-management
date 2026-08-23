/**
 * doc 69 Giai đoạn 4/Wave 3 — D2 bounded-autonomy WIRE tests.
 *
 * Unlike autonomyPolicy.test.ts (which mocks evaluateContractForAutonomy to unit-test
 * the AND-chain in isolation), this file exercises the REAL wiring end to end:
 * proposeAction() → evaluateAutonomy() (REAL) → confirmAction() (REAL, the SAME path a
 * human confirm uses) → execute(). Only the DB layer, checkPermission, and the audit
 * sink are mocked (same fake-store harness as aiCopilotActions.test.ts /
 * aiCopilotActions.contract.test.ts) — nothing about the autonomy decision itself is
 * stubbed, so a passing test here proves the actual policy + actual guardrail
 * enforcement, not a mock's opinion of them.
 *
 * A stub tool is registered inline (with its own execute spy) instead of importing a real
 * writeHandler — the mechanism under test is generic to any tool and the spy is what makes
 * "was it really executed?" observable.
 *
 * ⚠⚠ G3-C — **CÁI TÊN CỦA STUB KHÔNG CÒN TUỲ Ý.** Nó từng là `test_autonomy_widget_update`,
 * một cái tên bịa. `evaluateAutonomyChain` nay có điều kiện 3b: một tool `kind:"write"` CÓ
 * TRONG REGISTRY mà **chưa được triage** vào `AUTONOMY_INELIGIBLE` hay `AUTONOMY_REVIEWED_SAFE`
 * thì **không đủ tư cách tự trị**, kể cả khi đã được allowlist — chính là hàng rào chống lớp lỗi
 * "tool thứ N+1 mặc định tự trị được". Một cái tên bịa vì thế **phải** bị từ chối, và một test
 * dựng để chứng minh "đường tự trị chạy" thì phải chạy trên một tool ĐÃ ĐƯỢC TRIAGE.
 * ⇒ Stub mượn tên `acknowledge_alert` (một mục thật trong `AUTONOMY_REVIEWED_SAFE`). Đây đã là
 * quy ước sẵn có của chính file này — ca denylist bên dưới cũng mượn tên thật `set_machine_param`.
 * Registry của vitest cách ly theo FILE nên bản stub này không đè lên tool sản xuất ở đâu khác.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// ── Fake in-memory DB: TWO tables (ai_pending_actions + ai_system_config) behind
// ONE mocked getDb(), routed by a `__table` marker on the mocked schema objects — both
// aiCopilotActions.ts and (dynamically, from evaluateAutonomy) autonomyPolicy.ts resolve
// to the SAME "../db/connection" / "../../drizzle/schema" modules, so one mock covers both.
type Row = Record<string, any>;
const pendingStore = new Map<string, Row>();
const configStore = new Map<string, Row>();

function storeFor(table: any): Map<string, Row> {
  return table?.__table === "ai_system_config" ? configStore : pendingStore;
}
function keyOf(table: any, row: Row): string {
  return table?.__table === "ai_system_config" ? row.key : row.id;
}

function makeFakeDb() {
  return {
    insert: (table: unknown) => ({
      values: (vals: Row) => {
        const store = storeFor(table);
        const k = keyOf(table, vals);
        store.set(k, { ...vals });
        const result: any = Promise.resolve(undefined);
        result.onConflictDoUpdate = async ({ set }: { set: Row }) => {
          const existing = store.get(k) ?? { ...vals };
          Object.assign(existing, set);
          store.set(k, existing);
        };
        return result;
      },
    }),
    select: (_cols?: unknown) => ({
      from: (table: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of storeFor(table).values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    // ★★★ 2026-08-23 — xem chú thích cùng tên ở `aiCopilotActions.test.ts`.
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (pred: (r: Row) => boolean) => {
          let daChay: Row[] | null = null;
          const run = (): Row[] => {
            if (daChay) return daChay;
            const trung: Row[] = [];
            for (const r of storeFor(table).values()) {
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
    __table: "ai_pending_actions",
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
  aiSystemConfig: {
    __table: "ai_system_config",
    key: { __name: "key" },
    value: { __name: "value" },
    description: { __name: "description" },
    updatedBy: { __name: "updatedBy" },
    updatedAt: { __name: "updatedAt" },
  },
}));

const checkPermission = vi.fn();
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
    AI_AUTONOMY_DECISION: "ai_autonomy_decision",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { registerTool, getTool, type Tool } from "./aiLocalTools/toolRegistry";
import { proposeAction, confirmAction, type AdviceContract } from "./aiCopilotActions";

// G3-C — tên PHẢI nằm trong AUTONOMY_REVIEWED_SAFE (xem khối đầu file). Đổi sang một tên chưa
// triage là ca này đỏ, và đó là hành vi ĐÚNG của điều kiện 3b.
const TOOL_NAME = "acknowledge_alert";
const executeSpy = vi.fn(async (p: { widgetId: number }, _ctx: unknown) => ({
  type: "action_result" as const,
  title: "ok",
  data: { ok: true, widgetId: p.widgetId },
  textSummary: "done",
}));

function registerTestTool() {
  const tool: Tool<{ widgetId: number }, { ok: boolean; widgetId: number }> = {
    name: TOOL_NAME,
    description: "Test-only low-risk tool for D2 autonomy wiring tests (not a real production tool).",
    parameters: z.object({ widgetId: z.number() }).strict(),
    triggers: [],
    kind: "write",
    requiredPermission: { module: "test_autonomy", action: "canEdit" },
    summarize: () => "Cập nhật widget thử nghiệm.",
    preview: async (p) => ({
      entityType: "test_widget",
      entityId: p.widgetId,
      changes: [{ field: "widgetId", oldValue: null, newValue: p.widgetId, displayName: "Widget" }],
      warnings: [],
      humanSummary: "Cập nhật widget thử nghiệm.",
    }),
    execute: executeSpy,
  };
  registerTool(tool);
}
registerTestTool();

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const proposeCtx = (user: typeof ADMIN = ADMIN) => ({ user, lang: "vi" as const });

const inBandContract: AdviceContract = { guardrail: { min: 0, max: 100, key: "widgetId" }, requires: [] };
const outOfBandContract: AdviceContract = { guardrail: { min: 0, max: 2, key: "widgetId" }, requires: [] };

beforeEach(() => {
  pendingStore.clear();
  configStore.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.AI_AUTONOMY_ENABLED;
  delete process.env.AI_AUTONOMY_ALLOWLIST;
  delete process.env.AI_AUTONOMY_MAX_PER_HOUR;
});

function tool() {
  const t = getTool(TOOL_NAME);
  if (!t) throw new Error(`${TOOL_NAME} not registered`);
  return t;
}

describe("D2 wire — master flag OFF (default) ⇒ zero behavior change", () => {
  it("proposeAction leaves the action `proposed`; execute() is NOT called", async () => {
    // Master flag intentionally left unset (default OFF) even though allowlisted.
    process.env.AI_AUTONOMY_ALLOWLIST = TOOL_NAME;
    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);
    expect(res.ok).toBe(true);
    expect(res.autoConfirmed).toBeUndefined();
    expect(res.executionResult).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("proposed");
  });
});

describe("D2 wire — master ON + allowlisted + guardrail PASS ⇒ auto-executed via the SAME confirm path", () => {
  beforeEach(() => {
    process.env.AI_AUTONOMY_ENABLED = "true";
    process.env.AI_AUTONOMY_ALLOWLIST = TOOL_NAME;
  });

  it("executes via confirmAction (DB args, idempotent), audit marked autoConfirmed", async () => {
    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);
    expect(res.ok).toBe(true);
    expect(res.autoConfirmed).toBe(true);
    expect(res.executionResult?.status).toBe("executed");

    // execute() ran exactly once, with args FROM THE DB ROW (widgetId: 5).
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({ widgetId: 5 }, expect.objectContaining({ user: ADMIN }));

    const actionId = res.pendingAction!.actionId;
    expect(pendingStore.get(actionId)!.status).toBe("executed");

    // Idempotency: a human clicking confirm AFTER the autonomous execution returns the
    // cached result — execute() is NOT called a second time.
    const manual = await confirmAction(actionId, res.pendingAction!.token, ADMIN, "vi");
    expect(manual.status).toBe("executed");
    expect(executeSpy).toHaveBeenCalledTimes(1);

    // Audit: the EXECUTED row is marked autoConfirmed + the policy reason, confirming
    // principal recorded as the autonomy tier (not a human user).
    const executedCall = logCrudOperation.mock.calls.find(
      ([, entry]: [unknown, any]) => entry.action === "ai_action_executed",
    );
    expect(executedCall).toBeTruthy();
    expect(executedCall![1].details.metadata).toEqual(
      expect.objectContaining({ autoConfirmed: true, autonomyAttempt: true, autonomyReason: "OK", confirmedBy: "autonomy" }),
    );

    // D2 review Fix 3 — the autonomy DECISION is now audited as a SEPARATE lightweight
    // follow-up entry (AI_AUTONOMY_DECISION), not folded into the PROPOSED row's
    // metadata (that would have entangled the PROPOSED row with the confirm outcome).
    // Traceable even when it succeeds, since the master flag is ON.
    const decisionCall = logCrudOperation.mock.calls.find(
      ([, entry]: [unknown, any]) => entry.action === "ai_autonomy_decision",
    );
    expect(decisionCall).toBeTruthy();
    expect(decisionCall![1].details.metadata.autonomy).toEqual({ allowed: true, reason: "OK", executed: true });

    // The PROPOSED row itself carries NO autonomy metadata (it was written BEFORE the
    // decision was made — see the order test below).
    const proposedCall = logCrudOperation.mock.calls.find(
      ([, entry]: [unknown, any]) => entry.action === "ai_action_proposed",
    );
    expect(proposedCall![1].details.metadata.autonomy).toBeUndefined();
  });

  it("audit ORDER: PROPOSED is emitted before CONFIRMED/EXECUTED for an auto-confirmed action (D2 review Fix 3)", async () => {
    await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);

    const order = logCrudOperation.mock.calls.map(([, entry]: [unknown, any]) => entry.action);
    const proposedIdx = order.indexOf("ai_action_proposed");
    const confirmedIdx = order.indexOf("ai_action_confirmed");
    const executedIdx = order.indexOf("ai_action_executed");
    const decisionIdx = order.indexOf("ai_autonomy_decision");

    expect(proposedIdx).toBeGreaterThanOrEqual(0);
    expect(confirmedIdx).toBeGreaterThan(proposedIdx);
    expect(executedIdx).toBeGreaterThan(confirmedIdx);
    // The lightweight decision follow-up comes last (after the real confirm/execute
    // audit trail it's summarizing), never before or between PROPOSED/CONFIRMED/EXECUTED.
    expect(decisionIdx).toBeGreaterThan(executedIdx);
  });

  it("RBAC re-check failure at confirm-time is STILL enforced — NOT auto-executed", async () => {
    // propose-time RBAC gate passes once; every subsequent check (confirm-time
    // re-check) fails — simulates the role being revoked between propose and confirm.
    checkPermission.mockResolvedValueOnce(true).mockResolvedValue(false);

    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);
    expect(res.ok).toBe(true); // propose itself still succeeds (first RBAC check passed)
    expect(res.autoConfirmed).toBe(false);
    expect(res.executionResult?.status).toBe("denied");
    expect(executeSpy).not.toHaveBeenCalled();
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("denied");
  });

  it("D2 review Fix 2 — an unexpected THROW during the auto-confirm attempt (not just a denial) never turns proposeAction into an error; the normal `proposed` result is still returned", async () => {
    // propose-time RBAC gate passes; the confirm-time RBAC re-check (inside
    // confirmAction, invoked by the auto-confirm attempt) THROWS instead of resolving
    // false — an unexpected crash, not a normal deny.
    checkPermission.mockResolvedValueOnce(true).mockImplementationOnce(() => {
      throw new Error("boom — unexpected RBAC re-check crash");
    });

    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);

    // proposeAction() resolved normally (did not reject) with the standard success
    // shape — the row inserted before the autonomy attempt (Fix 3's reordering) is
    // still what's returned.
    expect(res.ok).toBe(true);
    expect(res.pendingAction).toBeTruthy();
    expect(res.pendingAction!.tool).toBe(TOOL_NAME);
    // The autonomy attempt blew up mid-flight — no successful auto-confirm to report.
    expect(res.autoConfirmed).toBeFalsy();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("guardrail FAIL (value outside band) ⇒ NOT auto-confirmed, action left `proposed` (HITL fallback)", async () => {
    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), outOfBandContract);
    expect(res.ok).toBe(true);
    expect(res.autoConfirmed).toBeUndefined();
    expect(res.executionResult).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
    // Row is untouched by confirmAction entirely — still `proposed`, not `denied`.
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("proposed");
  });

  it("no advice contract on the proposal ⇒ NOT auto-confirmed (autonomy requires an attached guardrail contract)", async () => {
    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx()); // no contract arg
    expect(res.autoConfirmed).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("proposed");
  });

  it("kill-switch tripped ⇒ NOT auto-confirmed even though master+allowlist+guardrail are all green", async () => {
    const { tripKillSwitch } = await import("./ai/autonomyPolicy");
    await tripKillSwitch("test", 1);
    const res = await proposeAction(tool(), { widgetId: 5 }, proposeCtx(), inBandContract);
    expect(res.autoConfirmed).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("proposed");
  });
});

describe("D2 wire — ineligible (hard-coded denylist) type is never auto-confirmed even if misconfigured into the allowlist", () => {
  it("propose on a denylisted tool name never auto-executes", async () => {
    // Register a second tool that reuses a REAL denylisted type name to prove the
    // denylist is keyed on tool.name, independent of what the tool actually does.
    const denylistedTool: Tool<{ widgetId: number }, { ok: boolean }> = {
      name: "set_machine_param", // real ineligible type (server/services/aiLocalTools/writeHandlers/machineControl.ts)
      description: "shadow registration for the D2 denylist wire test",
      parameters: z.object({ widgetId: z.number() }).strict(),
      triggers: [],
      kind: "write",
      requiredPermission: { module: "test_autonomy", action: "canEdit" },
      summarize: () => "shadow",
      preview: async (p) => ({
        entityType: "test_widget",
        entityId: p.widgetId,
        changes: [{ field: "widgetId", oldValue: null, newValue: p.widgetId, displayName: "Widget" }],
        warnings: [],
        humanSummary: "shadow",
      }),
      execute: executeSpy,
    };
    registerTool(denylistedTool);

    process.env.AI_AUTONOMY_ENABLED = "true";
    process.env.AI_AUTONOMY_ALLOWLIST = "set_machine_param"; // operator mistake

    const res = await proposeAction(denylistedTool, { widgetId: 5 }, proposeCtx(), inBandContract);
    expect(res.autoConfirmed).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(pendingStore.get(res.pendingAction!.actionId)!.status).toBe("proposed");
  });
});
