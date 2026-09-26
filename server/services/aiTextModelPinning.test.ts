/**
 * doc69 Wave 1 "modelfix" — every service that generates user-facing text must PIN a model.
 *
 * Context: 12 call sites across 10 services called `generateText(opts)` with NO model argument.
 * `getOrLoadModel(undefined)` used to hand back "whatever model loaded first", which in production
 * is the 0.6B RAG embedder → token-repetition garbage rendered as an answer. The engine-level guard
 * (`aiGgufEngine.textModelGuard.test.ts`) is the structural fix; pinning the model at each call site
 * is the second, independent layer of defence — and it also makes the intended tier explicit and
 * reviewable instead of implicit.
 *
 * These tests mock ONLY `./aiGgufEngine` (+ the DB access the services need to reach their AI call)
 * and assert the SECOND argument `generateText` receives. The expected basenames come from the REAL
 * `modelResolver` reading the env set below — deliberately NOT a mocked resolver, so a resolver
 * regression would fail here too.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─── The one engine mock every service under test funnels through ─────────────
const generateTextMock = vi.fn(async (..._a: any[]) => ({
  text: '{"ok":true}',
  tokensGenerated: 3,
  tokensPrompt: 5,
  totalTimeMs: 10,
  tokensPerSecond: 300,
  modelId: "mocked",
}));
vi.mock("./aiGgufEngine", () => ({
  generateText: (...a: any[]) => generateTextMock(...a),
  isGgufAvailable: async () => true,
}));

// ─── DB access mocked down to the single shape these AI paths use ─────────────
let dbRows: any[] = [];
const fakeConn = {
  execute: vi.fn(async () => ({ rows: dbRows })),
};
vi.mock("../db", () => ({
  getDb: async () => fakeConn,
  createNotification: vi.fn(),
  broadcastNotification: vi.fn(),
  getUserNotificationPreferences: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
}));
vi.mock("../db/connection", () => ({
  getDb: async () => fakeConn,
}));

const DEFAULT_FILE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf";
const DEFAULT_BASE = "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL";
const FAST_FILE = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf";
const FAST_BASE = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GGUF_DEFAULT_MODEL = DEFAULT_FILE;
  process.env.GGUF_FAST_MODEL = FAST_FILE;
  dbRows = [];
  generateTextMock.mockResolvedValue({
    text: '{"ok":true}',
    tokensGenerated: 3,
    tokensPrompt: 5,
    totalTimeMs: 10,
    tokensPerSecond: 300,
    modelId: "mocked",
  });
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** The model id `generateText` was pinned with on its Nth call. */
function pinnedModelOfCall(n = 0): unknown {
  expect(generateTextMock.mock.calls.length).toBeGreaterThan(n);
  return generateTextMock.mock.calls[n][1];
}

describe("runSpecialistAgent — second layer of defence", () => {
  it("no input.modelId ⇒ pins the CHAT model (never leaves it undefined for the engine to guess)", async () => {
    const { runSpecialistAgent } = await import("./aiSpecialistAgentService");

    await runSpecialistAgent({ agentId: "data-analyst", objective: "Phân tích NG rate" });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("an explicit input.modelId still wins (caller override preserved)", async () => {
    const { runSpecialistAgent } = await import("./aiSpecialistAgentService");

    await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "x",
      modelId: "Some-Other-Model",
    });

    expect(pinnedModelOfCall()).toBe("Some-Other-Model");
  });
});

describe("service call sites pin an explicit model", () => {
  it("aiReranker.rerank (llm backend) pins the FAST model — the tier its own header documents", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "llm";
    generateTextMock.mockResolvedValue({
      text: '[{"i":0,"s":0.9},{"i":1,"s":0.2}]',
      tokensGenerated: 3,
      tokensPrompt: 5,
      totalTimeMs: 10,
      tokensPerSecond: 300,
      modelId: "mocked",
    });
    const { rerank } = await import("./aiReranker");

    await rerank("query", [
      { id: "a", text: "alpha" },
      { id: "b", text: "beta" },
    ]);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(FAST_BASE);

    delete process.env.RAG_RERANKER_ENABLED;
    delete process.env.RAG_RERANKER_MODE;
  });

  it("notificationService.generateNotificationSummary pins the CHAT model", async () => {
    const { generateNotificationSummary } = await import("./notificationService");

    await generateNotificationSummary([
      { type: "alert", title: "NG spike", message: "Line 1 NG 12%" },
    ]);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("notificationService.personalizeNotificationForRole pins the CHAT model", async () => {
    const { personalizeNotificationForRole } = await import("./notificationService");

    await personalizeNotificationForRole(
      { type: "alert", title: "NG spike", message: "Line 1 NG 12%" } as any,
      "operator",
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("productionSchedulingService.explainScheduleWithAI pins the CHAT model", async () => {
    const { explainScheduleWithAI } = await import("./productionSchedulingService");

    await explainScheduleWithAI({
      algorithm: "fifo",
      totalOrders: 3,
      scheduledOrders: 2,
      unschedulableOrders: [],
      conflicts: [{ type: "capacity", severity: "high", message: "line 1 over capacity" }],
      wipStatus: [
        { lineName: "L1", utilizationRate: 88, completionPercentage: 40, inProgressOrders: 2 },
      ],
      suggestions: ["rebalance L1"],
    } as any);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("downtimeDetectionService.analyzeDowntimeRootCause pins the CHAT model", async () => {
    const { analyzeDowntimeRootCause } = await import("./downtimeDetectionService");

    await analyzeDowntimeRootCause({
      machineId: 7,
      machineCode: "AOI-07",
      downtimeDurationMinutes: 25,
      category: "unplanned",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("paretoAnalysisService recommendations pin the CHAT model", async () => {
    dbRows = [{ category: "Solder bridge", categoryId: 1, count: 12 }];
    const { paretoByDefectTypeWithRecommendations } = await import("./paretoAnalysisService");

    await paretoByDefectTypeWithRecommendations({
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-20"),
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });

  it("dataComparisonService narration pins the CHAT model", async () => {
    const { generateComparisonWithNarration } = await import("./dataComparisonService");

    await generateComparisonWithNarration({
      periodType: "week",
      currentStart: new Date("2026-07-14"),
      currentEnd: new Date("2026-07-20"),
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(pinnedModelOfCall()).toBe(DEFAULT_BASE);
  });
});

/**
 * Regression FENCE for the call sites whose AI branch is unreachable without a large, brittle
 * fake of their DB/redis/cache layer (aiInspectionAnalytics ×2, aiSmartAlertRouter, ngRateAlertService
 * — all private functions behind multi-query drizzle/cache paths). A source-level check is a weaker
 * signal than a behavioural test, but it is a real one: it fails the moment someone adds or restores
 * an UNPINNED `generateText(...)` in these files. See `.superpowers/sdd/w1-modelfix-report.md`.
 */
describe("source fence — no unpinned generateText() survives in the 12 audited call sites", () => {
  const SERVICES_DIR = path.resolve(import.meta.dirname);
  const AUDITED: Array<{ file: string; calls: number }> = [
    { file: "aiInspectionAnalytics.ts", calls: 2 },
    { file: "aiReranker.ts", calls: 1 },
    { file: "aiSmartAlertRouter.ts", calls: 1 },
    { file: "aiSpecialistAgentService.ts", calls: 1 },
    { file: "dataComparisonService.ts", calls: 1 },
    { file: "downtimeDetectionService.ts", calls: 1 },
    { file: "ngRateAlertService.ts", calls: 1 },
    { file: "notificationService.ts", calls: 2 },
    { file: "paretoAnalysisService.ts", calls: 1 },
    { file: "productionSchedulingService.ts", calls: 1 },
  ];

  for (const { file, calls } of AUDITED) {
    it(`${file} — all ${calls} generateText() call(s) resolve a model explicitly`, () => {
      const src = fs.readFileSync(path.join(SERVICES_DIR, file), "utf8");
      const actualCalls = (src.match(/\bawait generateText\(/g) ?? []).length;
      expect(actualCalls).toBe(calls);
      const resolverUses = (src.match(/resolveLogicalModel\(/g) ?? []).length;
      expect(resolverUses).toBeGreaterThanOrEqual(calls);
      // …and the tier must come from the SHARED resolver, never a hard-coded ".gguf" basename.
      expect(src).toMatch(/from ["'][^"']*modelResolver["']/);
    });
  }
});
