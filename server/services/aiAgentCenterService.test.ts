/**
 * aiAgentCenterService — roster read-model + status normalizer (doc69 Giai đoạn 4 /
 * Wave E2, task E2-1).
 *
 * Every leaf source (orchestrator sessions, specialist agents, GGUF availability,
 * auto-proposer/advisor flags, the 5 schedulers, and the DB) is MOCKED — this test
 * proves the service's own aggregation/normalization/fail-safe logic, not the
 * correctness of those already-tested sources. `../db/connection`'s `getDb` mock
 * also transitively backs `server/_core/accessControl.ts`'s tenantScope lookup used
 * by the router RBAC tests below (same resolved file), so no real DB is ever hit.
 *
 * `drizzle-orm` is mocked with pure passthrough AST-wrapper stubs (never dereferences
 * its column arguments) because the `../../drizzle/schema` mock below only tags each
 * table with a `__table` marker — real drizzle-orm `eq()`/`gte()`/etc. would throw
 * trying to read `.name`/`.table` off a column that doesn't exist on that marker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Static import is safe here even though aiAgentCenterService transitively imports
// every mocked module below: Vitest hoists ALL `vi.mock(...)` calls in this file to
// the very top (above every import, static or not) — see the reference pattern in
// server/routers/aiAgentRouter.opsAndKillSwitch.test.ts.
import { normalizeAgentStatus, getRoster, getCommandCenterReadModel } from "./aiAgentCenterService";

// ── LICENSE_BYPASS so the router's moduleGate("MOD_AI") never touches the DB/license
//    service — set BEFORE any dynamic import of server/_core/env.ts. ──
process.env.LICENSE_BYPASS = "true";

type Row = Record<string, any>;

// ─── drizzle-orm — pure passthrough (never inspects its column args) ───────────────
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ __op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ __op: "gte", col, val }),
  inArray: (col: unknown, val: unknown) => ({ __op: "inArray", col, val }),
  desc: (col: unknown) => ({ __op: "desc", col }),
}));

// ─── drizzle/schema — just enough to key a fake query builder by table name ────────
vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: { __table: "aiPendingActions" },
  aiSpecialistSessions: { __table: "aiSpecialistSessions" },
  aiSpecialistSessionSteps: { __table: "aiSpecialistSessionSteps" },
}));

// ─── getDb — default null (DB unavailable ⇒ honest idle); tests override per-case ──
const getDb = vi.fn(async (): Promise<any> => null);
vi.mock("../db/connection", () => ({
  getDb: (...a: unknown[]) => getDb(...a),
}));

/**
 * Per-table FIFO fake query builder. `.from(table)` dequeues the NEXT configured
 * batch for that table (order matters when a source queries the same table more
 * than once, e.g. specialist step-count THEN token-sum). `.where/.orderBy/.limit`
 * are no-ops (drizzle-orm itself is mocked to pure wrappers above, so there is no
 * real predicate to evaluate) — tests pre-filter/pre-sort each fixture batch.
 */
function makeQueueDb(queues: Partial<Record<string, Row[][]>>) {
  const remaining: Record<string, Row[][]> = {};
  for (const [k, v] of Object.entries(queues)) remaining[k] = [...(v ?? [])];

  function chainFor(tableName: string) {
    const q = remaining[tableName];
    const rows = q && q.length > 0 ? q.shift()! : [];
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }

  return {
    select: (_cols?: unknown) => ({
      from: (table: any) => chainFor(table.__table),
    }),
  };
}

// ─── aiAgentOrchestrator.listSessionsForOps ─────────────────────────────────────────
const listSessionsForOps = vi.fn(async (): Promise<any[]> => []);
vi.mock("./aiAgentOrchestrator", () => ({
  listSessionsForOps: (...a: unknown[]) => listSessionsForOps(...a),
}));

// ─── aiSpecialistAgentService.listSpecialistAgents (pure static registry) ──────────
const SPECIALIST_FIXTURE = [
  { id: "data-analyst", name: "Data Insight Agent", role: "r", focus: [], outputContract: [] },
  { id: "backend-engineer", name: "Backend Refactor Agent", role: "r", focus: [], outputContract: [] },
  { id: "frontend-engineer", name: "Frontend UX Agent", role: "r", focus: [], outputContract: [] },
  { id: "qa-optimizer", name: "QA Strategist Agent", role: "r", focus: [], outputContract: [] },
];
const listSpecialistAgents = vi.fn(() => SPECIALIST_FIXTURE);
vi.mock("./aiSpecialistAgentService", () => ({
  listSpecialistAgents: (...a: unknown[]) => listSpecialistAgents(...a),
}));

// ─── aiGgufEngine.isGgufAvailable ───────────────────────────────────────────────────
const isGgufAvailable = vi.fn(async () => true);
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));

// ─── aiAutoProposer.isAutoProposeEnabled ────────────────────────────────────────────
const isAutoProposeEnabled = vi.fn(() => false);
vi.mock("./aiAutoProposer", () => ({
  isAutoProposeEnabled: (...a: unknown[]) => isAutoProposeEnabled(...a),
}));

// ─── aiOrchestrationAdvisor.advisorEnabled ──────────────────────────────────────────
const advisorEnabled = vi.fn(() => false);
vi.mock("./orchestration/aiOrchestrationAdvisor", () => ({
  advisorEnabled: (...a: unknown[]) => advisorEnabled(...a),
}));

// ─── the 5 schedulers ────────────────────────────────────────────────────────────────
const getBatchRcaStatus = vi.fn(() => ({ enabled: false, lastRunAt: null as Date | null }));
vi.mock("./aiBatchRcaScheduler", () => ({ getBatchRcaStatus: (...a: unknown[]) => getBatchRcaStatus(...a) }));

const getSelfLearningStatus = vi.fn(() => ({ enabled: false, lastRunAt: null as Date | null }));
vi.mock("./aiSelfLearningScheduler", () => ({ getSelfLearningStatus: (...a: unknown[]) => getSelfLearningStatus(...a) }));

const getThresholdTuneSchedulerStatus = vi.fn(() => ({ enabled: false, lastRunAt: null as Date | null }));
vi.mock("./aiThresholdTuneScheduler", () => ({
  getThresholdTuneSchedulerStatus: (...a: unknown[]) => getThresholdTuneSchedulerStatus(...a),
}));

const getAnomalyBankSchedulerStatus = vi.fn(() => ({ enabled: false, lastRunAt: null as Date | null }));
vi.mock("./aiAnomalyBankScheduler", () => ({
  getAnomalyBankSchedulerStatus: (...a: unknown[]) => getAnomalyBankSchedulerStatus(...a),
}));

const getAgentHousekeepingStatus = vi.fn(() => ({ enabled: false, lastRunAt: null as Date | null }));
vi.mock("./aiAgentHousekeepingScheduler", () => ({
  getAgentHousekeepingStatus: (...a: unknown[]) => getAgentHousekeepingStatus(...a),
}));

const ALL_ROSTER_IDS = [
  "operations-agent",
  "specialist-data-analyst",
  "specialist-backend-engineer",
  "specialist-frontend-engineer",
  "specialist-qa-optimizer",
  "rca-watcher",
  "proactive-agent",
  "orchestration-advisor",
  "copilot-chat",
  "scheduled-batch-rca",
  "scheduled-self-learning",
  "scheduled-anomaly-bank",
  "scheduled-threshold-tune",
  "scheduled-agent-housekeeping",
];

beforeEach(() => {
  vi.clearAllMocks();
  getDb.mockResolvedValue(null);
  listSessionsForOps.mockResolvedValue([]);
  listSpecialistAgents.mockReturnValue(SPECIALIST_FIXTURE);
  isGgufAvailable.mockResolvedValue(true);
  isAutoProposeEnabled.mockReturnValue(false);
  advisorEnabled.mockReturnValue(false);
  getBatchRcaStatus.mockReturnValue({ enabled: false, lastRunAt: null });
  getSelfLearningStatus.mockReturnValue({ enabled: false, lastRunAt: null });
  getThresholdTuneSchedulerStatus.mockReturnValue({ enabled: false, lastRunAt: null });
  getAnomalyBankSchedulerStatus.mockReturnValue({ enabled: false, lastRunAt: null });
  getAgentHousekeepingStatus.mockReturnValue({ enabled: false, lastRunAt: null });
  delete process.env.AI_AGENTIC_ENABLED;
  delete process.env.AI_ORCHESTRATION_ENABLED;
});

afterEach(() => {
  delete process.env.AI_AGENTIC_ENABLED;
  delete process.env.AI_ORCHESTRATION_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe("normalizeAgentStatus — pure, table-driven", () => {
  it.each([
    ["disabled beats everything except error", { enabled: false, hasActiveWork: true, awaitingApproval: true, blocked: true }, "disabled"],
    ["error beats disabled", { enabled: false, hasError: true }, "error"],
    ["awaiting_approval beats blocked+working", { enabled: true, awaitingApproval: true, blocked: true, hasActiveWork: true }, "awaiting_approval"],
    ["blocked beats working", { enabled: true, blocked: true, hasActiveWork: true }, "blocked"],
    ["working when active + nothing higher-priority", { enabled: true, hasActiveWork: true }, "working"],
    ["idle when enabled and nothing else set", { enabled: true }, "idle"],
    ["idle for a bare enabled:false with no other flags → still disabled (not idle)", { enabled: false }, "disabled"],
  ])("%s", (_label, raw, expected) => {
    expect(normalizeAgentStatus(raw as any)).toBe(expected);
  });

  it("unknown/garbage input (null/undefined) defaults to idle — documented safe default", () => {
    expect(normalizeAgentStatus(null)).toBe("idle");
    expect(normalizeAgentStatus(undefined)).toBe("idle");
  });

  it("is a pure function — same input always yields the same output, no side effects", () => {
    const raw = { enabled: true, hasActiveWork: true };
    const a = normalizeAgentStatus(raw);
    const b = normalizeAgentStatus(raw);
    expect(a).toBe(b);
    expect(a).toBe("working");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe("getRoster", () => {
  it("an active orchestrator session ⇒ Operations Agent is working with currentTask+progress", async () => {
    process.env.AI_AGENTIC_ENABLED = "1";
    listSessionsForOps.mockResolvedValue([
      {
        id: "s1",
        userId: 1,
        username: "eng1",
        userRole: "engineer",
        goal: "Kiểm tra máy #5",
        status: "running",
        stepIndex: 1,
        stepTotal: 3,
        writeCount: 0,
        updatedAt: new Date("2026-07-25T10:00:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
    ]);

    const roster = await getRoster();
    const opsAgent = roster.find((r) => r.id === "operations-agent");

    expect(opsAgent).toMatchObject({
      status: "working",
      currentTask: "Kiểm tra máy #5",
      progress: { done: 1, total: 3 },
    });
  });

  it("an orchestrator session with status 'paused' ⇒ Operations Agent is blocked (not idle), with currentTask populated", async () => {
    process.env.AI_AGENTIC_ENABLED = "1";
    listSessionsForOps.mockResolvedValue([
      {
        id: "s-paused",
        userId: 1,
        username: "eng1",
        userRole: "engineer",
        goal: "Cập nhật ngưỡng NG máy #7",
        status: "paused", // drizzle/schema/enums.ts ~:181 documents this as "blocked by a failed/denied write"
        stepIndex: 2,
        stepTotal: 4,
        writeCount: 1,
        updatedAt: new Date("2026-07-25T10:00:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
    ]);

    const roster = await getRoster();
    const opsAgent = roster.find((r) => r.id === "operations-agent");

    expect(opsAgent).toMatchObject({
      status: "blocked",
      currentTask: "Cập nhật ngưỡng NG máy #7",
      progress: { done: 2, total: 4 },
    });
  });

  it("two concurrent ops sessions (working + awaiting_approval) ⇒ Operations Agent reports awaiting_approval, not working — with THAT session's task", async () => {
    process.env.AI_AGENTIC_ENABLED = "1";
    listSessionsForOps.mockResolvedValue([
      {
        id: "s-working",
        userId: 1,
        username: "eng1",
        userRole: "engineer",
        goal: "Đang chạy: quét lỗi hàng loạt",
        status: "running",
        stepIndex: 1,
        stepTotal: 5,
        writeCount: 0,
        updatedAt: new Date("2026-07-25T09:00:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
      {
        id: "s-awaiting",
        userId: 2,
        username: "eng2",
        userRole: "engineer",
        goal: "Chờ duyệt: đổi công thức máy #3",
        status: "awaiting_approval",
        stepIndex: 1,
        stepTotal: 2,
        writeCount: 0,
        updatedAt: new Date("2026-07-25T09:30:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
    ]);

    const roster = await getRoster();
    const opsAgent = roster.find((r) => r.id === "operations-agent");

    expect(opsAgent).toMatchObject({
      status: "awaiting_approval",
      currentTask: "Chờ duyệt: đổi công thức máy #3",
      progress: { done: 1, total: 2 },
    });
  });

  it("two concurrent ops sessions (blocked + working) ⇒ Operations Agent reports blocked, not working — with THAT session's task", async () => {
    process.env.AI_AGENTIC_ENABLED = "1";
    listSessionsForOps.mockResolvedValue([
      {
        id: "s-working-2",
        userId: 1,
        username: "eng1",
        userRole: "engineer",
        goal: "Đang chạy: kiểm tra tồn kho",
        status: "running",
        stepIndex: 2,
        stepTotal: 6,
        writeCount: 0,
        updatedAt: new Date("2026-07-25T09:00:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
      {
        id: "s-blocked",
        userId: 3,
        username: "eng3",
        userRole: "engineer",
        goal: "Bị chặn: ghi vượt giới hạn máy #9",
        status: "paused",
        stepIndex: 3,
        stepTotal: 5,
        writeCount: 3,
        updatedAt: new Date("2026-07-25T09:15:00Z"),
        expiresAt: new Date("2026-07-25T11:00:00Z"),
      },
    ]);

    const roster = await getRoster();
    const opsAgent = roster.find((r) => r.id === "operations-agent");

    expect(opsAgent).toMatchObject({
      status: "blocked",
      currentTask: "Bị chặn: ghi vượt giới hạn máy #9",
      progress: { done: 3, total: 5 },
    });
  });

  it("a flag-off scheduled agent ⇒ disabled; flag-on ⇒ idle (not fabricated 'working')", async () => {
    getBatchRcaStatus.mockReturnValue({ enabled: false, lastRunAt: null });
    getSelfLearningStatus.mockReturnValue({ enabled: true, lastRunAt: new Date("2026-07-25T02:00:00Z") });

    const roster = await getRoster();

    expect(roster.find((r) => r.id === "scheduled-batch-rca")?.status).toBe("disabled");
    const selfLearning = roster.find((r) => r.id === "scheduled-self-learning");
    expect(selfLearning?.status).toBe("idle");
    expect(selfLearning?.currentTask).toBeNull(); // never fabricates a task even when a run happened before
  });

  it("a pending awaiting-approval action ⇒ Proactive Agent is awaiting_approval (real summary, not fabricated)", async () => {
    isAutoProposeEnabled.mockReturnValue(true);
    getDb.mockResolvedValue(
      makeQueueDb({
        aiPendingActions: [[{ summary: "Đề xuất siết ngưỡng NG máy #5", createdAt: new Date("2026-07-25T09:00:00Z") }]],
        aiSpecialistSessions: [[]],
        aiSpecialistSessionSteps: [[]],
      }),
    );

    const roster = await getRoster();
    const proactive = roster.find((r) => r.id === "proactive-agent");

    expect(proactive?.status).toBe("awaiting_approval");
    expect(proactive?.currentTask).toBe("Đề xuất siết ngưỡng NG máy #5");
  });

  it("Proactive Agent stays disabled (not awaiting_approval) when the flag is off, even if proposals exist", async () => {
    isAutoProposeEnabled.mockReturnValue(false);
    // Even with a real unexpired proposal sitting in the DB, the flag gate must win —
    // buildProactiveAgentEntry returns early and never even looks at ai_pending_actions.
    getDb.mockResolvedValue(
      makeQueueDb({
        aiPendingActions: [[{ summary: "Should be ignored", createdAt: new Date() }]],
      }),
    );
    const roster = await getRoster();
    expect(roster.find((r) => r.id === "proactive-agent")?.status).toBe("disabled");
    expect(roster.find((r) => r.id === "proactive-agent")?.currentTask).toBeNull();
  });

  it("a currently-running specialist session ⇒ that specialist is working with real progress+tokens", async () => {
    getDb.mockResolvedValue(
      makeQueueDb({
        aiSpecialistSessions: [[{ id: 42, objective: "Audit module AI Chat", requestedAgents: ["data-analyst"], updatedAt: new Date("2026-07-25T08:00:00Z") }]],
        aiSpecialistSessionSteps: [
          [{ sessionId: 42 }], // step-count query (runningSessions.length > 0)
          [{ agentId: "data-analyst", tokensGenerated: 340 }], // trailing-24h token-sum query
        ],
      }),
    );

    const roster = await getRoster();
    const dataInsight = roster.find((r) => r.id === "specialist-data-analyst");

    expect(dataInsight?.status).toBe("working");
    expect(dataInsight?.currentTask).toBe("Audit module AI Chat");
    expect(dataInsight?.progress).toEqual({ done: 1, total: 1 });
    expect(dataInsight?.tokensToday).toBe(340);

    // An UNRELATED specialist stays honestly idle, tokensToday 0 (attributable, real zero).
    const qa = roster.find((r) => r.id === "specialist-qa-optimizer");
    expect(qa?.status).toBe("idle");
    expect(qa?.currentTask).toBeNull();
    expect(qa?.tokensToday).toBe(0);
  });

  it("an empty system ⇒ all 14 roster entries present with honest idle/disabled — no fabricated tasks/tokens", async () => {
    const roster = await getRoster();

    expect(roster.map((r) => r.id).sort()).toEqual([...ALL_ROSTER_IDS].sort());
    for (const entry of roster) {
      expect(["idle", "disabled"]).toContain(entry.status);
      expect(entry.currentTask).toBeNull();
      expect(entry.tokensToday).toBeNull();
    }
  });

  it("a THROWN source degrades ONLY that persona to error — the rest of the roster still returns", async () => {
    listSessionsForOps.mockRejectedValue(new Error("db exploded"));

    const roster = await getRoster();

    expect(roster).toHaveLength(ALL_ROSTER_IDS.length);
    expect(roster.find((r) => r.id === "operations-agent")?.status).toBe("error");
    // Every other persona is unaffected (still honestly idle/disabled).
    for (const entry of roster) {
      if (entry.id === "operations-agent") continue;
      expect(["idle", "disabled"]).toContain(entry.status);
    }
  });

  it("a THROWN specialist-agents source degrades all 4 specialists to error, not the rest of the roster", async () => {
    getDb.mockRejectedValue(new Error("connection reset"));

    const roster = await getRoster();

    for (const id of ["specialist-data-analyst", "specialist-backend-engineer", "specialist-frontend-engineer", "specialist-qa-optimizer"]) {
      expect(roster.find((r) => r.id === id)?.status).toBe("error");
    }
    expect(roster.find((r) => r.id === "operations-agent")?.status).not.toBe("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe("getCommandCenterReadModel", () => {
  it("assembles roster+sessions+taskFeed; taskFeed is newest-first and capped", async () => {
    listSessionsForOps.mockResolvedValue([
      { id: "s-old", userId: 1, username: "u", userRole: "engineer", goal: "old", status: "done", stepIndex: 3, stepTotal: 3, writeCount: 0, updatedAt: new Date("2026-07-25T08:00:00Z"), expiresAt: new Date() },
      { id: "s-mid", userId: 1, username: "u", userRole: "engineer", goal: "mid", status: "running", stepIndex: 1, stepTotal: 2, writeCount: 0, updatedAt: new Date("2026-07-25T09:00:00Z"), expiresAt: new Date() },
      { id: "s-new", userId: 1, username: "u", userRole: "engineer", goal: "new", status: "awaiting_confirm", stepIndex: 1, stepTotal: 2, writeCount: 1, updatedAt: new Date("2026-07-25T10:00:00Z"), expiresAt: new Date() },
    ]);

    const model = await getCommandCenterReadModel({ limit: 2 });

    expect(model.sessions).toHaveLength(3);
    expect(model.roster.length).toBeGreaterThan(0);
    expect(model.taskFeed).toHaveLength(2); // capped
    expect(model.taskFeed[0].id).toBe("orchestrator:s-new"); // newest first
    expect(model.taskFeed[1].id).toBe("orchestrator:s-mid");
    expect(typeof model.generatedAt).toBe("string");
  });

  it("honest-empty shape when nothing is running — roster still populated, sessions/taskFeed empty arrays", async () => {
    const model = await getCommandCenterReadModel();

    expect(model.sessions).toEqual([]);
    expect(model.taskFeed).toEqual([]);
    expect(model.roster.length).toBe(ALL_ROSTER_IDS.length);
  });

  it("a thrown sessions source degrades sessions/taskFeed to empty but still returns the roster", async () => {
    listSessionsForOps.mockRejectedValue(new Error("boom"));

    const model = await getCommandCenterReadModel();

    expect(model.sessions).toEqual([]);
    expect(model.taskFeed).toEqual([]);
    expect(model.roster.length).toBe(ALL_ROSTER_IDS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe("aiAgentCenterRouter — ops-scoped RBAC", () => {
  function ctx(user: { id: number; role: string; name?: string }) {
    return { user, req: {} } as any;
  }

  it("admin can read the roster", async () => {
    const { aiAgentCenterRouter } = await import("../routers/aiAgentCenterRouter");
    const admin = aiAgentCenterRouter.createCaller(ctx({ id: 1, role: "admin", name: "Admin" }));
    const res = await admin.getRoster();
    expect(Array.isArray(res.roster)).toBe(true);
    expect(res.roster.length).toBe(ALL_ROSTER_IDS.length);
  });

  it("engineer can read the full read-model", async () => {
    const { aiAgentCenterRouter } = await import("../routers/aiAgentCenterRouter");
    const eng = aiAgentCenterRouter.createCaller(ctx({ id: 2, role: "engineer", name: "Eng" }));
    const res = await eng.getReadModel(undefined);
    expect(Array.isArray(res.roster)).toBe(true);
    expect(Array.isArray(res.sessions)).toBe(true);
    expect(Array.isArray(res.taskFeed)).toBe(true);
  });

  it("a non-privileged user (operator) is rejected — scoped per RBAC", async () => {
    const { aiAgentCenterRouter } = await import("../routers/aiAgentCenterRouter");
    const op = aiAgentCenterRouter.createCaller(ctx({ id: 3, role: "operator", name: "Op" }));
    await expect(op.getRoster()).rejects.toThrow();
    await expect(op.getReadModel(undefined)).rejects.toThrow();
  });

  it("admin/engineer can read the savings summary; operator/anon are rejected (same guard, doc69 E2-2)", async () => {
    const { aiAgentCenterRouter } = await import("../routers/aiAgentCenterRouter");
    const admin = aiAgentCenterRouter.createCaller(ctx({ id: 1, role: "admin", name: "Admin" }));
    const eng = aiAgentCenterRouter.createCaller(ctx({ id: 2, role: "engineer", name: "Eng" }));
    const op = aiAgentCenterRouter.createCaller(ctx({ id: 3, role: "operator", name: "Op" }));
    const anon = aiAgentCenterRouter.createCaller({ user: null, req: {} } as any);

    // getDb mocks to null (default in this file) ⇒ honest-empty shape, no real DB touched.
    const adminRes = await admin.getSavingsSummary();
    expect(adminRes.dataAvailable).toBe(false);
    expect(adminRes.byModel).toEqual([]);
    const engRes = await eng.getSavingsSummary();
    expect(engRes.dataAvailable).toBe(false);

    await expect(op.getSavingsSummary()).rejects.toThrow();
    await expect(anon.getSavingsSummary()).rejects.toThrow();
  });

  it("an unauthenticated caller is rejected", async () => {
    const { aiAgentCenterRouter } = await import("../routers/aiAgentCenterRouter");
    const anon = aiAgentCenterRouter.createCaller({ user: null, req: {} } as any);
    await expect(anon.getRoster()).rejects.toThrow();
  });
});
