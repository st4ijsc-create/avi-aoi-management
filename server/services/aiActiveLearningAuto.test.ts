/**
 * WS-1 — Unit tests for aiActiveLearningAuto idempotency.
 *
 * A small in-memory fake of the drizzle query builder backs `getDb()`:
 *  - inferenceResults select → returns the seeded inference rows
 *  - aiLabelQueue select (existence check) → consults the inserted set
 *  - aiLabelQueue insert → records into the set (keyed by model+insp+meas)
 *
 * The key assertion: running a scan TWICE enqueues each hard image only once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../db/connection";
import { inferenceResults, aiLabelQueue } from "../../drizzle/schema";
import { scanInferenceForUncertainty } from "./aiActiveLearningAuto";

const mockedGetDb = vi.mocked(getDb);

interface InfRow {
  inspectionId: number | null;
  measurementResultId: number | null;
  inputReference: string | null;
  predictions: Array<{ label: string; confidence: number }> | null;
  topLabel: string | null;
  confidence: string | null;
}

function makeFakeDb(inferenceRows: InfRow[]) {
  // Set of "modelId|inspectionId|measurementResultId" already in the queue.
  const queueKeys = new Set<string>();
  const inserted: any[] = [];

  const key = (modelId: number, insp: number | null, meas: number | null) =>
    `${modelId}|${insp ?? "∅"}|${meas ?? "∅"}`;

  function selectChain(table: any) {
    const chain: any = {
      from: (_t: any) => chain,
      where: (_w: any) => chain,
      orderBy: (_o: any) => chain,
      limit: (_n: number) => {
        if (table === inferenceResults) return Promise.resolve(inferenceRows);
        return Promise.resolve([]); // default
      },
    };
    // Existence check resolves the where() chain via limit(1); we approximate by
    // tracking the last where args. Simpler: intercept at limit for aiLabelQueue.
    return chain;
  }

  // We need the existence check to actually consult queueKeys. Because the real
  // code builds where() with model/insp/meas, we capture them through a closure
  // on select() for aiLabelQueue.
  const db: any = {
    _inserted: inserted,
    select: (_proj?: any) => {
      let fromTable: any = null;
      const chain: any = {
        from: (t: any) => { fromTable = t; return chain; },
        where: (_w: any) => chain,
        orderBy: (_o: any) => chain,
        limit: (_n: number) => {
          if (fromTable === inferenceResults) return Promise.resolve(inferenceRows);
          // aiLabelQueue existence check: handled separately below.
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    insert: (_t: any) => ({
      values: (entry: any) => {
        const k = key(entry.modelId, entry.inspectionId ?? null, entry.measurementResultId ?? null);
        if (queueKeys.has(k)) {
          // Emulate unique-index violation.
          return Promise.reject(new Error("duplicate key"));
        }
        queueKeys.add(k);
        inserted.push(entry);
        return Promise.resolve(undefined);
      },
    }),
  };

  // Override select so the aiLabelQueue existence check reflects queueKeys.
  db.select = (_proj?: any) => {
    let fromTable: any = null;
    let captured: { modelId?: number; insp?: number | null; meas?: number | null } = {};
    const chain: any = {
      from: (t: any) => { fromTable = t; return chain; },
      where: (_w: any) => chain, // we cannot read SQL; rely on insert-time dedup instead
      orderBy: (_o: any) => chain,
      limit: (_n: number) => {
        if (fromTable === inferenceResults) return Promise.resolve(inferenceRows);
        // For the queue existence check we return [] and let the insert-time
        // unique-violation path enforce idempotency (matches DB behavior).
        return Promise.resolve([]);
      },
    };
    void captured;
    return chain;
  };

  return { db, inserted, queueKeys };
}

beforeEach(() => vi.clearAllMocks());

describe("scanInferenceForUncertainty idempotency", () => {
  const rows: InfRow[] = [
    // High entropy (uncertain) — should enqueue.
    { inspectionId: 1, measurementResultId: 10, inputReference: "a.jpg", predictions: [{ label: "OK", confidence: 0.5 }, { label: "NG", confidence: 0.5 }], topLabel: "OK", confidence: "0.5" },
    // Low entropy (confident) — should NOT enqueue.
    { inspectionId: 2, measurementResultId: 20, inputReference: "b.jpg", predictions: [{ label: "OK", confidence: 0.99 }, { label: "NG", confidence: 0.01 }], topLabel: "OK", confidence: "0.99" },
    // High entropy again — enqueue.
    { inspectionId: 3, measurementResultId: 30, inputReference: "c.jpg", predictions: [{ label: "OK", confidence: 0.45 }, { label: "NG", confidence: 0.55 }], topLabel: "NG", confidence: "0.55" },
  ];

  it("enqueues only uncertain rows above threshold", async () => {
    const { db, inserted } = makeFakeDb(rows);
    mockedGetDb.mockResolvedValue(db);

    const res = await scanInferenceForUncertainty({ modelId: 7, uncertaintyThreshold: 0.5 });
    expect(res.enqueued).toBe(2); // a.jpg + c.jpg
    expect(res.belowThreshold).toBe(1); // b.jpg
    expect(inserted).toHaveLength(2);
    expect(inserted.every(e => e.samplingStrategy === "UNCERTAINTY")).toBe(true);
  });

  it("does NOT double-enqueue when run twice (idempotent)", async () => {
    const { db, inserted } = makeFakeDb(rows);
    mockedGetDb.mockResolvedValue(db);

    const first = await scanInferenceForUncertainty({ modelId: 7, uncertaintyThreshold: 0.5 });
    const second = await scanInferenceForUncertainty({ modelId: 7, uncertaintyThreshold: 0.5 });

    expect(first.enqueued).toBe(2);
    expect(second.enqueued).toBe(0); // all duplicates on second run
    expect(second.skippedExisting).toBe(2);
    expect(inserted).toHaveLength(2); // still only 2 rows total
  });
});
