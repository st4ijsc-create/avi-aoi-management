import { describe, it, expect } from "vitest";
import { normalizeBatchResponse, extractItems } from "./thresholdApprovalsBatch";

describe("thresholdApprovalsBatch.extractItems", () => {
  it("reads a bare array", () => {
    expect(extractItems([{ id: 1 }, { id: 2 }]).length).toBe(2);
  });

  it("reads common envelope keys", () => {
    expect(extractItems({ results: [{ id: 1 }] }).length).toBe(1);
    expect(extractItems({ items: [{ id: 1 }, { id: 2 }] }).length).toBe(2);
    expect(extractItems({ outcomes: [{ id: 9 }] }).length).toBe(1);
  });

  it("returns [] for junk", () => {
    expect(extractItems(null)).toEqual([]);
    expect(extractItems(undefined)).toEqual([]);
    expect(extractItems({ nope: true })).toEqual([]);
    expect(extractItems(42)).toEqual([]);
  });
});

describe("thresholdApprovalsBatch.normalizeBatchResponse", () => {
  it("buckets by explicit status strings", () => {
    const s = normalizeBatchResponse([
      { id: 1, status: "approved" },
      { id: 2, status: "applied" },
      { id: 3, status: "skipped" },
      { id: 4, status: "failed" },
    ]);
    expect(s).toMatchObject({ approved: 2, skipped: 1, failed: 1, total: 4 });
  });

  it("treats self-approval SoD as a skip, not a failure", () => {
    const s = normalizeBatchResponse({
      results: [
        { id: 10, ok: false, reason: "Cannot approve your own request (SoD)" },
        { id: 11, status: "forbidden", reason: "self-approve blocked" },
        { id: 12, ok: false, reason: "requester cannot decide" },
      ],
    });
    expect(s.skipped).toBe(3);
    expect(s.failed).toBe(0);
    expect(s.approved).toBe(0);
  });

  it("buckets by boolean flags when no status", () => {
    const s = normalizeBatchResponse([
      { id: 1, ok: true },
      { id: 2, approved: true },
      { id: 3, applied: true },
      { id: 4, skipped: true },
      { id: 5, ok: false, reason: "db error" },
    ]);
    expect(s).toMatchObject({ approved: 3, skipped: 1, failed: 1, total: 5 });
  });

  it("defaults inconclusive items to failed", () => {
    const s = normalizeBatchResponse([{ id: 1 }, { id: 2, status: "weird" }]);
    expect(s.failed).toBe(2);
  });

  it("preserves per-id detail with coerced numeric ids and reason", () => {
    const s = normalizeBatchResponse([
      { id: "7", ok: false, reason: "not found" },
      { id: null, ok: true },
    ]);
    expect(s.items[0]).toEqual({ id: 7, category: "failed", reason: "not found" });
    expect(s.items[1]).toEqual({ id: null, category: "approved", reason: null });
  });

  it("handles an empty batch", () => {
    const s = normalizeBatchResponse([]);
    expect(s).toEqual({ approved: 0, skipped: 0, failed: 0, total: 0, items: [] });
  });
});
