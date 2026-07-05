/**
 * W7-E (doc 27 V20/V25) — threshold auto-tune evidence + provenance tests.
 *
 * Proves requestPointTune now files the approval with:
 *   • suggestion.proposedBy = "ai_autotune" (V25 — explicit provenance beyond the
 *     requestedBy:0 sentinel; no schema column needed),
 *   • suggestion.evidence.recentNg = recent NG measurements WITH images + their
 *     PERSISTED VLM descriptions (aiAnalysisResult reuse — V20),
 *   • evidence gathering is fail-open: a broken evidence query still files the
 *     proposal (without evidence), never blocks it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.AI_THRESHOLD_AUTOTUNE_ENABLED = "true";
});

const enumerateNgTuneScopes = vi.fn(async () => []);
const enumeratePointTuneScopes = vi.fn(async () => [] as any[]);
const factoryCodeForMachine = vi.fn(async () => null);
const recommendForMeasurementPoint = vi.fn();
const recommendNgThreshold = vi.fn();

vi.mock("../db/aiThresholdTune", () => ({
  enumerateNgTuneScopes: (...a: any[]) => enumerateNgTuneScopes(...a),
  enumeratePointTuneScopes: (...a: any[]) => enumeratePointTuneScopes(...a),
  factoryCodeForMachine: (...a: any[]) => factoryCodeForMachine(...a),
}));
vi.mock("./aiThresholdAdvisor", () => ({
  recommendNgThreshold: (...a: any[]) => recommendNgThreshold(...a),
  recommendForMeasurementPoint: (...a: any[]) => recommendForMeasurementPoint(...a),
}));
vi.mock("./aiCopilotActions", () => ({ proposeAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("./aiLocalTools/toolRegistry", () => ({ getTool: () => null, isWriteTool: () => false }));
vi.mock("./aiLocalTools/writeHandlers/engineering", () => ({}));
vi.mock("node-cron", () => ({ schedule: vi.fn(() => ({ stop: vi.fn() })) }));

// drizzle-orm operators are consumed by the mocked db chain — stub them.
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => a,
  eq: (...a: any[]) => a,
  desc: (x: any) => x,
  isNotNull: (x: any) => x,
  inArray: (...a: any[]) => a,
}));
vi.mock("../../drizzle/schema", () => ({
  users: {},
  userFactoryAssignments: {},
  measurementResults: {
    id: "id",
    inspectionId: "inspectionId",
    imageUrl: "imageUrl",
    imageKey: "imageKey",
    aiAnalysisResult: "aiAnalysisResult",
    createdAt: "createdAt",
    pointDefId: "pointDefId",
    result: "result",
  },
}));
vi.mock("../../drizzle/schema/product", () => ({ thresholdApprovals: {} }));
vi.mock("../_core/accessControl", () => ({ checkPermission: async () => true }));

// DB: evidence select chain (from→where→orderBy→limit) + insert capture.
let ngRows: any[] = [];
let selectThrows = false;
const insertValues = vi.fn(async () => undefined);
const fakeDb = {
  insert: vi.fn(() => ({ values: insertValues })),
  select: vi.fn(() => {
    if (selectThrows) throw new Error("evidence query broke");
    return {
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => ngRows }) }) }),
        where: () => ({ orderBy: () => ({ limit: async () => ngRows }) }),
      }),
    };
  }),
};
vi.mock("../db/connection", () => ({ getDb: async () => fakeDb }));

import { runThresholdTuneNow } from "./aiThresholdTuneScheduler";

function pointRec(): any {
  return {
    ok: true,
    disabled: false,
    pointDefId: 201,
    code: "MP201",
    name: "MP201",
    unit: "mm",
    current: { lsl: 0, usl: 10, target: 5, cpk: 1.0 },
    recommended: { lsl: 1, usl: 9, target: 5, projectedCpk: 1.4 },
    sampleSize: 400,
    confidence: 0.8,
    basis: "p1/p99 window",
    degraded: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ngRows = [];
  selectThrows = false;
  enumerateNgTuneScopes.mockResolvedValue([]);
  enumeratePointTuneScopes.mockResolvedValue([
    { kind: "point", pointDefId: 201, productModelId: 2, machineId: 3, sampleCount: 400 },
  ]);
  recommendForMeasurementPoint.mockResolvedValue(pointRec());
});

describe("requestPointTune — V20 evidence + V25 provenance", () => {
  it("files the approval with proposedBy ai_autotune + recentNg thumbnails/VLM text", async () => {
    ngRows = [
      {
        id: 11,
        inspectionId: 900,
        imageUrl: "http://img/11.jpg",
        imageKey: "k/11.jpg",
        aiAnalysisResult: "Cold joint on pad — dull fillet.",
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      {
        id: 10,
        inspectionId: 899,
        imageUrl: "http://img/10.jpg",
        imageKey: null,
        aiAnalysisResult: null,
        createdAt: new Date("2026-06-30T00:00:00Z"),
      },
    ];

    const stats = await runThresholdTuneNow();
    expect(stats.pointRequested).toBe(1);
    expect(insertValues).toHaveBeenCalledTimes(1);

    const payload = insertValues.mock.calls[0][0] as any;
    expect(payload.requestedBy).toBe(0); // sentinel kept — provenance is explicit below
    expect(payload.suggestion.source).toBe("ai_threshold_autotune");
    expect(payload.suggestion.proposedBy).toBe("ai_autotune"); // V25
    const recentNg = payload.suggestion.evidence.recentNg;
    expect(recentNg).toHaveLength(2);
    expect(recentNg[0]).toMatchObject({
      measurementId: 11,
      inspectionId: 900,
      imageUrl: "http://img/11.jpg",
      aiDescription: "Cold joint on pad — dull fillet.",
    });
    expect(recentNg[1].aiDescription).toBeNull(); // honest: no stored VLM text
  });

  it("evidence failure is fail-open: proposal still filed WITHOUT evidence", async () => {
    selectThrows = true;
    // Different scope id — the scheduler's per-scope 24h throttle is module state.
    enumeratePointTuneScopes.mockResolvedValue([
      { kind: "point", pointDefId: 202, productModelId: 2, machineId: 3, sampleCount: 400 },
    ]);
    recommendForMeasurementPoint.mockResolvedValue({ ...pointRec(), pointDefId: 202 });
    const stats = await runThresholdTuneNow();
    expect(stats.pointRequested).toBe(1);
    const payload = insertValues.mock.calls[0][0] as any;
    expect(payload.suggestion.evidence).toBeUndefined();
    expect(payload.suggestion.proposedBy).toBe("ai_autotune");
  });
});
