/**
 * W18 — mỗi chỗ `.rows` trần được vá kèm bằng chứng "TRƯỚC ĐÂY = rỗng / 0 / rơi tầng sau": db giả trả MẢNG hàng như postgres-js.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("onnxruntime-node", () => ({ InferenceSession: { create: vi.fn() }, Tensor: class {} }));
vi.mock("sharp", () => ({ default: vi.fn() }));

import { getDb } from "../db/connection";

beforeEach(() => vi.mocked(getDb).mockReset());

describe("aiSmartAlertRouter.checkPatterns", () => {
  it("db trả MẢNG [{day_of_week,hour_of_day,occurrences}] ⇒ có câu 'Recurring pattern' (bản cũ `result.rows ?? []` luôn null)", async () => {
    const { checkPatterns } = await import("./aiSmartAlertRouter");
    const db = { execute: vi.fn(async () => [{ day_of_week: "1", hour_of_day: "9", occurrences: "5" }]) };
    const kq = await checkPatterns(db as never, { type: "X", machineId: 1 } as never);
    expect(kq).toMatch(/Recurring pattern detected: .* Mondays around 9:00 \(5 times in 30 days\)/);
    expect(await checkPatterns({ execute: async () => [] } as never, { type: "X" } as never)).toBeNull();
  });
});

describe("aiImageEmbedding.findSimilarByVectorWithMode", () => {
  it("tầng HNSW đọc được MẢNG hàng ⇒ searchMode 'hnsw' (bản cũ `result.rows` ném TypeError ⇒ luôn rơi xuống tầng sau)", async () => {
    const { findSimilarByVectorWithMode } = await import("./aiImageEmbedding");
    const hang = { id: 7, inspectionId: 1, measurementResultId: null, imageUrl: "u", label: "l", defectType: "d", machineId: 3, productModelId: null, similarity: "0.93", createdAt: "2026-10-25T00:00:00Z" };
    const execute = vi.fn(async (q: unknown) => {
      const t = JSON.stringify(q);
      return t.includes("hnsw.ef_search") ? [] : [hang];
    });
    vi.mocked(getDb).mockResolvedValue({ execute } as never);
    const kq = await findSimilarByVectorWithMode(new Array(1024).fill(0.01), 1024, 5, { minSimilarity: 0.5 });
    expect(kq.searchMode).toBe("hnsw");
    expect(kq.results.map((r) => r.id)).toEqual([7]);
  });
  it("tầng 'exact' (dim ≠ 1024) cũng đọc được MẢNG hàng", async () => {
    const { findSimilarByVectorWithMode } = await import("./aiImageEmbedding");
    const hang = { id: 9, inspectionId: 1, measurementResultId: null, imageUrl: "u", label: "l", defectType: "d", machineId: 3, productModelId: null, similarity: "0.8", createdAt: "2026-10-25T00:00:00Z" };
    vi.mocked(getDb).mockResolvedValue({ execute: vi.fn(async () => [hang]) } as never);
    const kq = await findSimilarByVectorWithMode(new Array(512).fill(0.01), 512, 5, {});
    expect(kq.searchMode).toBe("exact");
    expect(kq.results.map((r) => r.id)).toEqual([9]);
  });
});
