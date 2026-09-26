-- ============================================================================
-- Migration 0303: ai_model_cards — MODEL CARD governance record (doc69 Giai đoạn 4/
-- Wave 3, task D3).
--
-- ONE governance card per model (unique modelId), the SOURCE OF TRUTH for the
-- ModelCard §12.2 governance metadata: intended use, training data description, eval
-- summary, limitations, risk classification, owner, and an approval (approvedBy/
-- approvedAt). Subsumes — does not contradict — the existing inline
-- model_versions.owner / model_versions.trained_on columns (migration ~0262-era): those
-- stay populated for back-compat, and server/routers/aiModelRouter.ts's `createCard`
-- falls back to the model's latest version's inline `owner` when the card omits one.
--
-- Consumed by:
--   - server/services/aiModelCardGate.ts (evaluateCardGate / getModelCardStatus) — the
--     card-required activation gate. FLAG-GATED: env AI_MODEL_CARD_REQUIRED defaults
--     false, so activation behaviour is UNCHANGED until an operator turns the flag on
--     AND this migration has been applied. Every read of this table catches the
--     "relation does not exist" error (pg code 42P01) and degrades the requirement to
--     OFF — never brick activation on an unmigrated DB.
--   - server/routers/aiModelRouter.ts — createCard/updateCard/approveCard/getCard
--     (admin/engineer RBAC-gated CRUD).
--
-- Distinct from ai_llm_audit (migration 0299) — that table is the LLM-decision audit
-- (HIGH-RISK RCA/report/vision calls); this table is model-REGISTRY governance
-- metadata, unrelated. The model-LIFECYCLE audit trail (activate/rollback/override)
-- is a NEW audit_logs action (AUDIT_ACTIONS.AI_MODEL_GOVERNANCE) — no new table for
-- that, it reuses the existing audit_logs infrastructure.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do NOT run as a
-- non-owner role). This migration is NOT run as part of the implementation task — it
-- ships unapplied until an operator with the `aoi` role runs it.
-- ROLLBACK: DROP TABLE "ai_model_cards";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ai_model_cards" (
  "id" serial PRIMARY KEY,
  "modelId" integer NOT NULL UNIQUE,
  "intendedUse" text,
  "trainingDataDesc" text,
  "evalSummary" text,
  "limitations" text,
  "riskClass" varchar(20),
  "owner" varchar(255),
  "approvedBy" integer,
  "approvedAt" timestamp,
  "notes" text,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ai_model_cards_model" ON "ai_model_cards" ("modelId");
