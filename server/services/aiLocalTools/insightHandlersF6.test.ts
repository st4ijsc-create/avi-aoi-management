/**
 * Sprint F6 — insight handler tests (READ-ONLY, text + suggestion only).
 *
 * Asserts:
 *  - correlate_process_quality on a clearly-correlated dataset reports a high
 *    |r| and emits a "Đề xuất" / HITL suggestion string (no execution).
 *  - analyze_line_bottleneck on a rising cycle-time series reports an
 *    increasing trend and a takt-breach warning.
 *  - SAFETY: this module does NOT import commandDispatcher / proposeAction /
 *    writeTags (source-level grep), and both tools are read-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const getDbMock = vi.fn();
vi.mock("../../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const getLineBalanceSeries = vi.fn();
const resolveLineIdByCode = vi.fn();
vi.mock("../../db/lineBalance", () => ({
  getLineBalanceSeries: (...a: unknown[]) => getLineBalanceSeries(...a),
  resolveLineIdByCode: (...a: unknown[]) => resolveLineIdByCode(...a),
}));

vi.mock("../../../drizzle/schema", () => ({
  processResults: {
    serialNumber: { __c: "serialNumber" },
    metrics: { __c: "metrics" },
    result: { __c: "result" },
    stepType: { __c: "stepType" },
    measuredAt: { __c: "measuredAt" },
    machineId: { __c: "machineId" },
  },
  machines: { code: { __c: "code" }, id: { __c: "id" } },
}));

import { analyzeLineBottleneck, correlateProcessQuality } from "./insightHandlersF6";

beforeEach(() => vi.clearAllMocks());

/** Build a fake db that serves two sequential select() calls (upstream, downstream). */
function fakeDbForCorrelation(upstreamRows: any[], downstreamRows: any[]) {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = call === 0 ? upstreamRows : downstreamRows;
          call++;
          return {
            orderBy: async () => rows,
            // downstream query has no orderBy → where() itself is awaited
            then: (resolve: (v: any) => void) => resolve(rows),
          };
        },
      }),
    }),
  };
}

describe("correlate_process_quality", () => {
  it("returns noDbResult when getDb is null", async () => {
    getDbMock.mockResolvedValue(null);
    const r = await correlateProcessQuality.handler!({
      upstreamStepType: "torque", metricKey: "torque", days: 7,
    } as any);
    expect(r.note).toBe("DB_UNAVAILABLE");
  });

  it("reports a strong correlation + HITL suggestion on a correlated dataset", async () => {
    // High torque → fail; low torque → pass (monotonic → |r| high).
    const upstream = Array.from({ length: 10 }, (_, i) => ({
      serialNumber: `SN${i}`,
      metrics: { torque: i },
      result: "pass",
    }));
    const downstream = Array.from({ length: 10 }, (_, i) => ({
      serialNumber: `SN${i}`,
      result: i >= 5 ? "fail" : "pass",
      stepType: "function",
    }));
    getDbMock.mockResolvedValue(fakeDbForCorrelation(upstream, downstream));

    const r = await correlateProcessQuality.handler!({
      upstreamStepType: "torque", metricKey: "torque", downstreamStepType: "function", days: 7,
    } as any);

    expect(r.type).toBe("correlation_insight");
    expect(r.data!.paired).toBe(10);
    expect(Math.abs(r.data!.pearson!)).toBeGreaterThan(0.6);
    expect(r.textSummary).toMatch(/Đề xuất|ĐỀ XUẤT/);
    expect(r.textSummary.toLowerCase()).toContain("hitl");
  });

  it("returns NOT_FOUND when fewer than 3 paired serials", async () => {
    getDbMock.mockResolvedValue(fakeDbForCorrelation(
      [{ serialNumber: "SN1", metrics: { torque: 1 }, result: "pass" }],
      [{ serialNumber: "SN1", result: "fail", stepType: "function" }],
    ));
    const r = await correlateProcessQuality.handler!({
      upstreamStepType: "torque", metricKey: "torque", downstreamStepType: "function", days: 7,
    } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("analyze_line_bottleneck", () => {
  it("flags increasing cycle trend + takt breach forecast", async () => {
    getDbMock.mockResolvedValue({});
    resolveLineIdByCode.mockResolvedValue(7);
    const base = Date.now() - 10 * 86400_000;
    // Cycle max rises steadily and already near/over takt → forecast breach.
    getLineBalanceSeries.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        periodStart: new Date(base + i * 86400_000).toISOString(),
        maxCycleTimeMs: 800 + i * 60,
        taktTimeMs: 1000,
        wipCount: 5 + i,
        bottleneckStationId: 3,
      })),
    );
    const r = await analyzeLineBottleneck.handler!({ lineCode: "A", days: 7 } as any);
    expect(r.type).toBe("line_insight");
    expect(r.data!.cycleTrend).toBe("increasing");
    expect(r.textSummary).toContain("[Hiện trạng]");
    expect(r.textSummary).toContain("[Dự báo]");
    expect(r.textSummary).toMatch(/ĐỀ XUẤT/);
  });

  it("returns NOT_FOUND with insufficient data", async () => {
    getDbMock.mockResolvedValue({});
    resolveLineIdByCode.mockResolvedValue(7);
    getLineBalanceSeries.mockResolvedValue([
      { periodStart: new Date().toISOString(), maxCycleTimeMs: 800, taktTimeMs: 1000, wipCount: 5, bottleneckStationId: 3 },
    ]);
    const r = await analyzeLineBottleneck.handler!({ lineCode: "A", days: 7 } as any);
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("F6 insight — read-only safety", () => {
  it("both insight tools are read tools with no write surface", () => {
    for (const t of [analyzeLineBottleneck, correlateProcessQuality]) {
      expect(t.kind ?? "read").toBe("read");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      expect(t.requiredPermission).toBeUndefined();
    }
  });

  it("does NOT import commandDispatcher / proposeAction / writeTags / aiCopilotActions", () => {
    const src = readFileSync(join(__dirname, "insightHandlersF6.ts"), "utf8");
    // Inspect ONLY the import statements (the doc comment legitimately names
    // these symbols when stating the safety contract).
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bawait import\b/.test(l));
    const imports = importLines.join("\n");
    expect(imports).not.toMatch(/commandDispatcher/);
    expect(imports).not.toMatch(/proposeAction/);
    expect(imports).not.toMatch(/writeTags/);
    expect(imports).not.toMatch(/aiCopilotActions/);
    expect(imports).not.toMatch(/commandDispatcher|ot\/driver/);
  });
});
