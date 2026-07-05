/**
 * W7-C (doc 27 §9 V9 + V24) — measurementResult.analyzeWithAI producer tests.
 *
 * DB integration against the isolated <db>_test; the LLM is MOCKED (vi.mock of
 * server/_core/llm) so no provider is needed.
 *
 * Covers:
 *  - V9: a successful VLM analysis ALSO writes an ai_suggestions row
 *    (inspectionId + measurementResultId + type + confidence + PENDING) — the
 *    exact shape AISuggestionsPanel queries via aiFeedback.getSuggestionsByInspection
 *  - NG → DEFECT_CLASSIFICATION, OK → QUALITY_PREDICTION
 *  - V24 re-run: a second analyze succeeds and overwrites (no "already analyzed" block)
 *  - V24 degraded: an LLM failure returns { degraded:true, message } instead of
 *    INTERNAL_SERVER_ERROR, writes NOTHING (no analysis, no suggestion)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { initTRPC } from "@trpc/server";
import { and, eq, like } from "drizzle-orm";

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "../_core/llm";
import { getDb } from "../db/connection";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  aiSuggestions,
} from "../../drizzle/schema";
import { measurementResultRouter } from "./inspectionRouters";

const mockInvokeLLM = vi.mocked(invokeLLM);

const SERIAL_PREFIX = `W7C-V9-${Date.now()}`;
const TEST_USER = { id: 992_001, name: "V9 Tester", role: "admin" };

const t = initTRPC.context<any>().create();
const makeCaller = t.createCallerFactory(measurementResultRouter);
const caller = makeCaller({ user: TEST_USER });

let db: Awaited<ReturnType<typeof getDb>>;
let pointDefId: number;
let inspectionId: number;

function llmResponse(payload: Record<string, unknown>) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  } as any;
}

async function insertMeasurement(result: "OK" | "NG"): Promise<number> {
  const [row] = await db!
    .insert(measurementResults)
    .values({
      inspectionId,
      pointDefId,
      result,
      // 1×1 transparent PNG data URL — invokeLLM is mocked, only presence matters.
      imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    })
    .returning({ id: measurementResults.id });
  return row.id;
}

beforeAll(async () => {
  db = await getDb();
  if (!db) return;
  const [pd] = await db
    .insert(measurementPointDefs)
    .values({
      productModelId: 99_942_017, // no FK on this column — synthetic scope
      code: `${SERIAL_PREFIX}-MP1`,
      name: "V9 test point",
      measurementType: "VISUAL",
      positionX: 0,
      positionY: 0,
    })
    .returning({ id: measurementPointDefs.id });
  pointDefId = pd.id;

  const [insp] = await db
    .insert(productInspections)
    .values({
      machineId: 1,
      serialNumber: `${SERIAL_PREFIX}-SN1`,
      productModel: `${SERIAL_PREFIX}-PROD`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date(),
    })
    .returning({ id: productInspections.id });
  inspectionId = insp.id;
});

afterAll(async () => {
  if (!db) return;
  if (inspectionId) {
    await db.delete(aiSuggestions).where(eq(aiSuggestions.inspectionId, inspectionId));
    await db.delete(measurementResults).where(eq(measurementResults.inspectionId, inspectionId));
    await db.delete(productInspections).where(like(productInspections.serialNumber, `${SERIAL_PREFIX}%`));
  }
  await db.delete(measurementPointDefs).where(like(measurementPointDefs.code, `${SERIAL_PREFIX}%`));
});

describe("measurementResult.analyzeWithAI — V9 suggestions producer + V24 degraded UX", () => {
  it("NG analysis writes measurement AND an ai_suggestions DEFECT_CLASSIFICATION row", async () => {
    if (!db) return; // no DB — soft skip
    const mid = await insertMeasurement("NG");
    mockInvokeLLM.mockResolvedValueOnce(llmResponse({
      assessment: "NG",
      defects: ["solder bridge", "tombstone"],
      confidence: 88,
      recommendations: "Check nozzle pressure",
    }));

    const res = await caller.analyzeWithAI({ id: mid });
    expect(res.degraded).toBe(false);
    expect(res.assessment).toBe("NG");

    const [m] = await db.select().from(measurementResults).where(eq(measurementResults.id, mid));
    expect(m.aiAnalysisResult).toContain("solder bridge");
    expect(Number(m.aiConfidence)).toBeCloseTo(0.88, 2);

    // The row AISuggestionsPanel reads (getSuggestionsByInspection: WHERE inspectionId).
    const rows = await db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.inspectionId, inspectionId), eq(aiSuggestions.measurementResultId, mid)));
    expect(rows).toHaveLength(1);
    expect(rows[0].suggestionType).toBe("DEFECT_CLASSIFICATION");
    expect(rows[0].suggestion).toContain("solder bridge");
    expect(Number(rows[0].confidence)).toBeCloseTo(0.88, 2);
    expect(rows[0].reasoning).toBe("Check nozzle pressure");
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].modelName).toBe("vlm-inspection-analyze");
  });

  it("re-analyze is allowed and overwrites (V24); OK verdict → QUALITY_PREDICTION", async () => {
    if (!db) return;
    const mid = await insertMeasurement("OK");
    mockInvokeLLM.mockResolvedValueOnce(llmResponse({
      assessment: "NG", defects: ["scratch"], confidence: 60, recommendations: "",
    }));
    await caller.analyzeWithAI({ id: mid });

    // Second run (the client confirms overwrite; the server never blocks it).
    mockInvokeLLM.mockResolvedValueOnce(llmResponse({
      assessment: "OK", defects: [], confidence: 95, recommendations: "No action needed",
    }));
    const second = await caller.analyzeWithAI({ id: mid });
    expect(second.degraded).toBe(false);
    expect(second.assessment).toBe("OK");

    const [m] = await db.select().from(measurementResults).where(eq(measurementResults.id, mid));
    expect(m.aiAnalysisResult).toContain('"OK"'); // overwritten by the re-run
    expect(Number(m.aiConfidence)).toBeCloseTo(0.95, 2);

    const rows = await db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.inspectionId, inspectionId), eq(aiSuggestions.measurementResultId, mid)));
    expect(rows).toHaveLength(2); // each run produced a suggestion
    expect(rows.map((r) => r.suggestionType).sort()).toEqual(["DEFECT_CLASSIFICATION", "QUALITY_PREDICTION"]);
  });

  it("V24: LLM failure returns degraded (honest fallback), throws nothing, writes nothing", async () => {
    if (!db) return;
    const mid = await insertMeasurement("NG");
    mockInvokeLLM.mockRejectedValueOnce(new Error("Vision unavailable: sidecar not configured"));

    const res = await caller.analyzeWithAI({ id: mid });
    expect(res.degraded).toBe(true);
    expect((res as { message?: string }).message).toContain("Vision unavailable");
    expect(res.assessment).toBeNull();

    // NOTHING was persisted — the analyze button stays actionable.
    const [m] = await db.select().from(measurementResults).where(eq(measurementResults.id, mid));
    expect(m.aiAnalysisResult).toBeNull();
    const rows = await db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.inspectionId, inspectionId), eq(aiSuggestions.measurementResultId, mid)));
    expect(rows).toHaveLength(0);
  });
});
