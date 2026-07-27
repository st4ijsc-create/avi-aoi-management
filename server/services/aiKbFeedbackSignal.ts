/**
 * doc69 B3 (Wave 5, AI#2) — KB answer feedback: persist-to-DB + a bounded, flag-gated
 * re-ranking signal.
 *
 * Closes the loop opened by Stage 13.D (thumbs up/down persisted ONLY to the
 * append-only knowledge/feedback.jsonl log, never read back — see
 * server/routes/aiLocalKnowledgeApi.ts's `/api/ai/local-kb/feedback` handler). Every
 * feedback vote is now ALSO written to the `kb_answer_feedback` table (additive
 * migration drizzle/0306_kb_answer_feedback.sql, owner `aoi`, UNAPPLIED until an
 * operator runs it) via {@link recordAnswerFeedback}, called from
 * server/routers/aiLocalKbRouter.ts's `feedback` mutation ALONGSIDE — not instead of
 * — the existing JSONL append.
 *
 * {@link loadFeedbackNetRatings} aggregates that table into a per-sourcePath net
 * rating (SUM of the -1/0/1 votes across every answer that cited it) and
 * {@link computeFeedbackWeight} turns a net rating into a BOUNDED score multiplier.
 * server/services/aiLocalKnowledgeService.ts's `retrieveKnowledge()` folds this
 * multiplier into its existing score blend (langWeight/typeWeight/routeWeight)
 * alongside those, so a consistently-upvoted source nudges toward the top and a
 * downvoted one nudges down — WITHOUT ever overriding semantic relevance (the
 * multiplier's range, ±5%, is deliberately smaller than the existing type/lang/route
 * weights there, which range ±8–18%).
 *
 * FLAG-GATED (`KB_FEEDBACK_RERANK_ENABLED`, default OFF) + FAIL-SAFE throughout:
 *   - disabled                      → retrieveKnowledge never calls loadFeedbackNetRatings.
 *   - kb_answer_feedback unmigrated → loadFeedbackNetRatings degrades to an EMPTY map
 *     (via server/_core/dbErrors.ts's `isMissingTable` cause-walker — NOT a naive
 *     `.code === "42P01"` check, which misses drizzle-orm's DrizzleQueryError
 *     wrapping; that exact gap was caught live in an earlier task).
 *   - any other DB error / no DB    → same empty-map degrade, never throws.
 *   - empty map                     → computeFeedbackWeight(0) === 1 for every
 *     source → byte-identical to pure semantic ranking.
 *
 * HONEST: this is a light curation signal — a small nudge from accumulated human
 * votes — NOT a learned re-ranker/model. See aiReranker.ts for the actual (LLM/gguf)
 * semantic reranker, a SEPARATE, independently-flagged pipeline stage this module
 * does not touch.
 */
import { desc } from "drizzle-orm";
import { getDb } from "../db/connection";
import { isMissingTable } from "../_core/dbErrors";
import { kbAnswerFeedback } from "../../drizzle/schema";

// ─── Flag ───────────────────────────────────────────────────────────────────────

export function isFeedbackRerankEnabled(): boolean {
  const v = String(process.env.KB_FEEDBACK_RERANK_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

// ─── Bounded weight (pure) ────────────────────────────────────────────────────────

// A single source's net rating is clamped to +-MAX_NET_RATING before scaling, so
// neither a single spammy voter nor an extremely popular/unpopular source can run
// away with the multiplier. The resulting range (0.95-1.05, i.e. +-5%) is
// deliberately SMALLER than aiLocalKnowledgeService's existing semantic blend
// weights (typeWeight ~0.90-1.18, langWeight ~0.92-1.08, routeWeight 1.12) — this
// signal nudges, it never dominates.
export const MAX_NET_RATING = 5;
const WEIGHT_PER_VOTE = 0.01;
export const FEEDBACK_WEIGHT_MIN = 1 - MAX_NET_RATING * WEIGHT_PER_VOTE; // 0.95
export const FEEDBACK_WEIGHT_MAX = 1 + MAX_NET_RATING * WEIGHT_PER_VOTE; // 1.05

/**
 * Pure + bounded: a source's net feedback rating (SUM of -1/0/1 votes across every
 * answer that cited it) -> a score multiplier in [FEEDBACK_WEIGHT_MIN,
 * FEEDBACK_WEIGHT_MAX]. netRating=0 (no feedback, or a missing/absent signal) ->
 * exactly 1 (no-op — pure semantic ranking unchanged).
 */
export function computeFeedbackWeight(netRating: number): number {
  if (!Number.isFinite(netRating)) return 1;
  const clamped = Math.max(-MAX_NET_RATING, Math.min(MAX_NET_RATING, netRating));
  return 1 + clamped * WEIGHT_PER_VOTE;
}

// ─── Read: aggregate feedback per sourcePath (cached, fail-safe) ─────────────────

const CACHE_TTL_MS = 60_000;
let cache: { at: number; map: Map<string, number> } | null = null;

function invalidateCache(): void {
  cache = null;
}

/** Test-only: force the next loadFeedbackNetRatings() to re-read the DB. */
export function resetFeedbackAggregateCacheForTest(): void {
  invalidateCache();
}

// Bounds the read cost of the aggregate — this is a light curation signal over
// recent votes, not an exhaustive analytics query over the whole table's history.
const AGGREGATE_ROW_LIMIT = 2000;

/**
 * Aggregates net rating (SUM of -1/0/1) per citation sourcePath across the most
 * recent AGGREGATE_ROW_LIMIT feedback rows. NEVER throws: table absent (fail-safe
 * `isMissingTable` cause-walker), no DB connection, or any other error all degrade
 * to an EMPTY map (== pure-semantic-equivalent, since computeFeedbackWeight(0) ===
 * 1). Cached in-memory for CACHE_TTL_MS so a burst of chat turns doesn't hit the DB
 * once per message; recordAnswerFeedback() invalidates the cache on a fresh write so
 * a new vote is reflected within one TTL window at worst (immediately after the next
 * write, since the cache is cleared then).
 */
export async function loadFeedbackNetRatings(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.map;

  const map = new Map<string, number>();
  try {
    const db = await getDb();
    if (!db) {
      cache = { at: now, map };
      return map;
    }

    const rows = await db
      .select({ rating: kbAnswerFeedback.rating, citations: kbAnswerFeedback.citations })
      .from(kbAnswerFeedback)
      .orderBy(desc(kbAnswerFeedback.createdAt))
      .limit(AGGREGATE_ROW_LIMIT);

    for (const row of rows) {
      const rating = Number(row.rating);
      if (!Number.isFinite(rating) || rating === 0) continue;
      const citations = Array.isArray(row.citations) ? row.citations : [];
      for (const c of citations) {
        const sourcePath =
          c && typeof c === "object" ? (c as { sourcePath?: unknown }).sourcePath : undefined;
        if (typeof sourcePath !== "string" || !sourcePath) continue;
        map.set(sourcePath, (map.get(sourcePath) ?? 0) + rating);
      }
    }
  } catch (err) {
    if (!isMissingTable(err)) {
      console.warn("[aiKbFeedbackSignal] loadFeedbackNetRatings failed (degrading to no signal):", err);
    }
    // Fail-safe either way (missing table or a real error): empty map == pure
    // semantic ranking, cached too so a broken DB doesn't get hammered every turn.
    cache = { at: now, map: new Map() };
    return cache.map;
  }

  cache = { at: now, map };
  return map;
}

// ─── Write: persist one feedback vote (additive, fail-safe) ──────────────────────

export interface RecordAnswerFeedbackInput {
  messageId: string;
  question: string;
  rating: number; // -1 | 0 | 1
  citations: Array<{ id?: string | null; sourcePath?: string | null }>;
  userId?: number | null;
}

export interface RecordAnswerFeedbackResult {
  persisted: boolean;
  reason?: "no_db" | "missing_table" | "error";
}

/**
 * Persists ONE feedback vote to kb_answer_feedback. Additive + fail-safe: an
 * unmigrated table (`isMissingTable`) or any other DB error degrades to
 * `{persisted:false}` — NEVER throws, so a DB hiccup never blocks the tRPC
 * mutation. The legacy JSONL append in server/routes/aiLocalKnowledgeApi.ts runs
 * independently and is unaffected either way.
 */
export async function recordAnswerFeedback(
  input: RecordAnswerFeedbackInput,
): Promise<RecordAnswerFeedbackResult> {
  try {
    const db = await getDb();
    if (!db) return { persisted: false, reason: "no_db" };

    const citations = (input.citations ?? [])
      .filter(
        (c): c is { id?: string | null; sourcePath: string } =>
          !!c && typeof c.sourcePath === "string" && c.sourcePath.length > 0,
      )
      .map((c) => (c.id ? { id: c.id, sourcePath: c.sourcePath } : { sourcePath: c.sourcePath }))
      .slice(0, 20);

    await db.insert(kbAnswerFeedback).values({
      query: (input.question ?? "").slice(0, 4000),
      answerId: (input.messageId ?? "").slice(0, 100),
      rating: Math.round(input.rating),
      citations,
      userId: input.userId ?? null,
    });

    // A fresh vote should count promptly — clear the read cache so the next
    // retrieval (within the same TTL window) sees it.
    invalidateCache();
    return { persisted: true };
  } catch (err) {
    if (isMissingTable(err)) return { persisted: false, reason: "missing_table" };
    console.warn("[aiKbFeedbackSignal] recordAnswerFeedback failed (non-fatal):", err);
    return { persisted: false, reason: "error" };
  }
}
