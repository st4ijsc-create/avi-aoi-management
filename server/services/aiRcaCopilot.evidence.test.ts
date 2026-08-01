/**
 * W7-E (doc 27 V20) — RCA evidence upgrades:
 *   • REUSE of persisted per-NG VLM descriptions (measurement_results.aiAnalysisResult)
 *     — the VL model is NOT re-run when a stored description exists;
 *   • PERSIST-back of a freshly generated description (best-effort UPDATE) so the
 *     next advisor/RCA run reuses it;
 *   • recentCorrections evidence read fail-open from W7-B's measurement_corrections
 *     (table may not exist → honest empty, no note/noise);
 *   • the corrections summaries flow into the evidence digest shape.
 *
 * Mock style mirrors aiRcaCopilot.vision.test.ts (fake db chain + stubbed sources).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

let suspectRows: any[] = [];
let correctionRows: any[] | null = null; // null → execute throws (table absent)
const updateSet = vi.fn(() => ({ where: async () => undefined }));

function terminal(rows: any[]): any {
  const t: any = {
    innerJoin: () => t,
    where: () => t,
    orderBy: () => t,
    limit: async (_n: number) => rows,
    then: (resolve: (v: any[]) => void) => resolve(rows),
  };
  return t;
}
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: (_cols?: any) => ({ from: (_tbl: any) => terminal(suspectRows) }),
    update: (_tbl: any) => ({ set: updateSet }),
    execute: async (_q: any) => {
      if (correctionRows == null) throw new Error('relation "measurement_corrections" does not exist');
      return correctionRows;
    },
  })),
}));

vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: vi.fn(async () => ({ items: [] })) }));
vi.mock("./aiInspectionAnalytics", () => ({
  getControlChart: vi.fn(async () => ({ summary: { cpk: null, outOfControlCount: 0, spcViolations: [] } })),
}));
vi.mock("./aiAnomalyDetection", () => ({ getAnomalyStats: vi.fn(async () => null) }));
vi.mock("./aiLocalKnowledgeService", () => ({ retrieveKnowledge: vi.fn(async () => ({ citations: [] })) }));
vi.mock("./aiCausalGraph", () => ({
  hybridDefectContext: vi.fn(async () => ({ causal: { defect: null, machine: null, causes: [] }, causalText: "", kbHits: [] })),
}));

const readStorageBuffer = vi.fn(async (_k: string) => Buffer.from("fake-jpeg-bytes"));
vi.mock("./aiEdgeEnhanced", () => ({ readStorageBuffer: (k: string) => readStorageBuffer(k) }));

const describeDefect = vi.fn(async () => ({
  description: "Tombstoned chip resistor at C12 — one pad open.",
  severity: "high",
  location: "C12",
  possibleCauses: [],
  suggestedActions: [],
}));
vi.mock("./aiVisionLanguage", () => ({ describeDefect: (...a: any[]) => describeDefect(...a) }));

vi.mock("./aiModelRouter", () => ({ route: () => ({ modelId: "x", maxTokens: 256, temperature: 0.2, contextSize: 2048 }) }));
vi.mock("./aiGgufEngine", () => ({ generateJSON: vi.fn(async () => ({ data: { hypotheses: [] } })) }));

import { runRca } from "./aiRcaCopilot";

const prevFlag = process.env.AI_RCA_COPILOT_ENABLED;
afterAll(() => {
  if (prevFlag === undefined) delete process.env.AI_RCA_COPILOT_ENABLED;
  else process.env.AI_RCA_COPILOT_ENABLED = prevFlag;
});

beforeEach(() => {
  process.env.AI_RCA_COPILOT_ENABLED = "true";
  suspectRows = [];
  correctionRows = null;
  vi.clearAllMocks();
});

describe("VLM description reuse + persist-back (V20)", () => {
  it("reuses the STORED aiAnalysisResult — VL model not re-run", async () => {
    suspectRows = [{
      id: 42,
      imageKey: "insp/42.jpg",
      imageUrl: null,
      aiAnalysisResult: "Stored: solder bridge between pins 3-4.",
    }];
    const r = await runRca({ machineId: 7, defectType: "bridge" });
    expect(r.evidence.visionDescription).toBe("Stored: solder bridge between pins 3-4.");
    expect(describeDefect).not.toHaveBeenCalled();
    expect(readStorageBuffer).not.toHaveBeenCalled();
  });

  it("no stored description → runs VLM once and PERSISTS the result back", async () => {
    suspectRows = [{ id: 43, imageKey: "insp/43.jpg", imageUrl: null, aiAnalysisResult: null }];
    const r = await runRca({ machineId: 7, defectType: "tombstone" });
    expect(describeDefect).toHaveBeenCalledTimes(1);
    expect(r.evidence.visionDescription).toMatch(/tombstoned/i);
    // persist-back: update(...).set({aiAnalysisResult}).where(id)
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect((updateSet.mock.calls[0][0] as any).aiAnalysisResult).toMatch(/tombstoned/i);
  });

  it("a stored degrade string is NOT treated as evidence (falls through to VLM)", async () => {
    suspectRows = [{
      id: 44,
      imageKey: "insp/44.jpg",
      imageUrl: null,
      aiAnalysisResult: "VLM analysis unavailable. Configure a model.",
    }];
    const r = await runRca({ machineId: 7 });
    expect(describeDefect).toHaveBeenCalledTimes(1);
    expect(r.evidence.visionDescription).toMatch(/tombstoned/i);
  });
});

describe("recentCorrections evidence (W7-B table, dynamic + fail-open)", () => {
  it("table absent → honest empty corrections, RCA still runs", async () => {
    correctionRows = null; // execute throws
    const r = await runRca({ machineId: 7, defectType: "bridge" });
    expect(r.ok).toBe(true);
    expect(r.evidence.recentCorrections).toEqual([]);
  });

  it("table present → correction summaries land in the evidence bundle", async () => {
    correctionRows = [
      { at: "2026-07-03T10:00:00Z", original: "NG", corrected: "OK", reason: "reflection false call" },
      { at: "2026-07-03T09:00:00Z", original: "NG", corrected: "NTF", reason: null },
    ];
    const r = await runRca({ machineId: 7, defectType: "bridge" });
    expect(r.evidence.recentCorrections).toHaveLength(2);
    expect(r.evidence.recentCorrections[0].summary).toBe("NG→OK (reflection false call)");
    expect(r.evidence.recentCorrections[1].summary).toBe("NG→NTF");
  });
});
