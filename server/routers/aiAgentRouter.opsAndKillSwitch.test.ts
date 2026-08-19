/**
 * aiAgentRouter — Agent Ops session list + autonomy kill-switch (doc 69 Giai đoạn
 * 4/Wave 3, D4).
 *
 * aiAgentOrchestrator/aiPlaybookEngine are mocked WHOLESALE — their heavy
 * transitive dependency tree (planner, the full tool registry + every write
 * handler) is irrelevant to these 2 new surfaces, so this stays a fast, focused
 * unit test. `listSessionsForOps` is mocked to prove the router wires RBAC + the
 * query correctly, not to re-test the DB read itself (that's this service
 * function's own concern, not the router's).
 *
 * autonomyPolicy's tripKillSwitch/untripKillSwitch/isKillSwitchTripped run FOR
 * REAL against a fake in-memory `ai_system_config` (mirrors
 * server/services/ai/autonomyPolicy.test.ts's own fake-db) — trip/untrip really
 * flip the durable flag, not just a mocked call count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

type Row = Record<string, any>;
const configStore = new Map<string, Row>();

function makeFakeDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of configStore.values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Row) => {
        configStore.set(vals.key, { ...vals });
        const result: any = Promise.resolve(undefined);
        result.onConflictDoUpdate = async ({ set }: { set: Row }) => {
          const existing = configStore.get(vals.key) ?? { ...vals };
          Object.assign(existing, set);
          configStore.set(vals.key, existing);
        };
        return result;
      },
    }),
  };
}

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../drizzle/schema", () => ({
  aiSystemConfig: {
    key: { __name: "key" },
    value: { __name: "value" },
    description: { __name: "description" },
    updatedBy: { __name: "updatedBy" },
    updatedAt: { __name: "updatedAt" },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
}));

// Heavy orchestrator/playbook surfaces are irrelevant here — mock them wholesale.
const OPS_ROW = {
  id: "s1",
  userId: 1,
  username: "admin",
  userRole: "admin",
  goal: "Kiểm tra máy #5",
  status: "running",
  stepIndex: 1,
  stepTotal: 3,
  writeCount: 0,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-01-01T01:00:00Z"),
};
const listSessionsForOps = vi.fn(async () => [OPS_ROW]);
vi.mock("../services/aiAgentOrchestrator", () => ({
  startSession: vi.fn(),
  approvePlan: vi.fn(),
  confirmStep: vi.fn(),
  cancelSession: vi.fn(),
  getSession: vi.fn(),
  canUseAgentic: vi.fn(() => false),
  listSessionsForOps: (...a: unknown[]) => listSessionsForOps(...a),
}));
vi.mock("../services/aiPlaybookEngine", () => ({
  startPlaybook: vi.fn(),
  listPlaybooks: vi.fn(),
}));

// Lightweight auditTrailService mock (mirrors aiCopilotActions.test.ts's own
// approach) — avoids pulling in the full server/db barrel via the real module.
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
vi.mock("../services/auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_AUTONOMY_KILL_SWITCH: "ai_autonomy_kill_switch" },
  ENTITY_TYPES: { AI_AUTONOMY: "ai_autonomy" },
  createAuditContext: (ctx: any) => ({ userId: ctx.user?.id, userName: ctx.user?.name, source: "trpc" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
}));

const ADMIN_2FA = { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true };
const ADMIN_NO_2FA = { id: 2, role: "admin", name: "Admin2", twoFactorEnabled: false };
const ENGINEER = { id: 3, role: "engineer", name: "Eng", twoFactorEnabled: true };
const OPERATOR = { id: 4, role: "operator", name: "Op", twoFactorEnabled: false };

function ctx(user: { id: number; role: string; name?: string; twoFactorEnabled?: boolean }) {
  return { user, req: {} } as any;
}

function findAuditCall(op: string) {
  return logCrudOperation.mock.calls.find((c: any[]) => c[1]?.details?.operation === op);
}

beforeEach(() => {
  configStore.clear();
  vi.clearAllMocks();
  listSessionsForOps.mockResolvedValue([OPS_ROW]);
});

describe("aiAgentRouter — autonomy kill-switch (D4)", () => {
  it("getKillSwitchStatus is readable by any authenticated user; defaults to not tripped", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const caller = aiAgentRouter.createCaller(ctx(OPERATOR));
    expect(await caller.getKillSwitchStatus()).toEqual({ tripped: false });
  });

  it("admin+2FA can trip the REAL kill-switch (isKillSwitchTripped() becomes true) and it is audited", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { isKillSwitchTripped } = await import("../services/ai/autonomyPolicy");
    const admin = aiAgentRouter.createCaller(ctx(ADMIN_2FA));

    const res = await admin.tripKillSwitch({ reason: "operator emergency stop" });
    expect(res).toEqual({ ok: true, tripped: true });
    expect(await isKillSwitchTripped()).toBe(true);

    const auditCall = findAuditCall("AI_AUTONOMY_KILL_SWITCH_TRIPPED");
    expect(auditCall).toBeTruthy();
    expect(auditCall![1].details.metadata.reason).toBe("operator emergency stop");
  });

  it("admin+2FA can untrip the REAL kill-switch (isKillSwitchTripped() becomes false) and it is audited", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { isKillSwitchTripped, tripKillSwitch: realTrip } = await import("../services/ai/autonomyPolicy");
    await realTrip("pre-armed for test", 999);
    expect(await isKillSwitchTripped()).toBe(true);

    const admin = aiAgentRouter.createCaller(ctx(ADMIN_2FA));
    const res = await admin.untripKillSwitch();
    expect(res).toEqual({ ok: true, tripped: false });
    expect(await isKillSwitchTripped()).toBe(false);
    expect(findAuditCall("AI_AUTONOMY_KILL_SWITCH_UNTRIPPED")).toBeTruthy();
  });

  it("non-admin (engineer) is FORBIDDEN from tripping the kill-switch", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { isKillSwitchTripped } = await import("../services/ai/autonomyPolicy");
    const eng = aiAgentRouter.createCaller(ctx(ENGINEER));

    await expect(eng.tripKillSwitch({ reason: "should not work" })).rejects.toThrow();
    expect(await isKillSwitchTripped()).toBe(false); // never actually tripped
  });

  it("operator is FORBIDDEN from tripping the kill-switch", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.tripKillSwitch({ reason: "should not work" })).rejects.toThrow();
  });

  it("admin WITHOUT 2FA is FORBIDDEN (require2FA) — kill-switch stays untouched", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { isKillSwitchTripped } = await import("../services/ai/autonomyPolicy");
    const admin = aiAgentRouter.createCaller(ctx(ADMIN_NO_2FA));

    await expect(admin.tripKillSwitch({ reason: "no 2fa" })).rejects.toThrow();
    expect(await isKillSwitchTripped()).toBe(false);
  });
});

describe("aiAgentRouter — listAgentSessionsForOps (D4)", () => {
  it("admin sees the ops-scoped (cross-user) session list", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const admin = aiAgentRouter.createCaller(ctx(ADMIN_2FA));
    const res = await admin.listAgentSessionsForOps(undefined);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0].id).toBe("s1");
    expect(listSessionsForOps).toHaveBeenCalledWith({ limit: undefined, status: undefined });
  });

  it("engineer also sees the ops-scoped session list", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const eng = aiAgentRouter.createCaller(ctx(ENGINEER));
    const res = await eng.listAgentSessionsForOps({ limit: 10 });
    expect(res.sessions).toHaveLength(1);
  });

  it("a non-privileged user (operator) is rejected — scoped per RBAC", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.listAgentSessionsForOps(undefined)).rejects.toThrow();
    expect(listSessionsForOps).not.toHaveBeenCalled();
  });
});

// ── FIX (E2-4 review, Minor) — sessionId/actionId/token are now bounded
// (`.min(1).max(128)`) so an attacker-chosen unbounded string can't be echoed
// into the ai:agents broadcast payload's sessionId. UUID-length values (the
// real shape produced by randomUUID()) must still pass through untouched.
describe("aiAgentRouter — sessionId/actionId/token are length-bounded (E2-4 review, Minor)", () => {
  const UUID = "11111111-1111-1111-1111-111111111111"; // 36 chars — well within 128
  const OVERSIZED = "x".repeat(200); // > 128

  it("confirmStep rejects an oversized sessionId", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.confirmStep({ sessionId: OVERSIZED, actionId: UUID, token: UUID })).rejects.toThrow();
  });

  it("confirmStep rejects an oversized actionId", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.confirmStep({ sessionId: UUID, actionId: OVERSIZED, token: UUID })).rejects.toThrow();
  });

  it("confirmStep rejects an oversized token", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.confirmStep({ sessionId: UUID, actionId: UUID, token: OVERSIZED })).rejects.toThrow();
  });

  it("confirmStep accepts UUID-shaped (within-bound) values and reaches the service", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { confirmStep } = await import("../services/aiAgentOrchestrator");
    (confirmStep as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: "done", cursor: 1 });
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    const res = await op.confirmStep({ sessionId: UUID, actionId: UUID, token: UUID });
    expect(res).toEqual({ ok: true, status: "done", cursor: 1 });
    expect(confirmStep).toHaveBeenCalledWith(UUID, UUID, UUID, expect.objectContaining({ user: expect.objectContaining({ id: OPERATOR.id }) }));
  });

  it("cancelSession rejects an oversized sessionId", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.cancelSession({ sessionId: OVERSIZED })).rejects.toThrow();
  });

  it("cancelSession accepts a UUID-shaped (within-bound) sessionId and reaches the service", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const { cancelSession } = await import("../services/aiAgentOrchestrator");
    (cancelSession as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: "aborted" });
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    const res = await op.cancelSession({ sessionId: UUID });
    expect(res).toEqual({ ok: true, status: "aborted" });
  });

  it("approvePlan and getSession also reject an oversized sessionId (sibling procedures)", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const op = aiAgentRouter.createCaller(ctx(OPERATOR));
    await expect(op.approvePlan({ sessionId: OVERSIZED })).rejects.toThrow();
    await expect(op.getSession({ sessionId: OVERSIZED })).rejects.toThrow();
  });
});
