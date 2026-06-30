-- ============================================================================
-- P4 — AI Gateway metrics (doc 12 §9 "AI gateway" + audit F).
-- Promotes the in-memory routerStats counter into a durable, queryable table.
-- One row per inference routed through server/services/aiGateway.ts: tier, task,
-- model, A/B variant, tokens in/out, latency, and outcome. Written async/batched
-- off the hot path; the AI observability dashboards read aggregates from here.
-- Purely additive + idempotent (CREATE … IF NOT EXISTS only).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_gateway_metrics (
  "id" serial PRIMARY KEY,
  "tier" integer NOT NULL,
  "task" varchar(32) NOT NULL,
  "model" varchar(160) DEFAULT 'default' NOT NULL,
  "abVariant" varchar(1),
  "tokensIn" integer DEFAULT 0 NOT NULL,
  "tokensOut" integer DEFAULT 0 NOT NULL,
  "latencyMs" integer DEFAULT 0 NOT NULL,
  "outcome" varchar(16) DEFAULT 'ok' NOT NULL,
  "fastModelConfigured" boolean DEFAULT false NOT NULL,
  "userId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_gateway_metrics_created" ON ai_gateway_metrics ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_ai_gateway_metrics_tier"    ON ai_gateway_metrics ("tier");
CREATE INDEX IF NOT EXISTS "idx_ai_gateway_metrics_model"   ON ai_gateway_metrics ("model");
