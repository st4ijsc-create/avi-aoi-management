-- ============================================================================
-- Migration 0299: ai_llm_audit — privacy-safe audit trail for HIGH-RISK LLM-influenced
-- decisions (doc69 G2-5a, Wave 1 W1-4a).
--
-- G2-1..G2-4 gave the AI Gateway (server/services/aiGateway.ts planInference) compact
-- TELEMETRY (ai_gateway_metrics: tokensIn/out, tier, model, outcome, userId) but no durable
-- "who asked what, what did the model answer, for which quality decision" trail for the
-- HIGH-RISK tasks (rca / report / vision) that actually influence a quality/RCA outcome. This
-- table is that trail — PRIVACY-SAFE BY CONSTRUCTION: it stores sha256 HASHES of the
-- already-REDACTED prompt/response (see server/services/ai/aiSafety.ts's redaction), never
-- raw text. No secret ever enters the hash preimage because redaction runs BEFORE hashing.
--
-- Wiring: server/services/aiGateway.ts (planInference) calls
-- server/services/ai/aiLlmAudit.ts's recordLlmAudit()/flushLlmAudit() (buffered — mirrors the
-- EXISTING ai_gateway_metrics buffer+flush pattern, so a hash+enqueue is a cheap synchronous
-- call on the hot path, no DB round-trip) ONLY for the HIGH-RISK subset of tasks (rca/report/
-- vision) — never for chat/intent/extract/embed/code/fim (volume). Gated by
-- AI_LLM_AUDIT_ENABLED (default ON — see the flag's doc comment in aiGateway.ts). Fail-safe:
-- any DB/hash error is caught + dropped, NEVER thrown into the inference path; the audit path
-- simply no-ops (not "fails") until this migration is applied.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do NOT run as a non-owner
-- role). This migration is NOT run as part of the implementation task — it ships unapplied
-- until an operator with the `aoi` role runs it. ROLLBACK: DROP TABLE "ai_llm_audit";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ai_llm_audit" (
  "id" serial PRIMARY KEY,
  "userId" integer,
  "task" varchar(32) NOT NULL,
  "tier" integer NOT NULL,
  "model" varchar(160) NOT NULL DEFAULT 'default',
  "outcome" varchar(16) NOT NULL,
  "promptSha256" varchar(64) NOT NULL,
  "responseSha256" varchar(64),
  "promptChars" integer NOT NULL DEFAULT 0,
  "responseChars" integer NOT NULL DEFAULT 0,
  "latencyMs" integer NOT NULL DEFAULT 0,
  "safetyFlagsJson" json,
  "correlationId" varchar(128),
  "redactedSnippet" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ai_llm_audit_created" ON "ai_llm_audit" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_ai_llm_audit_user" ON "ai_llm_audit" ("userId");
CREATE INDEX IF NOT EXISTS "idx_ai_llm_audit_task" ON "ai_llm_audit" ("task");
