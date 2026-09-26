/**
 * doc69 B3 (Wave 5, AI#2) — aiKbFeedbackSignal.ts unit tests.
 *
 * `../db/connection`'s getDb is fully mocked — no live database is ever touched.
 * Covers (per the task brief):
 *   1. computeFeedbackWeight — pure, bounded (never exceeds FEEDBACK_WEIGHT_MIN/MAX
 *      regardless of how extreme netRating is; 0/absent -> exactly 1, a no-op).
 *   2. A toy re-rank using computeFeedbackWeight: an upvoted source's candidate gets
 *      a bounded boost that can flip a close ranking (order changes as expected);
 *      no feedback for any candidate -> order unchanged (== pure semantic).
 *   3. recordAnswerFeedback — persists a row (shape asserted); fail-safe when the
 *      table is absent (isMissingTable cause-walker, BOTH the raw-code shape and the
 *      DrizzleQueryError-wrapped shape) or the DB otherwise errors or is unconfigured
 *      — never throws.
 *   4. loadFeedbackNetRatings — aggregates net rating per citation sourcePath from
 *      raw rows; fail-safe (empty map, never throws) on missing table / wrapped
 *      missing table / other DB error / no DB; in-memory TTL cache (second call
 *      doesn't re-hit the DB; a fresh write invalidates it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectFromMock = vi.fn();
const selectOrderByMock = vi.fn();
const selectLimitMock = vi.fn();
const selectMock = vi.fn(() => ({ from: selectFromMock }));
selectFromMock.mockImplementation(() => ({ orderBy: selectOrderByMock }));
selectOrderByMock.mockImplementation(() => ({ limit: selectLimitMock }));

const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));

const fakeDb = { select: selectMock, insert: insertMock };
const getDbMock = vi.fn(async () => fakeDb);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import {
  isFeedbackRerankEnabled,
  computeFeedbackWeight,
  loadFeedbackNetRatings,
  recordAnswerFeedback,
  resetFeedbackAggregateCacheForTest,
  FEEDBACK_WEIGHT_MIN,
  FEEDBACK_WEIGHT_MAX,
  MAX_NET_RATING,
} from "./aiKbFeedbackSignal";

function missingTableError(): Error & { code: string } {
  return Object.assign(new Error('relation "kb_answer_feedback" does not exist'), { code: "42P01" });
}

/** The REAL shape a drizzle-orm >=0.44 query against an unmigrated table produces: a
 * "Failed query: ..." wrapper Error with `code: undefined` at the top level and the real
 * postgres.js driver error (code 42P01) on `.cause`. A naive `(e as {code}).code === "42P01"`
 * check misses this — isMissingTable's cause-chain walk is what this module must use. */
function wrappedMissingTableError(): Error {
  const wrapped = new Error('Failed query: SELECT * FROM kb_answer_feedback');
  (wrapped as Error & { cause: unknown }).cause = missingTableError();
  return wrapped;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(fakeDb);
  selectFromMock.mockImplementation(() => ({ orderBy: selectOrderByMock }));
  selectOrderByMock.mockImplementation(() => ({ limit: selectLimitMock }));
  resetFeedbackAggregateCacheForTest();
  delete process.env.KB_FEEDBACK_RERANK_ENABLED;
});

// ─── isFeedbackRerankEnabled ────────────────────────────────────────────────

describe("isFeedbackRerankEnabled", () => {
  it("defaults to false (flag unset)", () => {
    expect(isFeedbackRerankEnabled()).toBe(false);
  });

  it("is true only when explicitly enabled", () => {
    process.env.KB_FEEDBACK_RERANK_ENABLED = "true";
    expect(isFeedbackRerankEnabled()).toBe(true);
    process.env.KB_FEEDBACK_RERANK_ENABLED = "false";
    expect(isFeedbackRerankEnabled()).toBe(false);
    process.env.KB_FEEDBACK_RERANK_ENABLED = "garbage";
    expect(isFeedbackRerankEnabled()).toBe(false);
  });
});

// ─── computeFeedbackWeight (pure, bounded) ─────────────────────────────────

describe("computeFeedbackWeight", () => {
  it("netRating=0 (no feedback / absent signal) is exactly 1 — a no-op, identical to pure semantic", () => {
    expect(computeFeedbackWeight(0)).toBe(1);
  });

  it("is bounded: extreme netRating never exceeds FEEDBACK_WEIGHT_MIN/MAX", () => {
    expect(computeFeedbackWeight(MAX_NET_RATING)).toBeCloseTo(FEEDBACK_WEIGHT_MAX, 10);
    expect(computeFeedbackWeight(-MAX_NET_RATING)).toBeCloseTo(FEEDBACK_WEIGHT_MIN, 10);
    expect(computeFeedbackWeight(1000)).toBeCloseTo(FEEDBACK_WEIGHT_MAX, 10);
    expect(computeFeedbackWeight(-1000)).toBeCloseTo(FEEDBACK_WEIGHT_MIN, 10);
  });

  it("is a small, deliberately-bounded nudge (well under +-10%) so it never dominates semantic relevance", () => {
    expect(FEEDBACK_WEIGHT_MAX - 1).toBeLessThan(0.1);
    expect(1 - FEEDBACK_WEIGHT_MIN).toBeLessThan(0.1);
  });

  it("is monotonic: a higher net rating never produces a lower weight", () => {
    const weights = [-5, -2, -1, 0, 1, 2, 5].map(computeFeedbackWeight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]!);
    }
  });

  it("fail-safe on non-finite input: NaN/Infinity degrade to 1 (no-op), never throw or produce NaN", () => {
    expect(computeFeedbackWeight(NaN)).toBe(1);
    expect(computeFeedbackWeight(Infinity)).toBe(1);
    expect(computeFeedbackWeight(-Infinity)).toBe(1);
  });
});

// ─── Toy re-rank using computeFeedbackWeight (order-change assertion) ──────

describe("computeFeedbackWeight applied to a candidate list (retrieval-blend simulation)", () => {
  it("an upvoted source's candidate gets a bounded boost that can flip a close ranking", () => {
    const netRatings = new Map([["docA.md", MAX_NET_RATING]]); // strongly upvoted
    const candidates = [
      { sourcePath: "docB.md", score: 0.52 },
      { sourcePath: "docA.md", score: 0.5 },
    ];
    const reordered = candidates
      .map((c) => ({ ...c, boosted: c.score * computeFeedbackWeight(netRatings.get(c.sourcePath) ?? 0) }))
      .sort((a, b) => b.boosted - a.boosted);
    expect(reordered[0]!.sourcePath).toBe("docA.md"); // upvoted source now ranks first
  });

  it("a downvoted source's candidate is nudged down but the boost stays bounded (cannot invert a large score gap)", () => {
    const netRatings = new Map([["docLowQuality.md", -MAX_NET_RATING]]);
    const candidates = [
      { sourcePath: "docLowQuality.md", score: 0.9 }, // strong semantic match, but downvoted
      { sourcePath: "docOther.md", score: 0.3 }, // weak semantic match
    ];
    const reordered = candidates
      .map((c) => ({ ...c, boosted: c.score * computeFeedbackWeight(netRatings.get(c.sourcePath) ?? 0) }))
      .sort((a, b) => b.boosted - a.boosted);
    // A ±5% nudge cannot overturn a 0.9 vs 0.3 semantic gap — bounded, never dominates.
    expect(reordered[0]!.sourcePath).toBe("docLowQuality.md");
  });

  it("no feedback for any candidate (empty map) leaves order identical to pure semantic ranking", () => {
    const netRatings = new Map<string, number>();
    const candidates = [
      { sourcePath: "docB.md", score: 0.52 },
      { sourcePath: "docA.md", score: 0.5 },
    ];
    const reordered = candidates
      .map((c) => ({ ...c, boosted: c.score * computeFeedbackWeight(netRatings.get(c.sourcePath) ?? 0) }))
      .sort((a, b) => b.boosted - a.boosted);
    expect(reordered.map((c) => c.sourcePath)).toEqual(["docB.md", "docA.md"]);
  });
});

// ─── loadFeedbackNetRatings ─────────────────────────────────────────────────

describe("loadFeedbackNetRatings", () => {
  it("aggregates SUM(rating) per citation sourcePath across rows", async () => {
    selectLimitMock.mockResolvedValueOnce([
      { rating: 1, citations: [{ sourcePath: "docA.md" }, { sourcePath: "docB.md" }] },
      { rating: 1, citations: [{ sourcePath: "docA.md" }] },
      { rating: -1, citations: [{ sourcePath: "docB.md" }] },
    ]);
    const map = await loadFeedbackNetRatings();
    expect(map.get("docA.md")).toBe(2);
    expect(map.get("docB.md")).toBe(0);
  });

  it("skips malformed citation entries (no sourcePath) without throwing", async () => {
    selectLimitMock.mockResolvedValueOnce([
      { rating: 1, citations: [{ id: "x" }, null, "not-an-object", { sourcePath: "" }, { sourcePath: "ok.md" }] },
    ]);
    const map = await loadFeedbackNetRatings();
    expect(map.get("ok.md")).toBe(1);
    expect(map.size).toBe(1);
  });

  it("rating=0 rows contribute nothing (skipped)", async () => {
    selectLimitMock.mockResolvedValueOnce([{ rating: 0, citations: [{ sourcePath: "docA.md" }] }]);
    const map = await loadFeedbackNetRatings();
    expect(map.has("docA.md")).toBe(false);
  });

  it("fail-safe: missing table (42P01, raw) -> empty map, never throws", async () => {
    selectLimitMock.mockRejectedValueOnce(missingTableError());
    const map = await loadFeedbackNetRatings();
    expect(map.size).toBe(0);
  });

  it("fail-safe: missing table WRAPPED in a drizzle DrizzleQueryError (real shape) -> empty map, never throws", async () => {
    selectLimitMock.mockRejectedValueOnce(wrappedMissingTableError());
    const map = await loadFeedbackNetRatings();
    expect(map.size).toBe(0);
  });

  it("fail-safe: any other DB error -> empty map, never throws", async () => {
    selectLimitMock.mockRejectedValueOnce(new Error("connection reset"));
    const map = await loadFeedbackNetRatings();
    expect(map.size).toBe(0);
  });

  it("fail-safe: no DB connection configured -> empty map", async () => {
    getDbMock.mockResolvedValueOnce(undefined);
    const map = await loadFeedbackNetRatings();
    expect(map.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("caches the result for the TTL window — a second call does not re-hit the DB", async () => {
    selectLimitMock.mockResolvedValueOnce([{ rating: 1, citations: [{ sourcePath: "docA.md" }] }]);
    const first = await loadFeedbackNetRatings();
    const second = await loadFeedbackNetRatings();
    expect(second).toBe(first); // same Map instance — cache hit, no second DB call
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("resetFeedbackAggregateCacheForTest forces a fresh DB read", async () => {
    selectLimitMock.mockResolvedValueOnce([{ rating: 1, citations: [{ sourcePath: "docA.md" }] }]);
    await loadFeedbackNetRatings();
    resetFeedbackAggregateCacheForTest();
    selectLimitMock.mockResolvedValueOnce([{ rating: 1, citations: [{ sourcePath: "docB.md" }] }]);
    const map = await loadFeedbackNetRatings();
    expect(map.get("docB.md")).toBe(1);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});

// ─── recordAnswerFeedback ────────────────────────────────────────────────────

describe("recordAnswerFeedback", () => {
  it("persists a row with the expected shape", async () => {
    const result = await recordAnswerFeedback({
      messageId: "msg-1",
      question: "How do I configure NG thresholds?",
      rating: 1,
      citations: [{ id: "chunk-1", sourcePath: "knowledge/operational/alerts.md" }],
      userId: 42,
    });
    expect(result).toEqual({ persisted: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const values = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(values).toMatchObject({
      query: "How do I configure NG thresholds?",
      answerId: "msg-1",
      rating: 1,
      citations: [{ id: "chunk-1", sourcePath: "knowledge/operational/alerts.md" }],
      userId: 42,
    });
  });

  it("drops citation entries with no sourcePath and caps to 20", async () => {
    const citations = Array.from({ length: 25 }, (_, i) => ({ sourcePath: `doc${i}.md` }));
    citations.push({ sourcePath: undefined as unknown as string });
    await recordAnswerFeedback({ messageId: "m", question: "q", rating: 1, citations, userId: null });
    const values = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect((values.citations as unknown[]).length).toBe(20);
  });

  it("fail-safe: missing table (42P01, raw) -> {persisted:false, reason:'missing_table'}, never throws", async () => {
    insertValuesMock.mockRejectedValueOnce(missingTableError());
    const result = await recordAnswerFeedback({ messageId: "m", question: "q", rating: 1, citations: [] });
    expect(result).toEqual({ persisted: false, reason: "missing_table" });
  });

  it("fail-safe: missing table WRAPPED in a drizzle DrizzleQueryError (real shape) -> {persisted:false, reason:'missing_table'}", async () => {
    insertValuesMock.mockRejectedValueOnce(wrappedMissingTableError());
    const result = await recordAnswerFeedback({ messageId: "m", question: "q", rating: -1, citations: [] });
    expect(result).toEqual({ persisted: false, reason: "missing_table" });
  });

  it("fail-safe: any other DB error -> {persisted:false, reason:'error'}, never throws", async () => {
    insertValuesMock.mockRejectedValueOnce(new Error("connection reset"));
    const result = await recordAnswerFeedback({ messageId: "m", question: "q", rating: 1, citations: [] });
    expect(result).toEqual({ persisted: false, reason: "error" });
  });

  it("no DB connection configured -> {persisted:false, reason:'no_db'}", async () => {
    getDbMock.mockResolvedValueOnce(undefined);
    const result = await recordAnswerFeedback({ messageId: "m", question: "q", rating: 1, citations: [] });
    expect(result).toEqual({ persisted: false, reason: "no_db" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("a successful write invalidates the read cache so the next loadFeedbackNetRatings re-hits the DB", async () => {
    selectLimitMock.mockResolvedValueOnce([{ rating: 1, citations: [{ sourcePath: "docA.md" }] }]);
    await loadFeedbackNetRatings(); // primes the cache
    expect(selectMock).toHaveBeenCalledTimes(1);

    await recordAnswerFeedback({
      messageId: "m",
      question: "q",
      rating: 1,
      citations: [{ sourcePath: "docA.md" }],
    });

    selectLimitMock.mockResolvedValueOnce([{ rating: 2, citations: [{ sourcePath: "docA.md" }] }]);
    const map = await loadFeedbackNetRatings();
    expect(selectMock).toHaveBeenCalledTimes(2); // cache was invalidated, DB re-queried
    expect(map.get("docA.md")).toBe(2);
  });
});
