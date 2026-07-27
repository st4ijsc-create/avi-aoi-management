-- ============================================================================
-- Migration 0306: kb_answer_feedback — doc69 B3 (Wave 5, AI#2): closes the KB
-- answer feedback loop (persist-to-DB + a bounded, flag-gated re-ranking signal).
--
-- Every thumbs up/down vote on an assistant answer (server/routers/
-- aiLocalKbRouter.ts's `feedback` mutation) is now ALSO persisted here — in
-- ADDITION to the pre-existing append-only knowledge/feedback.jsonl log (Stage
-- 13.D, server/routes/aiLocalKnowledgeApi.ts), which is kept unchanged as a
-- secondary log. This table is the QUERYABLE source: server/services/
-- aiKbFeedbackSignal.ts aggregates a net rating (SUM of -1/0/1) per cited
-- sourcePath and applies a BOUNDED (+-5%) multiplier in
-- aiLocalKnowledgeService.retrieveKnowledge()'s existing score blend (alongside
-- its lang/type/route weights), flag-gated by KB_FEEDBACK_RERANK_ENABLED
-- (default OFF — pure semantic ranking unchanged until an operator opts in).
--
-- `citations` is a SNAPSHOT (jsonb array of {id?, sourcePath}) of what was shown
-- for that answer at feedback time — NOT a live FK to any chunk/embedding
-- record, so a later re-embed/removal of that source never breaks this table.
--
-- FAIL-SAFE: every read/write path (aiKbFeedbackSignal.ts) treats a missing
-- table (pg 42P01, via server/_core/dbErrors.ts's isMissingTable cause-walker —
-- NOT a naive `.code` check, which misses drizzle-orm's DrizzleQueryError
-- wrapping) as "no signal" / "not persisted" — never throws, never blocks the
-- tRPC mutation or the answer path. The legacy JSONL append is unaffected
-- either way (kept verbatim, unchanged by this task).
--
-- ADDITIVE + IDEMPOTENT (IF NOT EXISTS throughout) — safe to run more than
-- once. Run by owner `aoi` (DDL convention — do NOT run as a non-owner role).
-- This migration is NOT run as part of the implementation task — it ships
-- unapplied until an operator with the `aoi` role runs it.
-- ROLLBACK: DROP TABLE "kb_answer_feedback";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "kb_answer_feedback" (
  "id" serial PRIMARY KEY,
  "query" text NOT NULL,
  "answerId" varchar(100) NOT NULL,
  "rating" integer NOT NULL,
  "citations" jsonb DEFAULT '[]'::jsonb,
  "userId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_kb_answer_feedback_answer" ON "kb_answer_feedback" ("answerId");
CREATE INDEX IF NOT EXISTS "idx_kb_answer_feedback_created" ON "kb_answer_feedback" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_kb_answer_feedback_rating" ON "kb_answer_feedback" ("rating");
