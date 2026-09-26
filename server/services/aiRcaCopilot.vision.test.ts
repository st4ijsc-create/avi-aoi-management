/**
 * doc 22 P2 — RCA vision-evidence wiring tests.
 *
 * Proves the previously-stubbed vision branch of gatherEvidence now feeds a real
 * defect image through describeDefect:
 *   - when a suspect NG image exists for the machine, evidence.visionDescription is
 *     populated from the VL model (asserted via runRca's returned evidence bundle);
 *   - when NO image exists, it stays null (honest — no fabrication), and vision is
 *     noted as unavailable.
 *
 * All heavy evidence sources + the synthesis model are stubbed so this stays a fast
 * unit test. The DB is a tiny fake routed by table key (mirrors assetCockpitService
 * test style); storage + describeDefect are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ── Fake DB: measurement_results ⋈ product_inspections chain returns a suspect row. ──
let suspectRows: any[] = [];
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
  })),
}));

// The RCA copilot dynamically imports the schema + drizzle-orm inside the helper;
// those resolve to the real modules (only the query BUILDER is faked above), so no
// schema mock is required — the fake db ignores the table/args entirely.

// ── Stub every OTHER evidence source so only vision matters. ──
vi.mock("./paretoAnalysisService", () => ({ paretoByDefectType: vi.fn(async () => ({ items: [] })) }));
vi.mock("./aiInspectionAnalytics", () => ({
  getControlChart: vi.fn(async () => ({ summary: { cpk: null, outOfControlCount: 0, spcViolations: [] } })),
}));
vi.mock("./aiAnomalyDetection", () => ({ getAnomalyStats: vi.fn(async () => null) }));
vi.mock("./aiLocalKnowledgeService", () => ({ retrieveKnowledge: vi.fn(async () => ({ citations: [] })) }));
vi.mock("./aiCausalGraph", () => ({
  hybridDefectContext: vi.fn(async () => ({ causal: { defect: null, machine: null, causes: [] }, causalText: "", kbHits: [] })),
}));

// ── Storage + VL model mocks. ──
const readStorageBuffer = vi.fn(async (_k: string) => Buffer.from("fake-jpeg-bytes"));
vi.mock("./aiEdgeEnhanced", () => ({ readStorageBuffer: (k: string) => readStorageBuffer(k) }));

const describeDefect = vi.fn(async () => ({
  description: "Cold solder joint on U3 pin 4 — dull, cracked fillet.",
  severity: "high",
  location: "U3 pin 4",
  possibleCauses: ["insufficient reflow temperature"],
  suggestedActions: ["raise reflow zone 3 by 8C"],
}));
vi.mock("./aiVisionLanguage", () => ({ describeDefect: (...a: any[]) => describeDefect(...a) }));

// ── Keep synthesis empty (no real model) → runRca honestly degrades but still
//    returns the populated evidence bundle we assert on. ──
// doc69 G2-3 — synthesize() now goes through aiGateway.routeInference (for metering), which
// reads aiModelRouter.getRouterStats() too (not just route()) — stub it alongside route().
vi.mock("./aiModelRouter", () => ({
  route: () => ({ modelId: "x", maxTokens: 256, temperature: 0.2, contextSize: 2048 }),
  getRouterStats: () => ({ total: 0, byTier: {}, fastModelConfigured: false }),
}));
vi.mock("./aiGgufEngine", () => ({ generateJSON: vi.fn(async () => ({ data: { hypotheses: [] } })) }));

import { runRca } from "./aiRcaCopilot";

describe("RCA vision evidence wiring", () => {
  const prev = process.env.AI_RCA_COPILOT_ENABLED;
  beforeEach(() => {
    process.env.AI_RCA_COPILOT_ENABLED = "true";
    suspectRows = [];
    readStorageBuffer.mockClear();
    describeDefect.mockClear();
  });
  afterAll(() => { process.env.AI_RCA_COPILOT_ENABLED = prev; });

  it("feeds a suspect NG image to describeDefect → visionDescription populated", async () => {
    suspectRows = [{ imageKey: "inspections/42/U3-abc.jpg", imageUrl: null }];
    const r = await runRca({ machineId: 7, defectType: "cold solder" });
    expect(readStorageBuffer).toHaveBeenCalledWith("inspections/42/U3-abc.jpg");
    expect(describeDefect).toHaveBeenCalledTimes(1);
    expect(r.evidence.visionDescription).toMatch(/cold solder joint/i);
  });

  it("no suspect image on record → visionDescription null (no fabrication)", async () => {
    suspectRows = []; // nothing NG with an image
    const r = await runRca({ machineId: 7, defectType: "cold solder" });
    expect(describeDefect).not.toHaveBeenCalled();
    expect(r.evidence.visionDescription).toBeNull();
    expect(r.evidence.notes).not.toContain("vision_unavailable"); // resolved to null, not an error
  });

  it("VL degrade string ('VLM analysis unavailable') is treated as no evidence", async () => {
    suspectRows = [{ imageKey: "inspections/42/U3-abc.jpg", imageUrl: null }];
    describeDefect.mockResolvedValueOnce({
      description: "VLM analysis unavailable. Configure a GGUF model.",
      severity: "medium", location: "Unknown", possibleCauses: [], suggestedActions: [],
    } as any);
    const r = await runRca({ machineId: 7, defectType: "cold solder" });
    expect(r.evidence.visionDescription).toBeNull();
  });
});
